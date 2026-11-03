'use strict'

/** A late crash from a discarded overlay must never cancel a newer session. */
function watchCaptureWindow(win, resolveCapture, getActiveSession, recover) {
  const recoverIfActive = reason => {
    const capture = resolveCapture()
    if (!capture || capture.session.finishing || capture.session !== getActiveSession()) return
    recover(capture.session, reason)
  }
  win.webContents.on('render-process-gone', (_event, details) => {
    recoverIfActive(`截图界面意外退出（${details.reason || '未知原因'}），已恢复原窗口，请重试`)
  })
  win.on('unresponsive', () => recoverIfActive('截图界面暂时失去响应，已恢复原窗口，请重试'))
}

module.exports = { watchCaptureWindow }
