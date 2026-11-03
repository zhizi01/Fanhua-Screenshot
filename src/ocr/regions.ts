import type { OcrParagraph, Rect } from '../shared'

/** Clamp OCR engine coordinates before using them for image overlays. */
export function clipOcrBounds(bounds: Rect, width: number, height: number): Rect | undefined {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, width, height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) return
  const left = Math.max(0, Math.min(width, bounds.x))
  const top = Math.max(0, Math.min(height, bounds.y))
  const right = Math.max(0, Math.min(width, bounds.x + bounds.width))
  const bottom = Math.max(0, Math.min(height, bounds.y + bounds.height))
  if (right <= left || bottom <= top) return
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Prefer the tighter region when an OCR engine returns overlapping blocks. */
export function hitOcrParagraph(paragraphs: OcrParagraph[], point: { x: number; y: number }): OcrParagraph | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
  let found: OcrParagraph | undefined
  for (const paragraph of paragraphs) {
    const bounds = paragraph.bounds
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) continue
    if (point.x < bounds.x || point.y < bounds.y || point.x > bounds.x + bounds.width || point.y > bounds.y + bounds.height) continue
    if (!found || bounds.width * bounds.height < found.bounds.width * found.bounds.height) found = paragraph
  }
  return found
}

/** Percentages follow CSS image scaling without rounding the OCR coordinates. */
export function ocrRegionStyle(bounds: Rect, width: number, height: number): Record<'left' | 'top' | 'width' | 'height', string> | undefined {
  const clipped = clipOcrBounds(bounds, width, height)
  if (!clipped) return
  return {
    left: `${clipped.x / width * 100}%`, top: `${clipped.y / height * 100}%`,
    width: `${clipped.width / width * 100}%`, height: `${clipped.height / height * 100}%`,
  }
}
