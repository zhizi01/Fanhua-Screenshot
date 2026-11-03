export interface Rect { x: number; y: number; width: number; height: number }
export interface WindowRegion extends Rect { title: string; id: string }
export interface CaptureContext {
  displayId: number
  dataUrl: string
  width: number
  height: number
  pixelWidth: number
  pixelHeight: number
  windows: WindowRegion[]
  windowDetectionAvailable: boolean
}
export interface Screenshot {
  id: string
  dataUrl: string
  width: number
  height: number
  createdAt: string
}
export interface AppState {
  shortcut: string
  shortcutRegistered: boolean
  launchAtLogin: boolean
  version: string
  platform: string
}
export interface DesktopAPI {
  getAppState(): Promise<AppState>
  startCapture(): Promise<void>
  openDashboard(): Promise<void>
  hideWindow(): Promise<void>
  minimizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  quitApp(): Promise<void>
  setLaunchAtLogin(enabled: boolean): Promise<boolean>
  getCaptureContext(): Promise<CaptureContext>
  captureReady(): Promise<void>
  completeCapture(rect: Rect): Promise<void>
  cancelCapture(): Promise<void>
  getPreview(): Promise<Screenshot>
  setPinned(pinned: boolean): Promise<boolean>
  setEditing(editing: boolean): Promise<void>
  saveImage(dataUrl: string): Promise<{ canceled: boolean; filePath?: string }>
  copyImage(dataUrl: string): Promise<void>
  openImage(): Promise<void>
  getFonts(): Promise<string[]>
}
declare global { interface Window { fanhua?: DesktopAPI } }
