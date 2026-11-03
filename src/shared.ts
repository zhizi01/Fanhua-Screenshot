export interface Rect { x: number; y: number; width: number; height: number }
export interface WindowRegion extends Rect { title: string; id: string }
export interface CaptureContext {
  sessionId?: string
  cursor?: { x: number; y: number }
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
  initialEditing?: boolean
  pdf?: { name: string; bytes: Uint8Array }
}
export interface AppState {
  shortcut: string
  shortcutRegistered: boolean
  launchAtLogin: boolean
  version: string
  platform: string
}
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'bmp'
export interface ImageSaveOptions { format: ImageFormat; quality?: number }
export interface ExportOptions { format: ImageFormat | 'pdf'; quality?: number; scope?: 'current' | 'all' }
export interface PdfSaveOptions { pageCount: number; name?: string }
export interface PdfPageInput { dataUrl: string; widthPoints: number; heightPoints: number }
export type ImageCopyMode = 'png' | 'deskflow'
export interface ImageCopyResult { format: 'png' | 'jpeg'; quality?: number; bytes: number }
export interface OcrLine { text: string; bounds: Rect }
export interface OcrParagraph { id: string; text: string; bounds: Rect; lines: OcrLine[] }
export interface OcrResult { text: string; lines: OcrLine[]; paragraphs: OcrParagraph[]; language: string; width: number; height: number }
export interface OcrCapabilities { available: boolean; languages: { tag: string; name: string }[]; reason?: string }
export type TranslationDirection = 'en-zh' | 'zh-en'
export interface TranslationParagraph { id: string; sourceText: string; text: string }
export interface TranslationRequest { requestId: string; direction: TranslationDirection; paragraphs: { id: string; text: string }[] }
export interface TranslationResult { requestId: string; direction: TranslationDirection; paragraphs: TranslationParagraph[] }
export interface TranslationCapabilities { available: boolean; directions: TranslationDirection[]; reason?: string }
export interface TranslationProgress {
  requestId: string
  direction: TranslationDirection
  completed: number
  total: number
  paragraph?: TranslationParagraph
  status: 'loading' | 'translating' | 'done'
}
export type WatermarkPlacement = 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'tile'
export interface WatermarkConfig {
  enabled: boolean
  kind: 'text' | 'image'
  text: string
  font: string
  fontSize: number
  color: string
  imageDataUrl: string
  imageWidth: number
  imageHeight: number
  scale: number
  placement: WatermarkPlacement
  opacity: number
  rotation: number
  margin: number
  spacing: number
}
export interface WatermarkPreset { id: string; name: string; config: WatermarkConfig; updatedAt: string }
export interface DesktopAPI {
  getAppState(): Promise<AppState>
  startCapture(): Promise<void>
  openDashboard(): Promise<void>
  hideWindow(): Promise<void>
  minimizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  quitApp(): Promise<void>
  setLaunchAtLogin(enabled: boolean): Promise<boolean>
  getCaptureContext(): Promise<CaptureContext | null>
  onCaptureContext(callback: (context: CaptureContext | null) => void): () => void
  captureReady(sessionId?: string): Promise<void>
  completeCapture(rect: Rect, sessionId?: string): Promise<void>
  cancelCapture(sessionId?: string): Promise<void>
  getPreview(): Promise<Screenshot>
  setPinned(pinned: boolean): Promise<boolean>
  setEditing(editing: boolean): Promise<void>
  setPreviewLayout(layout: { editing: boolean; ocr: boolean }): Promise<void>
  saveImage(dataUrl: string, options?: ImageSaveOptions): Promise<{ canceled: boolean; filePath?: string }>
  beginPdfSave(options: PdfSaveOptions): Promise<{ canceled: boolean; jobId?: string }>
  appendPdfPage(jobId: string, page: PdfPageInput): Promise<void>
  finishPdfSave(jobId: string): Promise<{ canceled: boolean; filePath?: string }>
  cancelPdfSave(jobId: string): Promise<void>
  copyImage(dataUrl: string, mode?: ImageCopyMode): Promise<ImageCopyResult>
  shareViaLocalSend(dataUrl: string): Promise<{ canceled: boolean; fileName?: string }>
  openImage(): Promise<void>
  getFonts(refresh?: boolean): Promise<string[]>
  getOcrCapabilities(): Promise<OcrCapabilities>
  recognizeText(dataUrl: string, language?: string): Promise<OcrResult>
  getTranslationCapabilities(): Promise<TranslationCapabilities>
  translateParagraphs(request: TranslationRequest): Promise<TranslationResult>
  cancelTranslation(requestId: string): Promise<boolean>
  onTranslationProgress(callback: (progress: TranslationProgress) => void): () => void
  copyText(text: string): Promise<void>
  chooseWatermarkImage(): Promise<{ dataUrl: string; width: number; height: number } | null>
  listWatermarkPresets(): Promise<WatermarkPreset[]>
  saveWatermarkPreset(preset: { id?: string; name: string; config: WatermarkConfig }): Promise<WatermarkPreset>
  deleteWatermarkPreset(id: string): Promise<void>
}
declare global { interface Window { fanhua?: DesktopAPI } }
