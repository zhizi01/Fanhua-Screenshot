import type { Rect, WindowRegion } from '../shared'

export interface Point { x: number; y: number }

/** All capture geometry uses display-local DIP coordinates, never CSS or image pixels. */
export function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.max(0, Math.min(width, point.x)),
    y: Math.max(0, Math.min(height, point.y)),
  }
}

export function clipRect(rect: Rect, width: number, height: number): Rect {
  const left = Math.max(0, Math.min(width, rect.x))
  const top = Math.max(0, Math.min(height, rect.y))
  const right = Math.max(left, Math.min(width, rect.x + rect.width))
  const bottom = Math.max(top, Math.min(height, rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function dragRect(start: Point, end: Point, width: number, height: number): Rect {
  const a = clampPoint(start, width, height)
  const b = clampPoint(end, width, height)
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return rect.width > 0 && rect.height > 0 && point.x >= rect.x && point.y >= rect.y
    && point.x < rect.x + rect.width && point.y < rect.y + rect.height
}

/** EnumWindows supplies front-to-back order; the first containing window wins. */
export function windowAtPoint(windows: WindowRegion[], point: Point, width: number, height: number): WindowRegion | undefined {
  const window = windows.find(candidate => containsPoint(candidate, point))
  if (!window) return undefined
  const clipped = clipRect(window, width, height)
  if (clipped.width < 1 || clipped.height < 1) return undefined
  return { ...window, ...clipped }
}

export function isDrag(start: Point, end: Point, threshold = 4): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) >= threshold
}

export function pixelSize(rect: Rect, width: number, height: number, pixelWidth: number, pixelHeight: number) {
  return {
    width: Math.max(1, Math.round(rect.width * pixelWidth / width)),
    height: Math.max(1, Math.round(rect.height * pixelHeight / height)),
  }
}
