'use strict'
const assert = require('node:assert/strict')
const { createLoginItemService } = require('../electron/login-item.cjs')
const executable = 'C:\\Program Files\\繁花有图\\繁花有图.exe'
let state = { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] }, requested, query, blocked = false, readFailure = false, otherEntry = false
const app = {
  isPackaged: true,
  getLoginItemSettings(options) { query = options; if (readFailure) throw new Error('denied'); return state },
  setLoginItemSettings(options) {
    requested = options
    state = { openAtLogin: options.openAtLogin, executableWillLaunchAtLogin: otherEntry || (options.openAtLogin && !blocked), launchItems: options.openAtLogin ? [{ path: executable, enabled: !blocked }] : [] }
  },
}
const service = createLoginItemService({ app, executable, platform: 'win32' })
assert.equal(service.getState().enabled, false)
assert.deepEqual(query, { path: executable, args: [] })
assert.equal(service.setEnabled(true), true)
assert.deepEqual(requested, { path: executable, args: [], openAtLogin: true })
assert.equal(service.setEnabled(false), false)
blocked = true
assert.throws(() => service.setEnabled(true), /Windows 禁用/)
assert.equal(state.openAtLogin, true)
assert.equal(service.getState().enabled, false, 'A Run key disabled in Task Manager must not be reported as enabled')
assert.match(service.getState().reason, /任务管理器/)
state = { openAtLogin: true, launchItems: [{ path: executable, enabled: false }, { path: 'C:\\another.exe', enabled: true }] }
assert.equal(service.getState().enabled, false, 'Unrelated enabled startup items must not enable this app')
state = { openAtLogin: false, launchItems: [{ path: executable.toUpperCase(), enabled: true }] }
assert.equal(service.getState().enabled, true)
state = { openAtLogin: true }
assert.equal(service.getState().readable, false, 'Missing OS approval information must be reported as unknown')
readFailure = true
assert.equal(service.getState().readable, false)
assert.throws(() => service.setEnabled(false), /无法读取/)
readFailure = false; blocked = false; otherEntry = true
assert.throws(() => service.setEnabled(false), /其他启动项/)
assert.throws(() => service.setEnabled('false'), /设置值无效/)
const development = createLoginItemService({ app: { isPackaged: false }, executable, platform: 'win32' })
assert.equal(development.getState().enabled, false)
assert.throws(() => development.setEnabled(true), /安装后的/)
console.log(JSON.stringify({ realStartupApprovalRespected: true, disabledByTaskManagerReported: true, pathAndArgumentsMatch: true, setterChecksActualResult: true, otherEntriesNotClaimedDisabled: true, readFailuresNotClaimedSuccessful: true, developmentChangesBlocked: true, realSystemUnchanged: true }, null, 2))
