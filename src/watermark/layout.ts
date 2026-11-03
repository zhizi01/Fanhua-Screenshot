import type { WatermarkPlacement } from '../shared'

export interface MarkPoint { x: number; y: number }
export interface WatermarkLayout {
  width: number
  height: number
  rotatedWidth: number
  rotatedHeight: number
  centers: MarkPoint[]
}

export function clampNumber(value: number, minimum: number, maximum: number, fallback = minimum): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : fallback))
}

export function rotatedSize(width: number, height: number, degrees: number) {
  const angle = degrees * Math.PI / 180
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  return { width: width * cos + height * sin, height: width * sin + height * cos }
}

/** Positions are centers; edge anchors account for the rotated rectangle. */
export function watermarkLayout(
  canvasWidth: number,
  canvasHeight: number,
  markWidth: number,
  markHeight: number,
  placement: WatermarkPlacement,
  margin = 24,
  spacing = 100,
  rotation = 0,
): WatermarkLayout {
  const width = Math.max(1, canvasWidth)
  const height = Math.max(1, canvasHeight)
  const inset = clampNumber(margin, 0, Math.min(width, height) * .45)
  const initialWidth = Math.max(1, markWidth)
  const initialHeight = Math.max(1, markHeight)
  const rotated = rotatedSize(initialWidth, initialHeight, rotation)
  // A watermark remains visible even on a tiny screenshot or with a large margin.
  const factor = Math.min(1, Math.max(1, width - inset * 2) / rotated.width, Math.max(1, height - inset * 2) / rotated.height)
  const actualWidth = initialWidth * factor
  const actualHeight = initialHeight * factor
  const rotatedWidth = rotated.width * factor
  const rotatedHeight = rotated.height * factor
  const result = { width: actualWidth, height: actualHeight, rotatedWidth, rotatedHeight, centers: [] as MarkPoint[] }

  if (placement !== 'tile') {
    const x = placement.endsWith('left') ? inset + rotatedWidth / 2
      : placement.endsWith('right') ? width - inset - rotatedWidth / 2 : width / 2
    const y = placement.startsWith('top') ? inset + rotatedHeight / 2
      : placement.startsWith('bottom') ? height - inset - rotatedHeight / 2 : height / 2
    result.centers.push({ x, y })
    return result
  }

  // Stagger alternate rows. Include partial edge tiles, and bound draw calls for
  // very large screenshots and very small glyphs rather than locking the UI.
  let stepX = Math.max(8, rotatedWidth + clampNumber(spacing, 0, 1000))
  let stepY = Math.max(8, rotatedHeight + clampNumber(spacing, 0, 1000))
  const maxMarks = 1600
  const count = () => (Math.ceil(width / stepX) + 3) * (Math.ceil(height / stepY) + 3)
  while (count() > maxMarks) {
    const grow = Math.max(1.05, Math.sqrt(count() / maxMarks))
    stepX *= grow
    stepY *= grow
  }
  const columns = Math.ceil(width / stepX) + 2
  const rows = Math.ceil(height / stepY) + 2
  for (let row = -1; row < rows; row++) {
    for (let column = -1; column < columns; column++) {
      const x = (column + .5 + (Math.abs(row) % 2) * .5) * stepX
      const y = (row + .5) * stepY
      if (x + rotatedWidth / 2 < 0 || x - rotatedWidth / 2 > width || y + rotatedHeight / 2 < 0 || y - rotatedHeight / 2 > height) continue
      result.centers.push({ x, y })
    }
  }
  return result
}
