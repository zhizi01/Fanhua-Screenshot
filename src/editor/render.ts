import { arrowGeometry, layerBounds, markerDiameter, sequenceLabel, type ArrowLayer, type Layer, type MosaicLayer } from './model'
import type { WatermarkConfig } from '../shared'
import { paintWatermark } from '../watermark/render'

export function canvasFont(font: string, size: number) {
  return `${size}px "${font.replace(/["\\]/g, '')}", "Microsoft YaHei UI", sans-serif`
}

export function textMeasure(context: CanvasRenderingContext2D) {
  return (text: string, font: string, size: number) => { context.font = canvasFont(font, size); return context.measureText(text).width }
}

/** Sample each mosaic from the original image, so changing or deleting it is lossless. */
export function paintMosaic(context: CanvasRenderingContext2D, source: CanvasImageSource, layer: MosaicLayer) {
  const width = Math.max(1, Math.round(layer.width))
  const height = Math.max(1, Math.round(layer.height))
  const block = Math.max(3, Math.min(80, Math.round(layer.strength)))
  const sample = document.createElement('canvas')
  sample.width = Math.max(1, Math.ceil(width / block))
  sample.height = Math.max(1, Math.ceil(height / block))
  const sampleContext = sample.getContext('2d')!
  sampleContext.drawImage(source, layer.x, layer.y, width, height, 0, 0, sample.width, sample.height)
  context.save()
  context.imageSmoothingEnabled = false
  context.drawImage(sample, 0, 0, sample.width, sample.height, layer.x, layer.y, width, height)
  context.restore()
}

export function paintArrow(context: CanvasRenderingContext2D, layer: ArrowLayer) {
  const g = arrowGeometry(layer)
  if (g.length < .1) return
  context.save()
  context.strokeStyle = layer.color
  context.fillStyle = layer.color
  context.lineWidth = layer.lineWidth
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(g.start.x, g.start.y)
  context.lineTo(g.base.x, g.base.y)
  context.stroke()
  context.beginPath()
  context.moveTo(g.end.x, g.end.y)
  context.lineTo(g.left.x, g.left.y)
  context.lineTo(g.right.x, g.right.y)
  context.closePath()
  context.fill()
  context.restore()
}

export function renderScene(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, layers: Layer[], watermark?: WatermarkConfig) {
  context.clearRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  // Privacy regions are always below annotation objects. They only sample source pixels.
  for (const layer of layers) if (layer.type === 'mosaic') paintMosaic(context, source, layer)
  for (const layer of layers) {
    if (layer.type === 'mosaic') continue
    if (layer.type === 'arrow') { paintArrow(context, layer); continue }
    context.save()
    context.font = canvasFont(layer.font, layer.size)
    context.textBaseline = 'top'
    context.fillStyle = layer.color
    const lines = layer.text.split('\n')
    if (layer.type === 'text') {
      lines.forEach((line, index) => context.fillText(line, layer.x, layer.y + index * layer.size * 1.4))
    } else {
      const diameter = markerDiameter(layer, textMeasure(context))
      const radius = diameter / 2
      context.beginPath()
      context.arc(layer.x + radius, layer.y + radius, radius, 0, Math.PI * 2)
      context.fill()
      // Use contrast appropriate to the custom badge color.
      const rgb = layer.color.replace('#', '')
      const luminance = rgb.length === 6 ? .2126 * parseInt(rgb.slice(0, 2), 16) + .7152 * parseInt(rgb.slice(2, 4), 16) + .0722 * parseInt(rgb.slice(4, 6), 16) : 0
      context.fillStyle = luminance > 155 ? '#24202e' : '#ffffff'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      const label = sequenceLabel(layer.number, layer.style)
      let badgeFontSize = diameter * .55
      context.font = canvasFont(layer.font, badgeFontSize)
      const labelWidth = context.measureText(label).width
      if (labelWidth > diameter * .8) badgeFontSize *= diameter * .8 / labelWidth
      context.font = canvasFont(layer.font, badgeFontSize)
      context.fillText(label, layer.x + radius, layer.y + radius + badgeFontSize * .04)
      context.textAlign = 'left'
      context.textBaseline = 'top'
      context.font = canvasFont(layer.font, layer.size)
      context.fillStyle = layer.color
      const textY = layer.y + Math.max(0, (diameter - lines.length * layer.size * 1.4) / 2)
      lines.forEach((line, index) => context.fillText(line, layer.x + diameter + layer.size * .5, textY + index * layer.size * 1.4))
    }
    context.restore()
  }
  if (watermark?.enabled) paintWatermark(context, width, height, watermark)
}

export function renderSelection(context: CanvasRenderingContext2D, layer: Layer, scale: number) {
  const bounds = layerBounds(layer, textMeasure(context))
  const pad = 4 / scale
  context.save()
  context.strokeStyle = '#8063d5'
  context.lineWidth = 1.5 / scale
  if (layer.type === 'arrow') {
    context.setLineDash([5 / scale, 3 / scale])
    context.beginPath(); context.moveTo(layer.x, layer.y); context.lineTo(layer.endX, layer.endY); context.stroke()
    context.setLineDash([])
    for (const point of [{ x: layer.x, y: layer.y }, { x: layer.endX, y: layer.endY }]) {
      context.fillStyle = '#ffffff'
      context.beginPath(); context.arc(point.x, point.y, 5 / scale, 0, Math.PI * 2); context.fill(); context.stroke()
    }
    context.restore()
    return
  }
  context.setLineDash([5 / scale, 3 / scale])
  context.strokeRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2)
  context.restore()
}
