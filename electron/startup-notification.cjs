'use strict'
const { formatShortcut } = require('./shortcut.cjs')

function startupBody(shortcut = 'Alt+A', registered = true) {
  const label = formatShortcut(shortcut)
  return registered
    ? `Hello，现在繁花有图已经在你的设备中完成了准备，随时可以通过${label} 发起截图。在不需要我的时候，我会一直休眠哦~`
    : `Hello，现在繁花有图已经在你的设备中完成了准备。${label} 暂时无法启用，你可以通过托盘菜单发起截图，或在设置中重试快捷键。在不需要我的时候，我会一直休眠哦~`
}
const STARTUP_BODY = startupBody()
const UNAVAILABLE_BODY = startupBody('Alt+A', false)

function createStartupNotifier({ Notification, openSettings, icon, onError = () => {} }) {
  let attempted = false, disposed = false, notification
  function report(error) { try { onError(error) } catch { /* Notifications never interrupt startup. */ } }
  return {
    show({ enabled, shortcutRegistered, shortcut = 'Alt+A' }) {
      if (attempted || disposed) return false
      attempted = true
      if (!enabled) return false
      try {
        if (!Notification.isSupported()) return false
        notification = new Notification({ id: 'startup', groupId: 'fanhua', title: '繁花有图', body: startupBody(shortcut, shortcutRegistered), icon, silent: true })
        notification.on('click', () => { if (!disposed) Promise.resolve().then(openSettings).catch(report) })
        notification.on('failed', (_event, error) => report(error || new Error('系统未能显示启动通知')))
        notification.show()
        return true
      } catch (error) { report(error); return false }
    },
    dispose() {
      disposed = true
      try { notification?.close() } catch (error) { report(error) }
      notification = undefined
    },
  }
}

module.exports = { createStartupNotifier, startupBody, STARTUP_BODY, UNAVAILABLE_BODY }
