'use strict'
const path = require('node:path')

function createLoginItemService({ app, platform = process.platform, executable = process.execPath }) {
  const available = platform === 'win32' && !!app.isPackaged
  const options = { path: executable, args: [] }
  const normalized = path.win32.normalize(executable).toLowerCase()
  function getState() {
    if (!available) return { enabled: false, readable: true, reason: '开机启动请在安装后的 Windows 应用中设置' }
    try {
      const state = app.getLoginItemSettings(options)
      const matching = Array.isArray(state.launchItems) ? state.launchItems.filter(item => typeof item.path === 'string' && path.win32.normalize(item.path).toLowerCase() === normalized) : []
      // openAtLogin only describes the Run entry. Windows Task Manager can
      // independently disable that entry through StartupApproved.
      const known = typeof state.executableWillLaunchAtLogin === 'boolean' || Array.isArray(state.launchItems)
      if (!known) return { enabled: false, readable: false, reason: '无法确认 Windows 开机启动状态，请稍后重试' }
      const enabled = typeof state.executableWillLaunchAtLogin === 'boolean' ? state.executableWillLaunchAtLogin : matching.some(item => item.enabled === true)
      const registered = state.openAtLogin || matching.length > 0
      return { enabled, readable: true, ...(!enabled && registered ? { reason: '启动项已被 Windows 禁用，请在任务管理器 → 启动应用中启用繁花有图' } : {}) }
    } catch { return { enabled: false, readable: false, reason: '无法读取 Windows 开机启动状态，请检查系统权限后重试' } }
  }
  function setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('开机启动设置值无效')
    if (!available) throw new Error('开机启动请在安装后的 Windows 应用中设置')
    try { app.setLoginItemSettings({ ...options, openAtLogin: enabled }) }
    catch { throw new Error('无法修改开机启动设置，请检查系统权限后重试') }
    const actual = getState()
    if (!actual.readable) throw new Error(actual.reason)
    if (actual.enabled !== enabled) throw new Error(actual.reason || (enabled ? '系统未能启用开机启动，请重试' : '其他启动项仍会启动本程序，请在任务管理器 → 启动应用中检查'))
    return actual.enabled
  }
  return { getState, setEnabled }
}

module.exports = { createLoginItemService }
