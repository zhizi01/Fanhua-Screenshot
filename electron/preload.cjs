'use strict'
const { contextBridge, ipcRenderer } = require('electron')

// The renderer receives explicit capabilities, never ipcRenderer or Node APIs.
contextBridge.exposeInMainWorld('fanhua', Object.freeze({
  getAppState: () => ipcRenderer.invoke('app:state'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: patch => ipcRenderer.invoke('settings:update', patch),
  onSettingsChanged: callback => {
    const listener = (_event, settings) => callback(settings)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  startCapture: () => ipcRenderer.invoke('capture:start'),
  openSettings: () => ipcRenderer.invoke('app:settings'),
  retryShortcut: () => ipcRenderer.invoke('app:retry-shortcut'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  setLaunchAtLogin: enabled => ipcRenderer.invoke('app:launch-at-login', enabled),
  getCaptureContext: () => ipcRenderer.invoke('capture:context'),
  onCaptureContext: callback => {
    const listener = (_event, context) => callback(context)
    ipcRenderer.on('capture:context-changed', listener)
    return () => ipcRenderer.removeListener('capture:context-changed', listener)
  },
  captureReady: sessionId => ipcRenderer.invoke('capture:ready', sessionId),
  completeCapture: (rect, sessionId) => ipcRenderer.invoke('capture:complete', rect, sessionId),
  cancelCapture: sessionId => ipcRenderer.invoke('capture:cancel', sessionId),
  getPreview: () => ipcRenderer.invoke('preview:get'),
  setPinned: pinned => ipcRenderer.invoke('preview:pin', pinned),
  setEditing: editing => ipcRenderer.invoke('preview:editing', editing),
  setPreviewLayout: layout => ipcRenderer.invoke('preview:layout', layout),
  saveImage: (dataUrl, options) => ipcRenderer.invoke('image:save', dataUrl, options),
  beginPdfSave: options => ipcRenderer.invoke('pdf:begin-save', options),
  appendPdfPage: (jobId, page) => ipcRenderer.invoke('pdf:append-page', jobId, page),
  finishPdfSave: jobId => ipcRenderer.invoke('pdf:finish-save', jobId),
  cancelPdfSave: jobId => ipcRenderer.invoke('pdf:cancel-save', jobId),
  copyImage: (dataUrl, mode) => ipcRenderer.invoke('image:copy', dataUrl, mode),
  shareViaLocalSend: dataUrl => ipcRenderer.invoke('localsend:share', dataUrl),
  getLocalSendSettings: () => ipcRenderer.invoke('localsend:settings'),
  chooseLocalSendExecutable: () => ipcRenderer.invoke('localsend:choose-executable'),
  resetLocalSendExecutable: () => ipcRenderer.invoke('localsend:reset-executable'),
  openImage: () => ipcRenderer.invoke('image:open'),
  getFonts: refresh => ipcRenderer.invoke('app:fonts', refresh),
  getOcrCapabilities: () => ipcRenderer.invoke('ocr:capabilities'),
  recognizeText: (dataUrl, language) => ipcRenderer.invoke('ocr:recognize', dataUrl, language),
  getTranslationCapabilities: () => ipcRenderer.invoke('translation:capabilities'),
  translateParagraphs: request => ipcRenderer.invoke('translation:translate', request),
  cancelTranslation: requestId => ipcRenderer.invoke('translation:cancel', requestId),
  onTranslationProgress: callback => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('translation:progress', listener)
    return () => ipcRenderer.removeListener('translation:progress', listener)
  },
  copyText: text => ipcRenderer.invoke('text:copy', text),
  chooseWatermarkImage: () => ipcRenderer.invoke('watermark:choose-image'),
  listWatermarkPresets: () => ipcRenderer.invoke('watermark:list-presets'),
  saveWatermarkPreset: preset => ipcRenderer.invoke('watermark:save-preset', preset),
  deleteWatermarkPreset: id => ipcRenderer.invoke('watermark:delete-preset', id),
}))
