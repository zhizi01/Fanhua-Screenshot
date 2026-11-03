'use strict'
const { contextBridge, ipcRenderer } = require('electron')

// The renderer receives explicit capabilities, never ipcRenderer or Node APIs.
contextBridge.exposeInMainWorld('fanhua', Object.freeze({
  getAppState: () => ipcRenderer.invoke('app:state'),
  startCapture: () => ipcRenderer.invoke('capture:start'),
  openDashboard: () => ipcRenderer.invoke('app:dashboard'),
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
  copyImage: dataUrl => ipcRenderer.invoke('image:copy', dataUrl),
  openImage: () => ipcRenderer.invoke('image:open'),
  getFonts: refresh => ipcRenderer.invoke('app:fonts', refresh),
  getOcrCapabilities: () => ipcRenderer.invoke('ocr:capabilities'),
  recognizeText: (dataUrl, language) => ipcRenderer.invoke('ocr:recognize', dataUrl, language),
  copyText: text => ipcRenderer.invoke('text:copy', text),
  chooseWatermarkImage: () => ipcRenderer.invoke('watermark:choose-image'),
  listWatermarkPresets: () => ipcRenderer.invoke('watermark:list-presets'),
  saveWatermarkPreset: preset => ipcRenderer.invoke('watermark:save-preset', preset),
  deleteWatermarkPreset: id => ipcRenderer.invoke('watermark:delete-preset', id),
}))
