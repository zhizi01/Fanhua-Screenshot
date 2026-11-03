import { layerBounds, markerDiameter, sequenceLabel, type Layer, type MosaicLayer } from './model'

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

export function renderScene(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, layers: Layer[]) {
  context.clearRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  // Privacy regions are always below annotation objects. They only sample source pixels.
  for (const layer of layers) if (layer.type === 'mosaic') paintMosaic(context, source, layer)
  for (const layer of layers) {
    if (layer.type === 'mosaic') continue
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
      context.fillText(sequenceLabel(layer.number, layer.style), layer.x + radius, layer.y + radius + layer.size * .04)
      context.textAlign = 'left'
      context.textBaseline = 'top'
      context.fillStyle = layer.color
      const textY = layer.y + Math.max(0, (diameter - lines.length * layer.size * 1.4) / 2)
      lines.forEach((line, index) => context.fillText(line, layer.x + diameter + layer.size * .5, textY + index * layer.size * 1.4))
    }
    context.restore()
  }
}

export function renderSelection(context: CanvasRenderingContext2D, layer: Layer, scale: number) {
  const bounds = layerBounds(layer, textMeasure(context))
  const pad = 4 / scale
  context.save()
  context.strokeStyle = '#8063d5'
  context.lineWidth = 1.5 / scale
  context.setLineDash([5 / scale, 3 / scale])
  context.strokeRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2)
  context.setLineDash([])
  context.fillStyle = '#ffffff'
  const handle = 5 / scale
  for (const [x, y] of [[bounds.x - pad, bounds.y - pad], [bounds.x + bounds.width + pad, bounds.y - pad], [bounds.x - pad, bounds.y + bounds.height + pad], [bounds.x + bounds.width + pad, bounds.y + bounds.height + pad]]) {
    context.fillRect(x! - handle / 2, y! - handle / 2, handle, handle)
    context.strokeRect(x! - handle / 2, y! - handle / 2, handle, handle)
  }
  context.restore()
}
