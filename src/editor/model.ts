import type { Rect } from '../shared'

export type Tool = 'select' | 'text' | 'marker' | 'mosaic'
export type NumberStyle = 'number' | 'letter' | 'chinese'
export interface TextStyle { font: string; size: number; color: string }
interface BaseLayer { id: string; x: number; y: number }
export interface TextLayer extends BaseLayer, TextStyle { type: 'text'; text: string }
export interface MarkerLayer extends BaseLayer, TextStyle { type: 'marker'; number: number; style: NumberStyle; text: string }
export interface MosaicLayer extends BaseLayer { type: 'mosaic'; width: number; height: number; strength: number }
export type Layer = TextLayer | MarkerLayer | MosaicLayer
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
  const label = sequenceLabel(layer.number, layer.style)
  return Math.max(layer.size * 1.8, (measure?.(label, layer.font, layer.size) ?? label.length * layer.size) + layer.size * .85)
}

export function layerBounds(layer: Layer, measure?: (text: string, font: string, size: number) => number): Rect {
  if (layer.type === 'mosaic') return { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
  const lines = (layer.text || (layer.type === 'text' ? ' ' : '')).split('\n')
  const textWidth = Math.max(0, ...lines.map(line => measure?.(line, layer.font, layer.size) ?? [...line].reduce((sum, c) => sum + (/[^\x00-\xff]/.test(c) ? layer.size : layer.size * .6), 0)))
  if (layer.type === 'text') return { x: layer.x, y: layer.y, width: Math.max(layer.size, textWidth), height: lines.length * layer.size * 1.4 }
  const diameter = markerDiameter(layer, measure)
  return { x: layer.x, y: layer.y, width: diameter + (layer.text ? layer.size * .5 + textWidth : 0), height: Math.max(diameter, lines.length * layer.size * 1.4) }
}

export function hitTest(layers: Layer[], point: Point, padding = 4, measure?: (text: string, font: string, size: number) => number): Layer | undefined {
  return visualLayers(layers).reverse().find(layer => {
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
  return { ...layer, x: Math.max(0, Math.min(Math.max(0, width - bounds.width), layer.x + dx)), y: Math.max(0, Math.min(Math.max(0, height - bounds.height), layer.y + dy)) }
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
