import type { Rect, WatermarkConfig } from '../shared'

export type Tool = 'select' | 'text' | 'marker' | 'mosaic' | 'arrow'
export type NumberStyle = 'number' | 'letter' | 'chinese'
export interface TextStyle { font: string; size: number; color: string }
interface BaseLayer { id: string; x: number; y: number }
export interface TextLayer extends BaseLayer, TextStyle { type: 'text'; text: string }
export interface MarkerLayer extends BaseLayer, TextStyle { type: 'marker'; number: number; style: NumberStyle; text: string; headSize?: number }
export interface MosaicLayer extends BaseLayer { type: 'mosaic'; width: number; height: number; strength: number }
export interface ArrowLayer extends BaseLayer { type: 'arrow'; endX: number; endY: number; color: string; lineWidth: number; headSize: number }
export type Layer = TextLayer | MarkerLayer | MosaicLayer | ArrowLayer
export interface Point { x: number; y: number }

export function sequenceLabel(value: number, style: NumberStyle): string {
  const number = Math.max(1, Math.min(9999, Math.floor(value) || 1))
  if (style === 'number') return String(number)
  if (style === 'letter') {
    let n = number
    let label = ''
    while (n > 0) { n--; label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26) }
    return label
  }
  const digits = '零壹贰叁肆伍陆柒捌玖'
  const units = ['', '拾', '佰', '仟']
  let result = ''
  let pendingZero = false
  for (let place = 3; place >= 0; place--) {
    const digit = Math.floor(number / 10 ** place) % 10
    if (digit) {
      if (pendingZero) result += '零'
      result += digits[digit]! + units[place]!
      pendingZero = false
    } else if (result) pendingZero = true
  }
  return result
}

export function normalizeRect(a: Point, b: Point, width: number, height: number): Rect {
  const left = Math.max(0, Math.min(width, Math.min(a.x, b.x)))
  const top = Math.max(0, Math.min(height, Math.min(a.y, b.y)))
  const right = Math.max(0, Math.min(width, Math.max(a.x, b.x)))
  const bottom = Math.max(0, Math.min(height, Math.max(a.y, b.y)))
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }
}

export function imagePoint(clientX: number, clientY: number, bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, width: number, height: number): Point {
  return { x: Math.max(0, Math.min(width, (clientX - bounds.left) / Math.max(1, bounds.width) * width)), y: Math.max(0, Math.min(height, (clientY - bounds.top) / Math.max(1, bounds.height) * height)) }
}

export function markerDiameter(layer: MarkerLayer, measure?: (text: string, font: string, size: number) => number) {
  if (layer.headSize !== undefined) return Math.max(16, Math.min(240, layer.headSize))
  const label = sequenceLabel(layer.number, layer.style)
  return Math.max(layer.size * 1.8, (measure?.(label, layer.font, layer.size) ?? label.length * layer.size) + layer.size * .85)
}

/** End-point geometry is shared by painting, selection and precise hit testing. */
export function arrowGeometry(layer: ArrowLayer) {
  const length = Math.hypot(layer.endX - layer.x, layer.endY - layer.y)
  const angle = Math.atan2(layer.endY - layer.y, layer.endX - layer.x)
  const head = Math.max(0, Math.min(layer.headSize, length * .8))
  const half = head * .48
  const base = { x: layer.endX - Math.cos(angle) * head, y: layer.endY - Math.sin(angle) * head }
  return {
    length,
    start: { x: layer.x, y: layer.y },
    end: { x: layer.endX, y: layer.endY },
    base,
    left: { x: base.x + Math.sin(angle) * half, y: base.y - Math.cos(angle) * half },
    right: { x: base.x - Math.sin(angle) * half, y: base.y + Math.cos(angle) * half },
  }
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const squared = dx * dx + dy * dy
  const t = squared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared)) : 0
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy)
}

function insideTriangle(p: Point, a: Point, b: Point, c: Point) {
  const cross = (u: Point, v: Point, w: Point) => (u.x - w.x) * (v.y - w.y) - (v.x - w.x) * (u.y - w.y)
  if (Math.abs(cross(a, b, c)) < .001) return false
  const d = [cross(p, a, b), cross(p, b, c), cross(p, c, a)]
  return !(d.some(value => value < 0) && d.some(value => value > 0))
}

export function arrowEndpointAt(layer: ArrowLayer, point: Point, tolerance: number): 'start' | 'end' | undefined {
  if (Math.hypot(point.x - layer.endX, point.y - layer.endY) <= tolerance) return 'end'
  if (Math.hypot(point.x - layer.x, point.y - layer.y) <= tolerance) return 'start'
  return undefined
}

export function layerBounds(layer: Layer, measure?: (text: string, font: string, size: number) => number): Rect {
  if (layer.type === 'mosaic') return { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
  if (layer.type === 'arrow') {
    const geometry = arrowGeometry(layer)
    const xs = [geometry.start.x, geometry.end.x, geometry.left.x, geometry.right.x]
    const ys = [geometry.start.y, geometry.end.y, geometry.left.y, geometry.right.y]
    const pad = layer.lineWidth / 2
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + pad * 2, height: Math.max(...ys) - Math.min(...ys) + pad * 2 }
  }
  const lines = (layer.text || (layer.type === 'text' ? ' ' : '')).split('\n')
  const textWidth = Math.max(0, ...lines.map(line => measure?.(line, layer.font, layer.size) ?? [...line].reduce((sum, c) => sum + (/[^\x00-\xff]/.test(c) ? layer.size : layer.size * .6), 0)))
  if (layer.type === 'text') return { x: layer.x, y: layer.y, width: Math.max(layer.size, textWidth), height: lines.length * layer.size * 1.4 }
  const diameter = markerDiameter(layer, measure)
  return { x: layer.x, y: layer.y, width: diameter + (layer.text ? layer.size * .5 + textWidth : 0), height: Math.max(diameter, lines.length * layer.size * 1.4) }
}

export function hitTest(layers: Layer[], point: Point, padding = 4, measure?: (text: string, font: string, size: number) => number): Layer | undefined {
  return visualLayers(layers).reverse().find(layer => {
    if (layer.type === 'arrow') {
      const g = arrowGeometry(layer)
      return distanceToSegment(point, g.start, g.base) <= layer.lineWidth / 2 + padding
        || insideTriangle(point, g.end, g.left, g.right)
        || distanceToSegment(point, g.end, g.left) <= padding
        || distanceToSegment(point, g.end, g.right) <= padding
    }
    const b = layerBounds(layer, measure)
    return point.x >= b.x - padding && point.y >= b.y - padding && point.x <= b.x + b.width + padding && point.y <= b.y + b.height + padding
  })
}

/** Mosaic regions protect source pixels; text and step labels remain above them. */
export function visualLayers(layers: Layer[]): Layer[] {
  return [...layers.filter(layer => layer.type === 'mosaic'), ...layers.filter(layer => layer.type !== 'mosaic')]
}

export function moveLayer(layer: Layer, dx: number, dy: number, width: number, height: number, measure?: (text: string, font: string, size: number) => number): Layer {
  const bounds = layerBounds(layer, measure)
  if (layer.type === 'arrow') {
    const moveX = Math.max(-bounds.x, Math.min(width - bounds.x - bounds.width, dx))
    const moveY = Math.max(-bounds.y, Math.min(height - bounds.y - bounds.height, dy))
    return { ...layer, x: layer.x + moveX, y: layer.y + moveY, endX: layer.endX + moveX, endY: layer.endY + moveY }
  }
  return { ...layer, x: Math.max(0, Math.min(Math.max(0, width - bounds.width), layer.x + dx)), y: Math.max(0, Math.min(Math.max(0, height - bounds.height), layer.y + dy)) }
}

export interface EditorDocument { layers: Layer[]; watermark: WatermarkConfig }
function cloneDocument(document: EditorDocument): EditorDocument {
  // Image data strings are immutable and shared; do not copy their bytes per edit.
  return { layers: cloneLayers(document.layers), watermark: { ...document.watermark } }
}
export class DocumentHistory {
  private states: EditorDocument[]
  private cursor = 0
  constructor(initial: EditorDocument, private limit = 100) { this.states = [cloneDocument(initial)] }
  get canUndo() { return this.cursor > 0 }
  get canRedo() { return this.cursor < this.states.length - 1 }
  commit(document: EditorDocument) {
    const previous = this.states[this.cursor]!
    if (JSON.stringify(previous.layers) === JSON.stringify(document.layers)
      && Object.keys(document.watermark).every(key => previous.watermark[key as keyof WatermarkConfig] === document.watermark[key as keyof WatermarkConfig])) return
    this.states = this.states.slice(0, this.cursor + 1)
    this.states.push(cloneDocument(document))
    if (this.states.length > this.limit) this.states.shift()
    this.cursor = this.states.length - 1
  }
  undo(): EditorDocument { if (this.canUndo) this.cursor--; return cloneDocument(this.states[this.cursor]!) }
  redo(): EditorDocument { if (this.canRedo) this.cursor++; return cloneDocument(this.states[this.cursor]!) }
}

export function cloneLayers(layers: Layer[]): Layer[] { return layers.map(layer => ({ ...layer })) }

/** History owns immutable snapshots; live pointer movement never mutates a stored state. */
export class EditHistory {
  private states: Layer[][] = [[]]
  private cursor = 0
  constructor(private limit = 100) {}
  get canUndo() { return this.cursor > 0 }
  get canRedo() { return this.cursor < this.states.length - 1 }
  commit(layers: Layer[]) {
    if (JSON.stringify(this.states[this.cursor]) === JSON.stringify(layers)) return
    this.states = this.states.slice(0, this.cursor + 1)
    this.states.push(cloneLayers(layers))
    if (this.states.length > this.limit) this.states.shift()
    this.cursor = this.states.length - 1
  }
  undo(): Layer[] { if (this.canUndo) this.cursor--; return cloneLayers(this.states[this.cursor]!) }
  redo(): Layer[] { if (this.canRedo) this.cursor++; return cloneLayers(this.states[this.cursor]!) }
}
