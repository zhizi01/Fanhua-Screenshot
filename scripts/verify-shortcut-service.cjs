'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createShortcutService, normalizeShortcut, formatShortcut } = require('../electron/shortcut.cjs')
const { createSettingsStore, DEFAULT_SETTINGS } = require('../electron/settings.cjs')
const root = path.resolve(__dirname, '../artifacts/shortcut-service')
const clone = value => JSON.parse(JSON.stringify(value))
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function fakeGlobal() {
  return {
    keys: new Map(), occupied: new Set(), registerErrors: new Set(), unregisterErrors: new Set(), removedThenErrors: new Set(), calls: [],
    isRegistered(key) { return this.keys.has(key) },
    register(key, callback) {
      this.calls.push(['register', key])
      if (this.registerErrors.has(key)) throw new Error('native register failed')
      if (this.occupied.has(key) || this.keys.has(key)) return false
      this.keys.set(key, callback)
      callback() // A native event can arrive as soon as registration succeeds.
      return true
    },
    unregister(key) {
      this.calls.push(['unregister', key])
      if (this.unregisterErrors.has(key)) throw new Error('native unregister failed')
      this.keys.delete(key)
      if (this.removedThenErrors.has(key)) { this.removedThenErrors.delete(key); throw new Error('native post-unregister failure') }
    },
    fire(key) { this.keys.get(key)?.() },
  }
}
async function fixture(name) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ version: 1, settings: DEFAULT_SETTINGS }))
  return directory
}
const read = async directory => JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).settings
function heldWrites(entered, release) {
  return { ...fs, open: async (...args) => {
    const handle = await fs.open(...args)
    if (args[1] !== 'wx') return handle
    return { close: () => handle.close(), sync: () => handle.sync(), writeFile: async (...writeArgs) => { entered.resolve(); await release.promise; return handle.writeFile(...writeArgs) } }
  } }
}

async function run() {
  for (const [value, expected] of [[' alt + a ', 'Alt+A'], ['shift + Control + s', 'Ctrl+Shift+S'], ['win+alt+control+shift+Space', 'Ctrl+Alt+Shift+Super+Space'], ['Ctrl+空格', 'Ctrl+Space'], ['alt+return', 'Alt+Enter'], ['f24', 'F24'], ['Shift+PrintScreen', 'Shift+PrintScreen']]) assert.equal(normalizeShortcut(value), expected)
  assert.equal(formatShortcut('super+ctrl+shift+s'), 'Ctrl + Shift + Win + S')
  for (const key of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'Space', 'Tab', 'Enter', 'Backspace', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right']) assert.equal(normalizeShortcut('Alt+' + key), 'Alt+' + key)
  for (let index = 1; index <= 24; index++) assert.equal(normalizeShortcut('F' + index), 'F' + index)
  for (const value of ['', ' ', 'A', 'Shift+A', 'Tab', 'Shift+Up', 'Ctrl', 'Ctrl+Control+S', 'Ctrl+A+A', 'Ctrl+Escape', 'Alt+Esc', 'F0', 'F25', 'Alt++A', 'Ctrl+Alt+', 'Command+S', 'AltGr+A', 'Ctrl+Plus', 'Ctrl+VolumeUp', null, {}, 123]) assert.throws(() => normalizeShortcut(value), undefined, String(value))

  const native = fakeGlobal(), states = []; let captures = 0
  const shortcut = createShortcutService({ globalShortcut: native, onCapture: () => captures++, onChanged: state => states.push(state) })
  assert.deepEqual(shortcut.initialize('Alt+A'), { shortcut: 'Alt+A', shortcutRegistered: true })
  assert.equal(captures, 0, 'A newly reserved binding cannot capture before commit')
  native.fire('Alt+A'); assert.equal(captures, 1)
  const oldCallback = native.keys.get('Alt+A')
  const transaction = shortcut.beginChange(' ctrl + shift + s ')
  native.fire('Ctrl+Shift+S'); assert.equal(captures, 1)
  native.fire('Alt+A'); assert.equal(captures, 2)
  assert.equal(states.length, 1, 'Candidates are not advertised as active')
  transaction.commit(); native.fire('Ctrl+Shift+S'); assert.equal(captures, 3)
  oldCallback(); assert.equal(captures, 3, 'A queued old callback must not fire after changing bindings')
  assert.equal(native.keys.has('Alt+A'), false)
  transaction.rollback(); native.fire('Alt+A'); assert.equal(captures, 4)
  assert.equal(native.keys.has('Ctrl+Shift+S'), false)
  const canceled = shortcut.beginChange('F8'); canceled.rollback(); canceled.rollback()
  assert.equal(native.keys.has('F8'), false)
  native.occupied.add('Ctrl+P')
  assert.throws(() => shortcut.beginChange('Ctrl+P'), /占用/)
  native.registerErrors.add('Ctrl+U')
  assert.throws(() => shortcut.beginChange('Ctrl+U'), /未能注册/)
  native.fire('Alt+A'); assert.equal(captures, 5)
  assert.equal(shortcut.getState().shortcutRegistered, true)
  for (const afterRemoval of [false, true]) {
    const tx = shortcut.beginChange('F9')
    if (afterRemoval) native.removedThenErrors.add('Alt+A')
    else native.unregisterErrors.add('Alt+A')
    assert.throws(() => tx.commit())
    native.unregisterErrors.clear()
    tx.rollback()
    assert.equal(shortcut.getState().shortcut, 'Alt+A')
    assert.equal(shortcut.getState().shortcutRegistered, true)
    assert.equal(native.keys.has('F9'), false)
  }
  const same = shortcut.beginChange('ALT+A'), callCount = native.calls.length
  same.commit(); assert.equal(native.calls.length, callCount, 'Reapplying a healthy same binding must not unregister it')
  native.register('Escape', () => {})
  const pending = shortcut.beginChange('F10'), candidateCallback = native.keys.get('F10')
  shortcut.dispose()
  assert.deepEqual([...native.keys.keys()], ['Escape'], 'The service must release its active and candidate bindings without releasing capture Escape')
  assert.throws(() => pending.commit(), /退出/)
  pending.rollback(); candidateCallback(); assert.equal(captures, 5)
  const registeredBefore = native.calls.filter(call => call[0] === 'register').length
  for (const action of [() => shortcut.beginChange('F1'), () => shortcut.retry(), () => shortcut.initialize('Alt+A')]) assert.throws(action, /退出/)
  assert.equal(native.calls.filter(call => call[0] === 'register').length, registeredBefore)

  const recoverNative = fakeGlobal(); recoverNative.occupied.add('Alt+A')
  const recovering = createShortcutService({ globalShortcut: recoverNative, onCapture() {} })
  assert.equal(recovering.initialize('Alt+A').shortcutRegistered, false)
  recoverNative.occupied.clear()
  assert.equal(recovering.retry().shortcutRegistered, true)
  recovering.dispose()

  const directory = await fixture('persisted'), processNative = fakeGlobal(), entered = deferred(), release = deferred()
  let triggered = 0
  const broadcasts = []
  const processShortcut = createShortcutService({ globalShortcut: processNative, onCapture: () => triggered++ })
  processShortcut.initialize('Alt+A')
  const store = createSettingsStore({ directory, shortcut: processShortcut, fileSystem: heldWrites(entered, release), onChanged: settings => {
    broadcasts.push({ saved: settings.captureShortcut, active: processShortcut.getState().shortcut, oldKeyRegistered: processNative.keys.has('Alt+A') })
  } })
  await store.initialize()
  const update = store.update({ captureShortcut: 'control+shift+s', imageQuality: 80 })
  await entered.promise
  processNative.fire('Ctrl+Shift+S'); assert.equal(triggered, 0)
  processNative.fire('Alt+A'); assert.equal(triggered, 1)
  assert.equal((await store.get()).captureShortcut, 'Alt+A')
  assert.equal((await read(directory)).captureShortcut, 'Alt+A')
  let shutdownFinished = false
  const closing = store.dispose().then(() => { shutdownFinished = true; processShortcut.dispose() })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(shutdownFinished, false)
  release.resolve(); await update; await closing
  assert.deepEqual(broadcasts, [{ saved: 'Ctrl+Shift+S', active: 'Ctrl+Shift+S', oldKeyRegistered: false }], 'Settings broadcasts must follow the completed binding commit')
  assert.equal((await read(directory)).captureShortcut, 'Ctrl+Shift+S')
  assert.equal(processNative.keys.size, 0)
  const restartNative = fakeGlobal(), restart = createShortcutService({ globalShortcut: restartNative, onCapture() {} })
  const restartedStore = createSettingsStore({ directory, shortcut: restart })
  const persisted = await restartedStore.initialize(); restart.initialize(persisted.captureShortcut)
  assert.equal(restartNative.keys.has('Ctrl+Shift+S'), true)
  await restartedStore.dispose(); restart.dispose()

  for (const failure of ['io', 'conflict', 'commit', 'disposed']) {
    const dir = await fixture(failure), os = fakeGlobal(), order = [], changed = []
    const service = createShortcutService({ globalShortcut: os, onCapture() {} }); service.initialize('Alt+A')
    const registry = { enabled: false, beginChange: async enabled => {
      registry.enabled = enabled; order.push('registry prepare')
      return { rollback: async () => { order.push('registry rollback'); registry.enabled = false } }
    } }
    const adapter = { beginChange: value => {
      const tx = service.beginChange(value); order.push('shortcut prepare')
      return { commit: () => tx.commit(), rollback: () => { order.push('shortcut rollback'); tx.rollback() } }
    } }
    const writeEntered = deferred(), continueWrite = deferred()
    let fileSystem = fs
    if (failure === 'io') fileSystem = { ...fs, rename: async () => { throw new Error('disk full') } }
    if (failure === 'conflict') os.occupied.add('Ctrl+Shift+S')
    if (failure === 'commit') os.unregisterErrors.add('Alt+A')
    if (failure === 'disposed') fileSystem = heldWrites(writeEntered, continueWrite)
    const settings = createSettingsStore({ directory: dir, shortcut: adapter, contextMenu: registry, fileSystem, onChanged: value => changed.push(value) })
    await settings.initialize()
    const operation = settings.update({ contextMenuEnabled: true, captureShortcut: 'Ctrl+Shift+S' })
    if (failure === 'disposed') {
      await writeEntered.promise; service.dispose(); continueWrite.resolve()
    }
    await assert.rejects(operation)
    assert.equal(registry.enabled, false)
    assert.deepEqual(await read(dir), DEFAULT_SETTINGS)
    assert.deepEqual(settings.snapshot(), DEFAULT_SETTINGS)
    assert.equal(changed.length, 0)
    if (failure !== 'conflict') assert(order.indexOf('shortcut rollback') < order.indexOf('registry rollback'))
    assert.equal(os.keys.has('Ctrl+Shift+S'), false)
    assert.equal(os.keys.has('Alt+A'), failure !== 'disposed')
    os.unregisterErrors.clear(); await settings.dispose(); service.dispose()
    assert.deepEqual((await fs.readdir(dir)).filter(file => file.endsWith('.tmp')), [])
  }
  const failedRollbackDirectory = await fixture('rollback-native-failure'), failedRollbackNative = fakeGlobal()
  let recoveredCaptures = 0, failedBroadcasts = 0
  const failedRollbackShortcut = createShortcutService({ globalShortcut: failedRollbackNative, onCapture: () => recoveredCaptures++ })
  failedRollbackShortcut.initialize('Alt+A')
  failedRollbackNative.unregisterErrors.add('Ctrl+Shift+S')
  const failedRollbackStore = createSettingsStore({ directory: failedRollbackDirectory, shortcut: failedRollbackShortcut,
    fileSystem: { ...fs, rename: async () => { throw new Error('disk full') } }, onChanged: () => failedBroadcasts++ })
  await assert.rejects(failedRollbackStore.update({ captureShortcut: 'Ctrl+Shift+S' }), /未能完全恢复/)
  failedRollbackNative.fire('Alt+A'); failedRollbackNative.fire('Ctrl+Shift+S')
  assert.equal(recoveredCaptures, 1, 'A rollback release failure preserves old capture and never activates the abandoned candidate')
  assert.equal(failedBroadcasts, 0)
  assert.equal(failedRollbackShortcut.getState().shortcutRegistered, true)
  assert.match(failedRollbackShortcut.getState().shortcutReason, /恢复失败.*退出/)
  assert.throws(() => failedRollbackShortcut.beginChange('F8'), /恢复失败.*退出/)
  assert.throws(() => failedRollbackShortcut.retry(), /恢复失败.*退出/)
  assert.equal((await read(failedRollbackDirectory)).captureShortcut, 'Alt+A')
  assert.equal((await failedRollbackStore.get()).captureShortcut, 'Alt+A')
  await failedRollbackStore.dispose()
  failedRollbackNative.unregisterErrors.clear(); failedRollbackShortcut.dispose()
  assert.equal(failedRollbackNative.keys.size, 0, 'Dispose retries cleanup of the retained failed candidate')
  const migration = await fixture('migration')
  const old = clone(DEFAULT_SETTINGS); delete old.captureShortcut
  await fs.writeFile(path.join(migration, 'settings.json'), JSON.stringify({ version: 1, settings: old }))
  const oldStore = createSettingsStore({ directory: migration })
  assert.equal((await oldStore.get()).captureShortcut, 'Alt+A'); await oldStore.dispose()
  const report = { strictCanonicalValidation: true, displayUsesWin: true, candidatesNeverCapture: true, oldKeySurvivesConflictAndExceptions: true, staleCallbacksSuppressed: true, sameKeyRetry: true, persistencePrecedesActivation: true, reverseCombinedRollback: true, rollbackFailureKeepsOldKeyAndRejectsFurtherChanges: true, commitFailureRestoresFile: true, restartRestoresShortcut: true, oldSettingsMigrate: true, disposeReleasesCandidates: true, noRegistrationAfterDispose: true, shutdownWaitsPendingWrite: true, noRealSystemChanges: true }
  await fs.writeFile(path.join(root, 'regression.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
