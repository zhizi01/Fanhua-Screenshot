'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createSettingsStore, DEFAULT_SETTINGS } = require('../electron/settings.cjs')
const root = path.resolve(__dirname, '../artifacts/settings-service')
const clone = value => JSON.parse(JSON.stringify(value))
function registryStub() {
  const stub = { rows: ['old-partial-state'], calls: [], reject: false, failRollback: false }
  stub.beginChange = async enabled => {
    stub.calls.push(enabled)
    if (stub.reject) throw new Error('右键菜单注册失败（模拟）')
    const previous = clone(stub.rows)
    stub.rows = enabled ? ['new-png', 'new-jpeg', 'new-webp', 'new-bmp', 'new-pdf'] : []
    return { state: { enabled }, rollback: async () => {
      if (stub.failRollback) throw new Error('恢复失败（模拟）')
      stub.rows = previous
    } }
  }
  return stub
}
async function fixture(name, content) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  if (content !== undefined) await fs.writeFile(path.join(directory, 'settings.json'), content)
  else await fs.unlink(path.join(directory, 'settings.json')).catch(error => { if (error.code !== 'ENOENT') throw error })
  return directory
}
async function run() {
  const directory = await fixture('defaults'), registry = registryStub(), events = []
  const store = createSettingsStore({ directory, contextMenu: registry, onChanged: state => { events.push(clone(state)); state.editor.font = 'callback mutation' } })
  assert.deepEqual(await store.initialize(), DEFAULT_SETTINGS)
  assert.deepEqual(registry.calls, [], 'Startup must never inject or remove Explorer verbs')
  const mutable = await store.get(); mutable.editor.color = '#000000'
  assert.equal(store.snapshot().editor.color, '#ef5c68')
  const [first, second] = await Promise.all([store.update({ startupNotification: false, editor: { font: '霞鹜文楷', size: 35 } }), store.update({ captureOpenEditor: true, editor: { color: '#123456' } })])
  assert.equal(first.editor.font, '霞鹜文楷')
  assert.equal(second.editor.size, 35)
  assert.equal(second.startupNotification, false)
  assert.equal(second.captureOpenEditor, true)
  assert.equal(events.length, 2)
  assert.deepEqual(registry.calls, [], 'Ordinary preferences must not touch the registry')
  const onDisk = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'))
  assert.deepEqual(onDisk, { version: 1, settings: second })
  const reopened = createSettingsStore({ directory, contextMenu: registry })
  assert.deepEqual(await reopened.get(), second)
  for (const patch of [null, [], { unknown: true }, { startupNotification: 'false' }, { editor: [] }, { editor: { size: 7 } }, { editor: { markerStyle: 'numbers' } }, { editor: { color: 'red' } }, { imageQuality: 9 }, { imageQuality: 101 }, { pdfScope: 'selected' }, { ocrLanguage: 'bad/tag' }, JSON.parse('{"__proto__":{"polluted":true}}'), { editor: JSON.parse('{"__proto__":{}}') }]) await assert.rejects(store.update(patch))
  assert.deepEqual(store.snapshot(), second)
  assert.equal(events.length, 2)
  await store.update({ contextMenuEnabled: true })
  assert.deepEqual(registry.calls, [true])
  assert.equal(store.snapshot().contextMenuEnabled, true)
  await store.update({ contextMenuEnabled: true })
  assert.deepEqual(registry.calls, [true, true], 'An explicit same-value toggle must still reconcile the actual OS state')
  await store.dispose(); await reopened.dispose()
  await assert.rejects(store.update({ imageQuality: 50 }), /正在退出/)

  let releaseChange, changeEntered
  const gate = new Promise(resolve => { releaseChange = resolve })
  const entered = new Promise(resolve => { changeEntered = resolve })
  const pending = createSettingsStore({ directory: await fixture('pending'), contextMenu: { beginChange: async () => {
    changeEntered(); await gate; return { state: { enabled: true }, rollback: async () => {} }
  } } })
  await pending.initialize()
  const update = pending.update({ contextMenuEnabled: true, imageQuality: 70 })
  await entered
  let readResolved = false
  const read = pending.get().then(value => { readResolved = true; return value })
  await new Promise(resolve => setImmediate(resolve))
  try {
    assert.equal(readResolved, true, 'New previews must not wait for a pending registry write')
    assert.deepEqual(await read, DEFAULT_SETTINGS, 'A pending change must not be exposed as saved')
  } finally { releaseChange() }
  await update
  assert.equal((await pending.get()).imageQuality, 70)
  await pending.dispose()

  for (const failure of ['persist', 'registry', 'rollback']) {
    const original = { version: 1, settings: clone(DEFAULT_SETTINGS) }
    const dir = await fixture(failure, JSON.stringify(original)), adapter = registryStub()
    adapter.reject = failure === 'registry'; adapter.failRollback = failure === 'rollback'
    const originalRows = clone(adapter.rows), changed = []
    const fileSystem = { ...fs, rename: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) } }
    const instance = createSettingsStore({ directory: dir, contextMenu: adapter, fileSystem, onChanged: value => changed.push(value) })
    await instance.initialize()
    await assert.rejects(instance.update({ contextMenuEnabled: true, imageFormat: 'pdf' }), failure === 'registry' ? /注册失败/ : failure === 'rollback' ? /未能完全恢复/ : /已恢复/)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8')), original)
    assert.deepEqual(instance.snapshot(), DEFAULT_SETTINGS)
    assert.equal(changed.length, 0)
    if (failure === 'rollback') { assert(instance.getError()); assert.notDeepEqual(adapter.rows, originalRows) }
    else assert.deepEqual(adapter.rows, originalRows, 'Persistence failure must restore the exact previous partial registry state')
    assert.deepEqual((await fs.readdir(dir)).filter(name => name.endsWith('.tmp')), [])
    await instance.dispose()
  }
  const badDirectory = await fixture('corrupt', Buffer.from([0xff, 0xfe, 0x7b]))
  const recover = createSettingsStore({ directory: badDirectory, contextMenu: registryStub() })
  assert.deepEqual(await recover.initialize(), DEFAULT_SETTINGS)
  assert(recover.getError())
  assert.deepEqual(await fs.readFile(path.join(badDirectory, 'settings.json')), Buffer.from([0xff, 0xfe, 0x7b]), 'Broken settings must not be overwritten silently')
  await recover.update({ imageQuality: 85 })
  assert.equal(recover.getError(), '')
  await recover.dispose()
  const largeDirectory = await fixture('oversize', ' '.repeat(65537))
  const large = createSettingsStore({ directory: largeDirectory, contextMenu: registryStub() })
  assert.deepEqual(await large.get(), DEFAULT_SETTINGS); assert(large.getError()); await large.dispose()
  const report = { defaultContextMenuOff: true, startupNeverChangesRegistry: true, utf8AndAtomicPersistence: true, deepPartialAndConcurrentUpdates: true, snapshotsIsolated: true, readsIgnorePendingWrites: true, validationRejectsUnknownKeys: true, registryBeforePersistence: true, exactRegistryRollbackOnDiskFailure: true, rollbackFailureReported: true, failedOperationsNeverBroadcastSuccess: true, corruptAndOversizeSettingsVisible: true, noTemporaryFiles: true }
  await fs.writeFile(path.join(root, 'regression.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
