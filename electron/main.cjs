'use strict'
const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, globalShortcut, desktopCapturer, screen, nativeImage, dialog, clipboard, ClipboardItem, session, utilityProcess } = require('electron')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { NativeHelper } = require('./native-helper.cjs')
const { watchCaptureWindow } = require('./capture-lifecycle.cjs')
const { createFeatureHandlers } = require('./features.cjs')
const { createTranslationService } = require('./translation.cjs')
const { createImageClipboard } = require('./image-clipboard.cjs')
const { createLocalSendService } = require('./localsend.cjs')
const { OPEN_EXTENSIONS, parseEditImageArgs, readPreviewFile } = require('./image-open.cjs')
const { createPdfService } = require('./pdf.cjs')
const { createSettingsStore } = require('./settings.cjs')
const { createContextMenuService } = require('./context-menu.cjs')
const { createStartupNotifier } = require('./startup-notification.cjs')
const { createLoginItemService } = require('./login-item.cjs')
const { selectionToPixels, intersectRect } = require('./geometry.cjs')

app.setName('繁花有图')
const APP_ID = 'cn.fanhua.screenshot'
const SHORTCUT = 'Alt+A'
const devUrl = !app.isPackaged && process.env.VITE_DEV_SERVER_URL
const helper = new NativeHelper()
const managedWindows = new Map()
const captures = new Map()
const previews = new Map()
const overlayPool = new Map()
const features = createFeatureHandlers({ app, dialog, nativeImage, clipboard, helper })
const imageClipboard = createImageClipboard({ clipboard, ClipboardItem, nativeImage })
const localSend = createLocalSendService({ app, dialog, nativeImage })
const pdfService = createPdfService({ app, dialog })
const contextMenu = createContextMenuService({ app })
const settingsStore = createSettingsStore({ directory: app.getPath('userData'), contextMenu, onChanged: broadcastSettings })
const loginItem = createLoginItemService({ app })
const translation = createTranslationService({
  modelRoot: app.isPackaged ? path.join(process.resourcesPath, 'translation') : path.join(__dirname, '..', 'resources', 'translation'),
  forkProcess: (file, options) => utilityProcess.fork(file, [], options),
})
let settingsWindow = null
let startupNotifier = null
let tray = null
let captureSession = null
let quitting = false
let shutdownReady = false
let shortcutRegistered = false
let poolRefreshTimer = null

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
  win.webContents.on('render-process-gone', () => {
    translation.cancelOwner(webContentsId)
    void pdfService.cancelOwner(webContentsId).catch(console.error)
  })
  if (view === 'capture') {
    watchCaptureWindow(win, () => captures.get(webContentsId), () => captureSession, (current, reason) => {
      finishSession(current)
      showError(new Error(reason))
    })
  }
  win.on('closed', () => {
    translation.cancelOwner(webContentsId)
    void pdfService.cancelOwner(webContentsId).catch(console.error)
    managedWindows.delete(webContentsId)
    previews.delete(webContentsId)
    const capture = captures.get(webContentsId)
    captures.delete(webContentsId)
    if (capture && captureSession === capture.session && !capture.session.finishing) cancelCapture()
    for (const [id, pooled] of overlayPool) if (pooled.win === win) overlayPool.delete(id)
  })
  if (view === 'capture') {
    // Discard a stalled renderer as well as a crashed one. Reusing it would
    // otherwise make every later session time out waiting for capture:ready.
    const discardOverlay = () => {
      for (const [id, pooled] of overlayPool) if (pooled.win === win) overlayPool.delete(id)
      if (!win.isDestroyed()) win.destroy()
    }
    win.webContents.on('render-process-gone', discardOverlay)
    win.on('unresponsive', discardOverlay)
  } else if (view === 'settings') {
    const discardSettings = () => { if (!win.isDestroyed()) win.destroy() }
    win.webContents.on('render-process-gone', discardSettings)
    win.on('unresponsive', discardSettings)
  }
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

async function openSettings() {
  if (quitting) return
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show(); settingsWindow.focus()
    return
  }
  const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = Math.min(660, work.width), height = Math.min(640, work.height)
  settingsWindow = makeWindow('settings', {
    width, height, minWidth: Math.min(480, work.width), minHeight: Math.min(420, work.height), maximizable: false,
    x: Math.round(work.x + (work.width - width) / 2), y: Math.round(work.y + (work.height - height) / 2),
  })
  const win = settingsWindow
  win.on('closed', () => { if (settingsWindow === win) settingsWindow = null })
  try {
    await loadView(win, 'settings')
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
  tray.setToolTip(`繁花有图 · ${shortcutRegistered ? 'Alt + A 截图' : '快捷键未启用'}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '开始截图', accelerator: SHORTCUT, click: () => void startCapture().catch(showError) },
    { label: '设置…', click: () => void openSettings().catch(showError) },
    { label: '打开图片 / PDF…', click: () => void openImage().catch(showError) },
    { type: 'separator' },
    { label: shortcutRegistered ? 'Alt + A 已启用' : 'Alt + A 未启用 · 点击重试', enabled: !shortcutRegistered, click: registerShortcut },
    { type: 'separator' },
    { label: '退出繁花有图', click: () => app.quit() },
  ]))
}

function registerShortcut() {
  try {
    if (globalShortcut.isRegistered(SHORTCUT)) shortcutRegistered = true
    else shortcutRegistered = globalShortcut.register(SHORTCUT, () => void startCapture().catch(showError))
  } catch { shortcutRegistered = false }
  updateTray()
}

function broadcastSettings(settings) {
  for (const { win, view } of managedWindows.values()) {
    if (['settings', 'preview'].includes(view) && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      try { win.webContents.send('settings:changed', settings) } catch { /* Window closed during broadcast. */ }
    }
  }
}

async function appState() {
  let contextMenuState
  try { contextMenuState = await contextMenu.getState() }
  catch (error) { contextMenuState = { available: false, enabled: false, registered: 0, total: 6, legacyMachine: false, conflict: false, reason: error instanceof Error ? error.message : '无法读取右键菜单状态' } }
  const login = loginItem.getState()
  return {
    shortcut: SHORTCUT, shortcutRegistered,
    launchAtLogin: login.enabled, ...(login.reason ? { launchAtLoginReason: login.reason } : {}), version: app.getVersion(), platform: process.platform, isPackaged: app.isPackaged,
    contextMenu: contextMenuState, ...(settingsStore.getError() ? { settingsError: settingsStore.getError() } : {}),
  }
}

function ensureOverlay(display) {
  const old = overlayPool.get(display.id)
  if (old && !old.win.isDestroyed()) return old
  const bounds = display.bounds
  const win = makeWindow('capture', {
    ...bounds, minWidth: 1, minHeight: 1, maxWidth: bounds.width, maxHeight: bounds.height,
    useContentSize: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, roundedCorners: false,
    enableLargerThanScreen: true, backgroundColor: '#00000000', transparent: true,
  })
  win.setBounds(bounds)
  win.setAlwaysOnTop(true, 'screen-saver')
  const pooled = { win, loaded: null }
  overlayPool.set(display.id, pooled)
  pooled.loaded = loadView(win, 'capture').catch(error => {
    if (overlayPool.get(display.id) === pooled) overlayPool.delete(display.id)
    if (!win.isDestroyed()) win.destroy()
    throw error
  })
  // Prewarming is optional; a failed preload is retried by the next capture.
  pooled.loaded.catch(() => {})
  return pooled
}

function warmOverlays() {
  if (quitting) return
  for (const display of screen.getAllDisplays()) ensureOverlay(display)
}

function displaysChanged() {
  cancelCapture()
  for (const pooled of overlayPool.values()) if (!pooled.win.isDestroyed()) pooled.win.destroy()
  overlayPool.clear()
  clearTimeout(poolRefreshTimer)
  poolRefreshTimer = setTimeout(warmOverlays, 250)
}

function finishSession(current, restoreWindows = true) {
  current.finishing = true
  clearTimeout(current.timer)
  if (current.escapeRegistered) globalShortcut.unregister('Escape')
  for (const item of current.windows) {
    captures.delete(item.webContentsId)
    item.resolveReady()
    if (!item.win.isDestroyed()) {
      item.win.hide()
      item.win.webContents.send('capture:context-changed', null)
    }
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

async function startCapture(originWindow) {
  if (captureSession || quitting) return
  const current = {
    id: randomUUID(), windows: [], finishing: false,
    hiddenWindows: originWindow instanceof BrowserWindow && originWindow.isVisible() ? [originWindow] : [],
    focusedWindow: BrowserWindow.getFocusedWindow(),
    escapeRegistered: false, timer: null,
  }
  captureSession = current
  current.escapeRegistered = globalShortcut.register('Escape', cancelCapture)
  // A hotkey keeps the current desktop intact. Only an explicitly clicked
  // settings/preview window is hidden before taking the frozen background.
  for (const win of current.hiddenWindows) win.hide()
  current.timer = setTimeout(() => {
    if (captureSession !== current) return
    finishSession(current)
    showError(new Error('截图准备超时，请重试'))
  }, 20000)
  try {
    // Windows needs a composition frame after hiding a window.
    if (current.hiddenWindows.length) await delay(65)
    if (captureSession !== current) return
    const displays = screen.getAllDisplays()
    const nativeSize = {
      width: Math.max(...displays.map(display => Math.ceil(display.size.width * display.scaleFactor))),
      height: Math.max(...displays.map(display => Math.ceil(display.size.height * display.scaleFactor))),
    }
    const [sources, nativeWindows] = await Promise.all([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: nativeSize, fetchWindowIcons: false }),
      // Pooled overlays are hidden here and filtered by IsWindowVisible.
      // Visible pinned previews must remain eligible for window snapping.
      helper.request('windows').then(data => ({ available: true, data }), () => ({ available: false, data: [] })),
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
      const pooled = ensureOverlay(display)
      const win = pooled.win
      let resolveReady
      const ready = new Promise(resolve => { resolveReady = resolve })
      const context = {
        sessionId: current.id,
        cursor: { x: screen.getCursorScreenPoint().x - bounds.x, y: screen.getCursorScreenPoint().y - bounds.y },
        displayId: display.id, dataUrl: image.toDataURL(), width: bounds.width, height: bounds.height,
        pixelWidth: pixelSize.width, pixelHeight: pixelSize.height,
        windows: regions, windowDetectionAvailable: nativeWindows.available,
      }
      const item = { win, webContentsId: win.webContents.id, display, image, context, session: current, resolveReady, ready, loaded: pooled.loaded }
      captures.set(win.webContents.id, item)
      current.windows.push(item)
    }
    await Promise.all(current.windows.map(async item => {
      await item.loaded
      if (captureSession !== current || item.win.isDestroyed()) return
      item.win.webContents.send('capture:context-changed', item.context)
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

async function openPreview(image, { editing = false } = {}) {
  if (!image || image.isEmpty()) throw new Error('图片数据为空')
  const size = image.getSize()
  if (size.width * size.height > 100000000) throw new Error('图片尺寸过大，最多支持一亿像素')
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(display.workArea.width, Math.max(editing ? 760 : 420, Math.min(1280, size.width + 32)))
  const height = Math.min(display.workArea.height, Math.max(editing ? 500 : 260, Math.min(900, size.height + 132)))
  const win = makeWindow('preview', {
    width, height, minWidth: Math.min(editing ? 760 : 360, display.workArea.width), minHeight: Math.min(editing ? 500 : 240, display.workArea.height),
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - height) / 2),
  })
  previews.set(win.webContents.id, {
    id: randomUUID(), dataUrl: image.toDataURL(), width: size.width, height: size.height, createdAt: new Date().toISOString(), initialEditing: editing,
  })
  try {
    await loadView(win, 'preview')
    if (!win.isDestroyed()) { win.show(); win.focus() }
  } catch (error) { win.destroy(); throw error }
}

async function openImage(parent) {
  const options = {
    title: '打开图片或 PDF · 繁花有图', properties: ['openFile'],
    filters: [{ name: '图片和 PDF', extensions: OPEN_EXTENSIONS }, { name: 'PDF 文档', extensions: ['pdf'] }],
  }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return
  await openPreviewDocument(await readPreviewFile(result.filePaths[0], nativeImage))
}

async function openPreviewDocument(document, { editing = false } = {}) {
  if (!document.pdf) return openPreview(document.image, { editing })
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(display.workArea.width, 1000), height = Math.min(display.workArea.height, 800)
  const win = makeWindow('preview', {
    width, height, minWidth: Math.min(760, display.workArea.width), minHeight: Math.min(500, display.workArea.height),
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - height) / 2),
  })
  previews.set(win.webContents.id, {
    id: randomUUID(), dataUrl: '', width: 0, height: 0, createdAt: new Date().toISOString(), initialEditing: editing, pdf: document.pdf,
  })
  try {
    await loadView(win, 'preview')
    if (!win.isDestroyed()) { win.show(); win.focus() }
  } catch (error) { win.destroy(); throw error }
}

async function handleLaunch(argv, secondary = false) {
  const file = parseEditImageArgs(argv)
  if (file) {
    const document = await readPreviewFile(file, nativeImage)
    if (captureSession) finishSession(captureSession)
    await openPreviewDocument(document, { editing: true })
  } else if (secondary || argv.includes('--show-window') || argv.includes('--show-settings')) await openSettings()
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

function resizePreview(win, layout) {
  if (!layout || typeof layout.editing !== 'boolean' || typeof layout.ocr !== 'boolean') throw new Error('窗口布局无效')
  const { editing, ocr } = layout
  const pdf = !!previews.get(win.webContents.id)?.pdf
  const bounds = win.getBounds()
  const work = screen.getDisplayMatching(bounds).workArea
  const minWidth = Math.min(editing && ocr ? 1040 : editing || pdf ? 760 : ocr ? 720 : 360, work.width)
  const minHeight = Math.min(editing && ocr ? 540 : editing || ocr || pdf ? 500 : 240, work.height)
  win.setMinimumSize(minWidth, minHeight)
  if (editing || ocr) {
    const width = Math.max(minWidth, Math.min(bounds.width, work.width))
    const height = Math.max(minHeight, Math.min(bounds.height, work.height))
    win.setBounds({ width, height, x: Math.max(work.x, Math.min(bounds.x, work.x + work.width - width)), y: Math.max(work.y, Math.min(bounds.y, work.y + work.height - height)) })
  }
}

function installIpc() {
  const normal = ['settings', 'preview']
  trustedHandler('app:state', normal, appState)
  trustedHandler('app:settings', normal, openSettings)
  trustedHandler('settings:get', normal, () => settingsStore.get())
  trustedHandler('settings:update', ['settings'], (_win, patch) => settingsStore.update(patch))
  trustedHandler('app:retry-shortcut', ['settings'], () => { registerShortcut(); return appState() })
  trustedHandler('app:quit', ['settings'], () => app.quit())
  trustedHandler('window:hide', normal, win => win.hide())
  trustedHandler('window:minimize', normal, win => win.minimize())
  trustedHandler('window:close', normal, win => win.close())
  trustedHandler('app:launch-at-login', ['settings'], (_win, enabled) => loginItem.setEnabled(enabled))
  trustedHandler('capture:start', normal, startCapture)
  trustedHandler('capture:context', ['capture'], win => {
    const item = captures.get(win.webContents.id)
    return item && captureSession === item.session ? item.context : null
  })
  trustedHandler('capture:ready', ['capture'], (win, sessionId) => {
    const item = captures.get(win.webContents.id)
    if (item && item.context.sessionId === sessionId) item.resolveReady()
  })
  trustedHandler('capture:cancel', ['capture'], (win, sessionId) => {
    const item = captures.get(win.webContents.id)
    if (item && item.context.sessionId === sessionId) cancelCapture()
  })
  trustedHandler('capture:complete', ['capture'], async (win, rect, sessionId) => {
    const item = captures.get(win.webContents.id)
    if (!item || captureSession !== item.session || item.context.sessionId !== sessionId) throw new Error('截图会话已结束')
    const pixels = selectionToPixels(rect, item.display.bounds, item.image.getSize())
    const image = item.image.crop(pixels)
    finishSession(item.session)
    await openPreview(image, { editing: settingsStore.snapshot().captureOpenEditor })
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
    resizePreview(win, { editing, ocr: false })
  })
  trustedHandler('preview:layout', ['preview'], resizePreview)
  trustedHandler('image:save', ['preview'], (win, dataUrl, options) => features.saveImage(win, dataUrl, options))
  trustedHandler('pdf:begin-save', ['preview'], (win, options) => pdfService.begin(win, options))
  trustedHandler('pdf:append-page', ['preview'], (win, jobId, page) => pdfService.append(win, jobId, page))
  trustedHandler('pdf:finish-save', ['preview'], (win, jobId) => pdfService.finish(win, jobId))
  trustedHandler('pdf:cancel-save', ['preview'], (win, jobId) => pdfService.cancel(win, jobId))
  trustedHandler('image:copy', ['preview'], (_win, dataUrl, mode) => imageClipboard.copy(dataUrl, mode))
  trustedHandler('localsend:share', ['preview'], (win, dataUrl) => localSend.share(win, dataUrl))
  trustedHandler('localsend:settings', ['settings'], () => localSend.getSettings())
  trustedHandler('localsend:choose-executable', ['settings'], win => localSend.chooseExecutable(win))
  trustedHandler('localsend:reset-executable', ['settings'], () => localSend.resetExecutable())
  trustedHandler('image:open', normal, openImage)
  trustedHandler('app:fonts', normal, (_win, refresh) => features.getFonts(refresh))
  trustedHandler('ocr:capabilities', normal, () => features.getOcrCapabilities())
  trustedHandler('ocr:recognize', ['preview'], (win, dataUrl, language) => features.recognizeText(win, dataUrl, language))
  trustedHandler('translation:capabilities', normal, () => translation.getCapabilities())
  trustedHandler('translation:translate', ['preview'], (win, request) => translation.translate(request, {
    ownerId: win.webContents.id,
    onProgress: progress => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('translation:progress', progress)
    },
  }))
  trustedHandler('translation:cancel', ['preview'], (win, requestId) => translation.cancel(requestId, win.webContents.id))
  trustedHandler('text:copy', ['preview'], (_win, text) => features.copyText(text))
  trustedHandler('watermark:choose-image', ['preview'], win => features.chooseWatermarkImage(win))
  trustedHandler('watermark:list-presets', ['preview'], () => features.listWatermarkPresets())
  trustedHandler('watermark:save-preset', ['preview'], (_win, preset) => features.saveWatermarkPreset(preset))
  trustedHandler('watermark:delete-preset', ['preview'], (_win, id) => features.deleteWatermarkPreset(id))
}

// Chromium can reorder Windows commandLine arguments before second-instance.
// Preserve the original flag/value pairs through Electron's additionalData.
if (!app.requestSingleInstanceLock({ launchArgs: process.argv })) app.quit()
else {
  const readyForActions = app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    await settingsStore.initialize()
    installIpc()
    void localSend.initialize().catch(() => { /* Sharing retries cleanup without blocking tray startup. */ })
    tray = new Tray(createIcon())
    tray.on('double-click', () => void openSettings().catch(showError))
    registerShortcut()
    void helper.start().catch(() => { /* Manual area capture remains available. */ })
    screen.on('display-removed', displaysChanged)
    screen.on('display-added', displaysChanged)
    screen.on('display-metrics-changed', displaysChanged)
    warmOverlays()
    startupNotifier = createStartupNotifier({ Notification, openSettings, icon: createIcon(), onError: error => console.warn('启动通知未显示:', error) })
    startupNotifier.show({ enabled: settingsStore.snapshot().startupNotification, shortcutRegistered })
  })
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    const launchArgs = Array.isArray(additionalData?.launchArgs) ? additionalData.launchArgs : argv
    void readyForActions.then(() => handleLaunch(launchArgs, true)).catch(showError)
  })
  void readyForActions.then(() => handleLaunch(process.argv)).catch(showError)
  app.on('window-all-closed', () => { /* Keep the tray and global shortcut alive. */ })
  app.on('activate', () => void readyForActions.then(openSettings).catch(showError))
  app.on('before-quit', event => {
    if (shutdownReady) return
    // Wait for an in-flight PDF write to close and remove its temporary file
    // before Electron exits. The second quit proceeds after cleanup.
    event.preventDefault()
    if (quitting) return
    quitting = true
    startupNotifier?.dispose()
    if (captureSession) finishSession(captureSession, false)
    helper.stop()
    clearTimeout(poolRefreshTimer)
    void features.dispose()
    void translation.dispose()
    globalShortcut.unregisterAll()
    if (tray) tray.destroy()
    tray = null
    void Promise.allSettled([pdfService.dispose(), settingsStore.dispose()]).then(results => {
      for (const result of results) if (result.status === 'rejected') console.error(result.reason)
    }).finally(() => { shutdownReady = true; app.quit() })
  })
}
