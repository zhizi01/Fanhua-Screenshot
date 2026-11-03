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
  captureReady: () => ipcRenderer.invoke('capture:ready'),
  completeCapture: rect => ipcRenderer.invoke('capture:complete', rect),
  cancelCapture: () => ipcRenderer.invoke('capture:cancel'),
  getPreview: () => ipcRenderer.invoke('preview:get'),
  setPinned: pinned => ipcRenderer.invoke('preview:pin', pinned),
  setEditing: editing => ipcRenderer.invoke('preview:editing', editing),
  saveImage: dataUrl => ipcRenderer.invoke('image:save', dataUrl),
  copyImage: dataUrl => ipcRenderer.invoke('image:copy', dataUrl),
  openImage: () => ipcRenderer.invoke('image:open'),
  getFonts: () => ipcRenderer.invoke('app:fonts'),
}))
