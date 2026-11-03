import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

export interface PdfRenderedPage {
  dataUrl: string
  width: number
  height: number
  widthPoints: number
  heightPoints: number
}

export interface PdfSource {
  pageCount: number
  renderPage(pageNumber: number): Promise<PdfRenderedPage>
  cancelRender(): void
  destroy(): Promise<void>
}

const MAX_PAGES = 200
const MAX_BYTES = 96 * 1024 * 1024
const MAX_PIXELS = 16_000_000
const MAX_EDGE = 8192
const ASSET_FOLDERS = { cMapUrl: 'cmaps/', standardFontDataUrl: 'standard_fonts/', wasmUrl: 'wasm/' } as const
type AssetKind = keyof typeof ASSET_FOLDERS

function canceled() { return new DOMException('PDF 页面读取已取消', 'AbortError') }

/** The unscaled viewport already includes /Rotate, CropBox and /UserUnit. */
export function pdfRenderSize(widthPoints: number, heightPoints: number) {
  if (![widthPoints, heightPoints].every(value => Number.isFinite(value) && value > 0)) throw new Error('PDF 页面尺寸无效')
  const scale = Math.min(2, MAX_EDGE / widthPoints, MAX_EDGE / heightPoints, Math.sqrt(MAX_PIXELS / widthPoints / heightPoints))
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('PDF 页面尺寸超出支持范围')
  // Flooring, rather than rounding up, ensures the allocated bitmap never
  // crosses the memory/edge limit; at most one fractional border pixel is lost.
  const width = Math.max(1, Math.floor(widthPoints * scale))
  const height = Math.max(1, Math.floor(heightPoints * scale))
  return { scale, width, height }
}

function assetRoot() {
  const root = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, document.baseURI)
  const location = new URL(document.baseURI)
  if (root.protocol !== 'file:' && (!['http:', 'https:'].includes(root.protocol) || root.origin !== location.origin)) {
    throw new Error('PDF 离线资源路径无效')
  }
  return root
}

function loadLocalAsset(url: URL, requests: Set<XMLHttpRequest>): Promise<Uint8Array> {
  // Chromium fetch() cannot read file: URLs. XHR works for both the local Vite
  // server and Electron's packaged file: document, with webSecurity retained.
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    requests.add(request)
    const finish = () => { requests.delete(request) }
    request.open('GET', url.href)
    request.responseType = 'arraybuffer'
    request.timeout = 30_000
    request.onload = () => {
      finish()
      const data = request.response
      if (((request.status >= 200 && request.status < 300) || (url.protocol === 'file:' && request.status === 0))
        && data instanceof ArrayBuffer && data.byteLength > 0) resolve(new Uint8Array(data))
      else reject(new Error('PDF 离线字体或解码资源缺失，请重新安装程序'))
    }
    request.onerror = request.ontimeout = () => { finish(); reject(new Error('PDF 离线资源读取失败，请重新安装程序')) }
    request.onabort = () => { finish(); reject(canceled()) }
    try { request.send() } catch (error) { finish(); reject(error) }
  })
}

function friendlyError(error: unknown, rendering = false): Error {
  const name = error instanceof Error ? error.name : ''
  if (name === 'AbortError' || name === 'RenderingCancelledException') return canceled()
  if (name === 'PasswordException') return new Error('暂不支持需要密码的 PDF，请先解密后再打开')
  if (name === 'InvalidPDFException' || name === 'FormatError') return new Error('PDF 文件损坏或格式无效，请重新导出后再打开')
  if (error instanceof Error && error.message.startsWith('PDF ')) return error
  return new Error(rendering ? 'PDF 页面无法渲染，文件可能已损坏或包含不支持的内容' : '无法打开 PDF，请检查文件是否完整')
}

/** Parse locally. Only one raster page is held while rendering; callers own PNGs. */
export async function openPdf(bytes: Uint8Array): Promise<PdfSource> {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error('PDF 文件为空')
  if (bytes.byteLength > MAX_BYTES) throw new Error('PDF 文件过大，最多支持 96 MB')
  const pdfjs = await import('pdfjs-dist')
  const root = assetRoot()
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', root).href
  const requests = new Set<XMLHttpRequest>()
  let destroyed = false
  class LocalBinaryDataFactory {
    fetch({ kind, filename }: { kind: AssetKind; filename: string }) {
      if (destroyed) return Promise.reject(canceled())
      if (!Object.hasOwn(ASSET_FOLDERS, kind) || typeof filename !== 'string'
        || !/^[a-zA-Z0-9_.-]+$/.test(filename) || filename.includes('..')) return Promise.reject(new Error('PDF 离线资源名称无效'))
      return loadLocalAsset(new URL(`${ASSET_FOLDERS[kind]}${filename}`, root), requests)
    }
  }
  const loadingTask = pdfjs.getDocument({
    // PDF.js transfers its array to the worker. Preserve the caller's original
    // bytes for document export, rather than detaching that source buffer.
    data: new Uint8Array(bytes),
    cMapUrl: new URL(ASSET_FOLDERS.cMapUrl, root).href,
    cMapPacked: true,
    standardFontDataUrl: new URL(ASSET_FOLDERS.standardFontDataUrl, root).href,
    wasmUrl: new URL(ASSET_FOLDERS.wasmUrl, root).href,
    iccUrl: new URL('iccs/', root).href,
    BinaryDataFactory: LocalBinaryDataFactory,
    useWorkerFetch: false,
    disableWorkerRendering: true,
    enableXfa: false,
    useSystemFonts: true,
    stopAtErrors: true,
    canvasMaxAreaInBytes: MAX_PIXELS * 4,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  })
  let pdf: PDFDocumentProxy
  try {
    pdf = await loadingTask.promise
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) throw new Error('PDF 没有可显示的页面')
    if (pdf.numPages > MAX_PAGES) throw new Error(`PDF 页数过多，最多支持 ${MAX_PAGES} 页`)
  } catch (error) {
    destroyed = true
    for (const request of requests) request.abort()
    await loadingTask.destroy().catch(() => {})
    throw friendlyError(error)
  }

  let generation = 0
  let renderTask: RenderTask | undefined
  let pending: Promise<unknown> = Promise.resolve()
  let destruction: Promise<void> | undefined

  return {
    pageCount: pdf.numPages,
    renderPage(pageNumber) {
      if (destroyed) return Promise.reject(canceled())
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) return Promise.reject(new Error('PDF 页码超出范围'))
      const current = ++generation
      renderTask?.cancel()
      const rendering = pending.catch(() => {}).then(async () => {
        let page: PDFPageProxy | undefined
        let canvas: HTMLCanvasElement | undefined
        const checkCurrent = () => { if (destroyed || current !== generation) throw canceled() }
        try {
          checkCurrent()
          page = await pdf.getPage(pageNumber)
          checkCurrent()
          const points = page.getViewport({ scale: 1 })
          const { scale, width, height } = pdfRenderSize(points.width, points.height)
          canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          renderTask = page.render({ canvas, viewport: page.getViewport({ scale }), background: '#ffffff', annotationMode: pdfjs.AnnotationMode.ENABLE })
          await renderTask.promise
          checkCurrent()
          const dataUrl = canvas.toDataURL('image/png')
          if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('PDF 页面图像生成失败')
          return { dataUrl, width, height, widthPoints: points.width, heightPoints: points.height }
        } catch (error) {
          if (destroyed || current !== generation) throw canceled()
          throw friendlyError(error, true)
        } finally {
          renderTask = undefined
          // PNG belongs to the consumer; do not retain page-sized canvases or
          // completed operator lists while paging through a long document.
          if (canvas) { canvas.width = 0; canvas.height = 0 }
          page?.cleanup()
        }
      })
      // Attach a rejection observer immediately, while keeping the caller's
      // promise rejected so superseded requests can be ignored explicitly.
      pending = rendering.catch(() => {})
      return rendering
    },
    cancelRender() {
      generation++
      renderTask?.cancel()
    },
    destroy() {
      if (destruction) return destruction
      destroyed = true; generation++
      renderTask?.cancel()
      for (const request of requests) request.abort()
      destruction = (async () => {
        try { await loadingTask.destroy() } finally { await pending.catch(() => {}) }
      })()
      return destruction
    },
  }
}
