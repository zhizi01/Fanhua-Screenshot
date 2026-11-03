import type { WatermarkConfig } from '../shared'
import { clampNumber, watermarkLayout } from './layout'

export function defaultWatermark(): WatermarkConfig {
  return {
    enabled: false, kind: 'text', text: '繁花有图', font: 'Microsoft YaHei UI',
    fontSize: 28, color: '#555555', imageDataUrl: '', imageWidth: 0, imageHeight: 0,
    scale: .35, placement: 'bottom-right', opacity: .18, rotation: 0, margin: 24, spacing: 100,
  }
}

const imageCache = new Map<string, HTMLImageElement>()
const pendingImages = new Map<string, Promise<void>>()
const MAX_IMAGE_PIXELS = 16000000

export async function loadWatermarkImage(dataUrl: string): Promise<void> {
  if (!dataUrl) return
  const cached = imageCache.get(dataUrl)
  if (cached) { imageCache.delete(dataUrl); imageCache.set(dataUrl, cached); return }
  const pending = pendingImages.get(dataUrl)
  if (pending) return pending
  if (!/^data:image\/png;base64,/.test(dataUrl) || dataUrl.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 + 22) throw new Error('水印图片必须为不超过 8 MB 的 PNG 图片')
  const task = (async () => {
    const image = new Image()
    image.src = dataUrl
    try { await image.decode() }
    catch { throw new Error('水印图片无法解码，请重新选择') }
    if (image.naturalWidth < 1 || image.naturalHeight < 1 || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
      throw new Error('水印图片最多支持 1600 万像素')
    }
    imageCache.set(dataUrl, image)
    while (imageCache.size > 3) imageCache.delete(imageCache.keys().next().value!)
  })()
  pendingImages.set(dataUrl, task)
  try { await task }
  finally { pendingImages.delete(dataUrl) }
}

/** The caller awaits loadWatermarkImage before preview and export. */
export function paintWatermark(context: CanvasRenderingContext2D, width: number, height: number, config?: WatermarkConfig): void {
  if (!config?.enabled || config.opacity <= 0 || width <= 0 || height <= 0) return
  const text = config.text.slice(0, 2000)
  if (config.kind === 'text' && !text.trim()) return
  const image = config.kind === 'image' ? imageCache.get(config.imageDataUrl) : undefined
  if (config.kind === 'image' && !image) return

  context.save()
  try {
    context.globalAlpha = clampNumber(config.opacity, 0, 1, .18)
    context.beginPath()
    context.rect(0, 0, width, height)
    context.clip()
    const fontSize = clampNumber(config.fontSize, 8, 240, 28)
    const font = config.font.replace(/["\\\n\r]/g, '').slice(0, 200)
    context.font = `${fontSize}px "${font}", "Microsoft YaHei UI", sans-serif`
    context.fillStyle = /^#[a-f\d]{6}$/i.test(config.color) ? config.color : '#555555'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const lines = text.split('\n').slice(0, 50)
    const lineHeight = fontSize * 1.35
    const size = image
      ? { width: image.naturalWidth * clampNumber(config.scale, .05, 4, .35), height: image.naturalHeight * clampNumber(config.scale, .05, 4, .35) }
      : { width: Math.max(fontSize, ...lines.map(line => context.measureText(line).width)), height: lines.length * lineHeight }
    const angle = clampNumber(config.rotation, -180, 180)
    const layout = watermarkLayout(width, height, size.width, size.height, config.placement, config.margin, config.spacing, angle)
    for (const center of layout.centers) {
      context.save()
      try {
        context.translate(center.x, center.y)
        context.rotate(angle * Math.PI / 180)
        if (image) context.drawImage(image, -layout.width / 2, -layout.height / 2, layout.width, layout.height)
        else {
          const scale = layout.width / size.width
          context.scale(scale, scale)
          lines.forEach((line, index) => context.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight))
        }
      } finally { context.restore() }
    }
  } finally { context.restore() }
}
