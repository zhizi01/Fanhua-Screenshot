'use strict'
const { app, BrowserWindow, Menu, Tray, ipcMain, globalShortcut, desktopCapturer, screen, nativeImage, dialog, clipboard, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const { NativeHelper } = require('./native-helper.cjs')
const { watchCaptureWindow } = require('./capture-lifecycle.cjs')
const { selectionToPixels, intersectRect, decodePngDataUrl } = require('./geometry.cjs')

app.setName('繁花有图')
const APP_ID = 'cn.fanhua.screenshot'
const SHORTCUT = 'Alt+A'
const devUrl = !app.isPackaged && process.env.VITE_DEV_SERVER_URL
const helper = new NativeHelper()
const managedWindows = new Map()
const captures = new Map()
const previews = new Map()
let dashboard = null
let tray = null
let captureSession = null
let quitting = false
let shortcutRegistered = false
let fontsPromise = null

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function createIcon() {
  const size = 32
  const bitmap = Buffer.alloc(size * size * 4)
  const petals = Array.from({ length: 5 }, (_, i) => {
    const angle = i * Math.PI * 2 / 5 - Math.PI / 2
    return { x: 15.5 + Math.cos(angle) * 7.2, y: 15.5 + Math.sin(angle) * 7.2 }
  })
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4
    if (petals.some(p => Math.hypot(x - p.x, y - p.y) < 7)) {
      bitmap[index] = 210; bitmap[index + 1] = 96; bitmap[index + 2] = 120; bitmap[index + 3] = 255
    }
    if (Math.hypot(x - 15.5, y - 15.5) < 4.5) {
      bitmap[index] = 246; bitmap[index + 1] = 240; bitmap[index + 2] = 255; bitmap[index + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size, scaleFactor: 1 })
}

function makeWindow(view, options = {}) {
  const win = new BrowserWindow({
    width: 1140, height: 820, minWidth: 840, minHeight: 620,
    show: false, frame: false, backgroundColor: '#f6f5f8', title: '繁花有图',
    icon: createIcon(), autoHideMenuBar: true,
    ...options,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, spellcheck: false, backgroundThrottling: false,
    },
  })
  managedWindows.set(win.webContents.id, { win, view })
  win.setMenu(null)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  win.webContents.on('before-input-event', (event, input) => {
    if (view === 'capture' && input.key === 'Escape') { event.preventDefault(); cancelCapture() }
    if (input.type === 'keyDown' && (input.control || input.meta) && ['+', '-', '=', '0'].includes(input.key)) {
      // Browser zoom changes DIP mapping; image zoom is managed by the editor.
      event.preventDefault()
    }
  })
  const webContentsId = win.webContents.id
  if (view === 'capture') {
    watchCaptureWindow(win, () => captures.get(webContentsId), () => captureSession, (current, reason) => {
      finishSession(current)
      showError(new Error(reason))
    })
  }
  win.on('closed', () => {
    managedWindows.delete(webContentsId)
    previews.delete(webContentsId)
    const capture = captures.get(webContentsId)
    captures.delete(webContentsId)
    if (capture && captureSession === capture.session && !capture.session.finishing) cancelCapture()
  })
  return win
}

async function loadView(win, view) {
  if (devUrl) {
    const url = new URL(devUrl)
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('开发服务器必须使用本机地址')
    url.searchParams.set('view', view)
    await win.loadURL(url.toString())
  } else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view } })
}

async function openDashboard() {
  if (dashboard && !dashboard.isDestroyed()) {
    if (dashboard.isMinimized()) dashboard.restore()
    dashboard.show(); dashboard.focus()
    return
  }
  dashboard = makeWindow('dashboard', { width: 560, height: 460, minWidth: 480, minHeight: 420, maximizable: false })
  const win = dashboard
  win.on('close', event => {
    if (!quitting) { event.preventDefault(); win.hide() }
  })
  win.on('closed', () => { if (dashboard === win) dashboard = null })
  try {
    await loadView(win, 'dashboard')
    if (!win.isDestroyed()) { win.show(); win.focus() }
  } catch (error) {
    win.destroy()
    throw error
  }
}

function showError(error) {
  if (quitting) return
  const message = error instanceof Error ? error.message : String(error)
  void dialog.showMessageBox({ type: 'error', title: '繁花有图', message: '暂时无法完成操作', detail: message })
}

function updateTray() {
  if (!tray) return
  tray.setToolTip(`繁花有图 · ${shortcutRegistered ? 'Alt + A 截图' : '快捷键被占用'}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '开始截图', accelerator: SHORTCUT, click: () => void startCapture().catch(showError) },
    { label: '设置…', click: () => void openDashboard().catch(showError) },
    { label: '打开图片…', click: () => void openImage().catch(showError) },
    { type: 'separator' },
    { label: shortcutRegistered ? 'Alt + A 已启用' : 'Alt + A 被占用 · 点击重试', enabled: !shortcutRegistered, click: registerShortcut },
    { type: 'separator' },
    { label: '退出繁花有图', click: () => app.quit() },
  ]))
}

function registerShortcut() {
  if (globalShortcut.isRegistered(SHORTCUT)) shortcutRegistered = true
  else shortcutRegistered = globalShortcut.register(SHORTCUT, () => void startCapture().catch(showError))
  updateTray()
}

function appState() {
  return {
    shortcut: SHORTCUT, shortcutRegistered,
    launchAtLogin: app.isPackaged && process.platform === 'win32' ? app.getLoginItemSettings().openAtLogin : false,
    version: app.getVersion(), platform: process.platform,
  }
}

function finishSession(current, restoreWindows = true) {
  current.finishing = true
  clearTimeout(current.timer)
  if (current.escapeRegistered) globalShortcut.unregister('Escape')
  for (const item of current.windows) {
    captures.delete(item.webContentsId)
    item.resolveReady()
    if (!item.win.isDestroyed()) item.win.destroy()
  }
  current.windows.length = 0
  if (captureSession === current) captureSession = null
  if (restoreWindows) {
    for (const win of current.hiddenWindows) if (!win.isDestroyed()) win.showInactive()
    if (current.focusedWindow && !current.focusedWindow.isDestroyed()) current.focusedWindow.focus()
  }
}

function cancelCapture() {
  const current = captureSession
  if (current) finishSession(current)
}

async function startCapture() {
  if (captureSession || quitting) return
  const current = {
    id: randomUUID(), windows: [], finishing: false,
    hiddenWindows: BrowserWindow.getAllWindows().filter(win => win.isVisible()),
    focusedWindow: BrowserWindow.getFocusedWindow(),
    escapeRegistered: false, timer: null,
  }
  captureSession = current
  current.escapeRegistered = globalShortcut.register('Escape', cancelCapture)
  // Avoid capturing our own dashboard or existing pinned previews.
  for (const win of current.hiddenWindows) win.hide()
  current.timer = setTimeout(() => {
    if (captureSession !== current) return
    finishSession(current)
    showError(new Error('截图准备超时，请重试'))
  }, 20000)
  try {
    // Windows needs a composition frame after hiding a window.
    await delay(180)
    if (captureSession !== current) return
    const displays = screen.getAllDisplays()
    const nativeSize = {
      width: Math.max(...displays.map(display => Math.ceil(display.size.width * display.scaleFactor))),
      height: Math.max(...displays.map(display => Math.ceil(display.size.height * display.scaleFactor))),
    }
    const [sources, nativeWindows] = await Promise.all([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: nativeSize, fetchWindowIcons: false }),
      helper.request('windows', { excludeProcessId: process.pid }).then(data => ({ available: true, data }), () => ({ available: false, data: [] })),
    ])
    if (captureSession !== current) return
    for (const display of displays) {
      const source = sources.find(item => item.display_id === String(display.id)) || (displays.length === 1 && sources.length === 1 ? sources[0] : null)
      if (!source || source.thumbnail.isEmpty()) throw new Error('未能读取屏幕画面，请确认屏幕录制权限后重试')
      const image = source.thumbnail
      const pixelSize = image.getSize()
      const bounds = display.bounds
      // Clip in physical coordinates first: a window can span monitors with
      // different DPI factors, so converting its whole rect at once is wrong.
      const physicalBounds = process.platform === 'win32' ? screen.dipToScreenRect(null, bounds) : bounds
      const regions = nativeWindows.data.flatMap(item => {
        const intersection = intersectRect(item, physicalBounds)
        if (!intersection) return []
        return [{
          x: (intersection.x - physicalBounds.x) * bounds.width / physicalBounds.width,
          y: (intersection.y - physicalBounds.y) * bounds.height / physicalBounds.height,
          width: intersection.width * bounds.width / physicalBounds.width,
          height: intersection.height * bounds.height / physicalBounds.height,
          id: item.id, title: item.title,
        }]
      })
      const win = makeWindow('capture', {
        ...bounds, minWidth: 1, minHeight: 1, maxWidth: bounds.width, maxHeight: bounds.height,
        useContentSize: true, resizable: false, movable: false, minimizable: false, maximizable: false,
        alwaysOnTop: true, skipTaskbar: true, hasShadow: false, roundedCorners: false,
        enableLargerThanScreen: true, backgroundColor: '#14121a',
      })
      win.setBounds(bounds)
      win.setAlwaysOnTop(true, 'screen-saver')
      let resolveReady
      const ready = new Promise(resolve => { resolveReady = resolve })
      const context = {
        displayId: display.id, dataUrl: image.toDataURL(), width: bounds.width, height: bounds.height,
        pixelWidth: pixelSize.width, pixelHeight: pixelSize.height,
        windows: regions, windowDetectionAvailable: nativeWindows.available,
      }
      const item = { win, webContentsId: win.webContents.id, display, image, context, session: current, resolveReady, ready }
      captures.set(win.webContents.id, item)
      current.windows.push(item)
    }
    await Promise.all(current.windows.map(async item => {
      await loadView(item.win, 'capture')
      await item.ready
    }))
    if (captureSession !== current) return
    clearTimeout(current.timer)
    const activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    for (const item of current.windows) item.win.showInactive()
    const active = current.windows.find(item => item.display.id === activeDisplay.id) || current.windows[0]
    active.win.show(); active.win.focus()
  } catch (error) {
    if (captureSession === current) { finishSession(current); throw error }
  }
}

async function openPreview(image) {
  if (!image || image.isEmpty()) throw new Error('图片数据为空')
  const size = image.getSize()
  if (size.width * size.height > 100000000) throw new Error('图片尺寸过大，最多支持一亿像素')
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(display.workArea.width, Math.max(420, Math.min(1280, size.width + 32)))
  const height = Math.min(display.workArea.height, Math.max(260, Math.min(900, size.height + 132)))
  const win = makeWindow('preview', {
    width, height, minWidth: Math.min(360, display.workArea.width), minHeight: Math.min(240, display.workArea.height),
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - height) / 2),
  })
  previews.set(win.webContents.id, {
    id: randomUUID(), dataUrl: image.toDataURL(), width: size.width, height: size.height, createdAt: new Date().toISOString(),
  })
  try {
    await loadView(win, 'preview')
    if (!win.isDestroyed()) { win.show(); win.focus() }
  } catch (error) { win.destroy(); throw error }
}

async function openImage(parent) {
  const options = {
    title: '打开图片 · 繁花有图', properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return
  const stat = await fs.stat(result.filePaths[0])
  if (stat.size > 96 * 1024 * 1024) throw new Error('图片文件过大，请选择小于 96 MB 的图片')
  const image = nativeImage.createFromPath(result.filePaths[0])
  await openPreview(image)
}

function trustedHandler(channel, views, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    const entry = managedWindows.get(event.sender.id)
    if (!entry || entry.win.isDestroyed() || event.senderFrame !== event.sender.mainFrame || !views.includes(entry.view)) {
      throw new Error('不允许此窗口执行该操作')
    }
    return callback(entry.win, ...args)
  })
}

function installIpc() {
  const normal = ['dashboard', 'preview']
  trustedHandler('app:state', normal, appState)
  trustedHandler('app:dashboard', normal, openDashboard)
  trustedHandler('app:quit', ['dashboard'], () => app.quit())
  trustedHandler('window:hide', normal, win => win.hide())
  trustedHandler('window:minimize', normal, win => win.minimize())
  trustedHandler('window:close', normal, win => win.close())
  trustedHandler('app:launch-at-login', ['dashboard'], (_win, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('设置值无效')
    if (!app.isPackaged || process.platform !== 'win32') throw new Error('开机启动请在安装后的 Windows 应用中设置')
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
    return app.getLoginItemSettings().openAtLogin
  })
  trustedHandler('capture:start', normal, startCapture)
  trustedHandler('capture:context', ['capture'], win => {
    const item = captures.get(win.webContents.id)
    if (!item || captureSession !== item.session) throw new Error('截图会话已结束')
    return item.context
  })
  trustedHandler('capture:ready', ['capture'], win => {
    const item = captures.get(win.webContents.id)
    if (item) item.resolveReady()
  })
  trustedHandler('capture:cancel', ['capture'], cancelCapture)
  trustedHandler('capture:complete', ['capture'], async (win, rect) => {
    const item = captures.get(win.webContents.id)
    if (!item || captureSession !== item.session) throw new Error('截图会话已结束')
    const pixels = selectionToPixels(rect, item.display.bounds, item.image.getSize())
    const image = item.image.crop(pixels)
    finishSession(item.session)
    await openPreview(image)
  })
  trustedHandler('preview:get', ['preview'], win => {
    const data = previews.get(win.webContents.id)
    if (!data) throw new Error('图片已关闭')
    return data
  })
  trustedHandler('preview:pin', ['preview'], (win, pinned) => {
    if (typeof pinned !== 'boolean') throw new Error('固定状态无效')
    // On Windows, use the native topmost flag without taskbar-relative ordering.
    // The "floating" level can lose topmost status on Windows 11 desktops.
    win.setAlwaysOnTop(pinned, process.platform === 'win32' ? 'normal' : 'floating')
    const actual = win.isAlwaysOnTop()
    if (actual !== pinned) throw new Error('系统未能更新窗口置顶状态，请重试')
    return actual
  })
  trustedHandler('preview:editing', ['preview'], (win, editing) => {
    if (typeof editing !== 'boolean') throw new Error('编辑状态无效')
    const bounds = win.getBounds()
    const work = screen.getDisplayMatching(bounds).workArea
    const minWidth = Math.min(editing ? 760 : 360, work.width)
    const minHeight = Math.min(editing ? 500 : 240, work.height)
    win.setMinimumSize(minWidth, minHeight)
    if (editing) {
      const width = Math.max(minWidth, Math.min(bounds.width, work.width))
      const height = Math.max(minHeight, Math.min(bounds.height, work.height))
      win.setBounds({ width, height, x: Math.max(work.x, Math.min(bounds.x, work.x + work.width - width)), y: Math.max(work.y, Math.min(bounds.y, work.y + work.height - height)) })
    }
  })
  trustedHandler('image:save', ['preview'], async (win, dataUrl) => {
    const buffer = decodePngDataUrl(dataUrl)
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) throw new Error('图片解码失败')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const result = await dialog.showSaveDialog(win, {
      title: '保存图片 · 繁花有图', defaultPath: path.join(app.getPath('pictures'), `繁花有图-${timestamp}.png`),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    // Re-encode to strip untrusted metadata before writing a renderer-supplied PNG.
    await fs.writeFile(result.filePath, image.toPNG())
    return { canceled: false, filePath: result.filePath }
  })
  trustedHandler('image:copy', ['preview'], (_win, dataUrl) => {
    const image = nativeImage.createFromBuffer(decodePngDataUrl(dataUrl))
    if (image.isEmpty()) throw new Error('图片解码失败')
    clipboard.writeImage(image)
  })
  trustedHandler('image:open', normal, openImage)
  trustedHandler('app:fonts', normal, async () => {
    if (!fontsPromise) fontsPromise = helper.request('fonts').catch(() => {
      fontsPromise = null
      return ['Microsoft YaHei UI', 'Microsoft YaHei', 'SimSun', 'SimHei', 'Segoe UI', 'Arial']
    })
    return fontsPromise
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => void openDashboard().catch(showError))
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    installIpc()
    tray = new Tray(createIcon())
    tray.on('double-click', () => void openDashboard().catch(showError))
    registerShortcut()
    void helper.start().catch(() => { /* Manual area capture remains available. */ })
    screen.on('display-removed', cancelCapture)
    screen.on('display-added', cancelCapture)
    screen.on('display-metrics-changed', cancelCapture)
    if (process.argv.includes('--show-window')) await openDashboard()
  }).catch(showError)
  app.on('window-all-closed', () => { /* Keep the tray and global shortcut alive. */ })
  app.on('activate', () => void openDashboard().catch(showError))
  app.on('before-quit', () => {
    quitting = true
    if (captureSession) finishSession(captureSession, false)
    helper.stop()
    globalShortcut.unregisterAll()
    if (tray) tray.destroy()
    tray = null
  })
}
