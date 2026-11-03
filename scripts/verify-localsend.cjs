'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { createLocalSendService, validExecutable } = require('../electron/localsend.cjs')

const project = path.resolve(__dirname, '..')
const artifacts = path.join(project, 'artifacts')
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGQAAAABJRU5ErkJggg=='

async function main() {
  await fs.mkdir(artifacts, { recursive: true })
  const fixture = await fs.mkdtemp(path.join(artifacts, 'localsend-check-'))
  const temp = path.join(fixture, 'temp'), userData = path.join(fixture, 'user')
  const executable = path.join(fixture, 'portable 中文 & app', 'localsend_app.exe')
  const sharedDirectory = path.join(temp, 'fanhua-localsend')
  await fs.mkdir(path.dirname(executable), { recursive: true })
  await fs.writeFile(executable, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(62)]))
  const nativeImage = { createFromBuffer: () => ({ isEmpty: () => false }) }
  const app = { getPath: name => name === 'temp' ? temp : userData }
  const launches = []
  const spawnProcess = (command, args, options) => {
    launches.push({ command, args, options })
    const child = new EventEmitter()
    child.unref = () => {}
    queueMicrotask(() => { child.emit('spawn'); child.emit('exit', 0, null) })
    return child
  }
  const options = { app, nativeImage, platform: 'win32', spawnProcess, discover: async () => executable }
  const none = { showOpenDialog: async () => { throw Error('unexpected dialog') } }
  try {
    assert.equal(await validExecutable(executable), true)
    assert.equal(await validExecutable('localsend_app.exe'), false)
    assert.equal(await validExecutable(path.join(path.dirname(executable), 'unins000.exe')), false)
    const service = createLocalSendService({ ...options, dialog: none })
    await service.initialize()
    const staleName = `繁花有图-20200101000000-${randomUUID()}.png`
    const freshName = `繁花有图-20200101000000-${randomUUID()}.png`
    const stale = path.join(sharedDirectory, staleName), fresh = path.join(sharedDirectory, freshName)
    const foreign = path.join(sharedDirectory, 'user-photo.png')
    await Promise.all([fs.writeFile(stale, 'old'), fs.writeFile(fresh, 'fresh'), fs.writeFile(foreign, 'do not delete')])
    const old = new Date(Date.now() - 8 * 86400000)
    await Promise.all([fs.utimes(stale, old, old), fs.utimes(foreign, old, old)])
    await service.initialize()
    await assert.rejects(fs.stat(stale), { code: 'ENOENT' })
    assert.equal(await fs.readFile(foreign, 'utf8'), 'do not delete')
    assert.equal(await fs.readFile(fresh, 'utf8'), 'fresh')
    const result = await service.share({ isDestroyed: () => false }, png)
    assert.equal(result.canceled, false)
    assert.equal(launches.length, 1)
    assert.equal(launches[0].command, executable)
    assert.deepEqual(launches[0].args, [path.join(sharedDirectory, result.fileName)])
    assert.equal(launches[0].options.shell, false)
    assert.equal(launches[0].options.windowsHide, true)
    assert.equal(launches[0].options.cwd, path.dirname(executable))
    assert.deepEqual(await fs.readFile(launches[0].args[0]), Buffer.from(png.split(',')[1], 'base64'))
    await assert.rejects(service.share({}, 'data:image/jpeg;base64,AA=='), /PNG/)

    let selections = 0
    const dialog = { showOpenDialog: async () => { selections++; return { canceled: false, filePaths: [executable] } } }
    const selected = createLocalSendService({ ...options, dialog, discover: async () => null })
    assert.deepEqual(await selected.getSettings(), { executable: null })
    await assert.rejects(selected.share({}, png), /设置 → 共享/)
    assert.equal(selections, 0, 'Sharing must not open the preferences picker')
    assert.deepEqual(await selected.chooseExecutable({}), { executable })
    assert.equal(selections, 1)
    assert.equal(JSON.parse(await fs.readFile(path.join(userData, 'localsend.json'), 'utf8')).executable, executable)
    await createLocalSendService({ ...options, dialog: none, discover: async () => { throw Error('must use remembered program') } }).share({}, png)
    await fs.rename(executable, `${executable}.moved`)
    await assert.rejects(selected.share({}, png), /已失效/)
    assert.deepEqual(await selected.getSettings(), { executable }, 'Stale manual paths stay visible for correction')
    await fs.rename(`${executable}.moved`, executable)
    assert.deepEqual(await selected.resetExecutable(), { executable: null })
    await assert.rejects(selected.share({}, png), /设置 → 共享/)
    await fs.writeFile(path.join(userData, 'localsend.json'), '{broken')
    await assert.rejects(selected.getSettings(), /无法读取/)
    await assert.rejects(selected.share({}, png), /无法读取/)
    await selected.resetExecutable()
    assert.deepEqual(await selected.getSettings(), { executable: null })

    const canceledApp = { getPath: name => path.join(fixture, `cancel-${name}`) }
    const canceled = createLocalSendService({ ...options, app: canceledApp, discover: async () => null, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } })
    const before = launches.length
    assert.equal(await canceled.chooseExecutable({}), null)
    assert.equal(launches.length, before)
    await assert.rejects(fs.stat(canceledApp.getPath('temp')), { code: 'ENOENT' })

    const failed = createLocalSendService({ ...options, dialog: none, spawnProcess: () => {
      const child = new EventEmitter(); child.unref = () => {}
      queueMicrotask(() => child.emit('error', new Error('test failure')))
      return child
    } })
    const beforeFailure = await fs.readdir(sharedDirectory)
    await assert.rejects(failed.share({}, png), /无法启动 LocalSend/)
    assert.deepEqual(await fs.readdir(sharedDirectory), beforeFailure)

    let release
    const blocked = createLocalSendService({ ...options, app: canceledApp, dialog: none, discover: () => new Promise(resolve => { release = resolve }) })
    const pending = blocked.share({}, png)
    await assert.rejects(blocked.share({}, png), /正在准备/)
    while (!release) await new Promise(resolve => setTimeout(resolve, 1))
    release(executable)
    await pending

    const report = { passed: true, shellFreePathArgument: true, pngBytesPreserved: true, existingInstanceExitAccepted: true, portablePathRemembered: true, settingsOnlyPicker: true, stalePathReported: true, corruptSettingsReportedAndRecoverable: true, resetToAutomatic: true, canceledWithoutExport: true, failedLaunchRemovedFile: true, onlyExpiredOwnFilesCleaned: true, concurrentRequestsRejected: true }
    await fs.writeFile(path.join(artifacts, 'localsend-verification.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  } finally {
    // Only the fresh test directory created above may be recursively removed.
    const resolved = path.resolve(fixture)
    assert.equal(path.dirname(resolved), artifacts)
    assert(path.basename(resolved).startsWith('localsend-check-'))
    await fs.rm(resolved, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
