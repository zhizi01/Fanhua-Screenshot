import { describe, expect, it, vi } from 'vitest'
import { arrowEndpointAt, arrowGeometry, DocumentHistory, EditHistory, hitTest, imagePoint, layerBounds, markerDiameter, moveLayer, normalizeRect, sequenceLabel, type ArrowLayer, type Layer, type MarkerLayer, type MosaicLayer } from '../../src/editor/model'
import { renderScene } from '../../src/editor/render'
import { defaultWatermark } from '../../src/watermark/render'

const text: Layer = { id: 't', type: 'text', x: 20, y: 30, text: '批注', font: 'Arial', size: 20, color: '#f00000' }
const mosaic: MosaicLayer = { id: 'm', type: 'mosaic', x: 10, y: 15, width: 80, height: 40, strength: 20 }
const arrow: ArrowLayer = { id: 'a', type: 'arrow', x: 20, y: 20, endX: 120, endY: 120, color: '#ef5c68', lineWidth: 4, headSize: 24 }

describe('sequence labels', () => {
  it('supports alphabetic carry after Z and ZZ', () => {
    expect([1, 26, 27, 52, 702, 703].map(n => sequenceLabel(n, 'letter'))).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA'])
  })
  it('formats financial Chinese including internal zeroes', () => {
    expect([1, 10, 11, 20, 101, 1001, 1010, 9999].map(n => sequenceLabel(n, 'chinese'))).toEqual(['壹', '壹拾', '壹拾壹', '贰拾', '壹佰零壹', '壹仟零壹', '壹仟零壹拾', '玖仟玖佰玖拾玖'])
  })
  it('normalizes out of range and fractional values', () => {
    expect(sequenceLabel(0, 'number')).toBe('1')
    expect(sequenceLabel(1.9, 'letter')).toBe('A')
    expect(sequenceLabel(10000, 'number')).toBe('9999')
  })
})

describe('image-space geometry', () => {
  it('normalizes a reverse drag and clips it to the original image', () => {
    expect(normalizeRect({ x: 150, y: 90 }, { x: -30, y: -10 }, 100, 60)).toEqual({ x: 0, y: 0, width: 100, height: 60 })
  })
  it('maps CSS pixels to actual pixels at any preview zoom', () => {
    expect(imagePoint(210, 120, { left: 10, top: 20, width: 400, height: 200 }, 1600, 800)).toEqual({ x: 800, y: 400 })
    expect(imagePoint(-30, 900, { left: 10, top: 20, width: 400, height: 200 }, 1600, 800)).toEqual({ x: 0, y: 800 })
  })
  it('selects the topmost overlapping layer and respects multiline bounds', () => {
    expect(hitTest([mosaic, text], { x: 30, y: 40 })?.id).toBe('t')
    // Annotation objects remain above privacy regions even if the mosaic was created later.
    expect(hitTest([text, mosaic], { x: 30, y: 40 })?.id).toBe('t')
    expect(hitTest([text, { ...text, id: 'second' }], { x: 30, y: 40 })?.id).toBe('second')
    expect(layerBounds({ ...text, text: '批注\n第二行' }).height).toBe(56)
  })
  it('keeps the moved layer within the image without mutating the source', () => {
    expect(moveLayer(mosaic, 999, -100, 200, 150)).toMatchObject({ x: 120, y: 0 })
    expect(mosaic).toMatchObject({ x: 10, y: 15 })
  })
})

describe('lossless editing history', () => {
  it('restores deleted mosaics, text changes and their properties exactly', () => {
    const history = new EditHistory()
    history.commit([text, mosaic])
    history.commit([{ ...text, text: '修改后', size: 36 }])
    expect(history.undo()).toEqual([text, mosaic])
    expect(history.redo()).toEqual([{ ...text, text: '修改后', size: 36 }])
  })
  it('takes snapshots independent of subsequent pointer movement', () => {
    const history = new EditHistory()
    const draft: Layer[] = [{ ...mosaic }]
    history.commit(draft)
    draft[0]!.x = 400
    history.commit(draft)
    const previous = history.undo()
    expect(previous[0]!.x).toBe(10)
    previous[0]!.x = 999
    expect(history.redo()[0]!.x).toBe(400)
    expect(history.undo()[0]!.x).toBe(10)
  })
  it('invalidates redo after branching and ignores duplicate commits', () => {
    const history = new EditHistory()
    history.commit([text]); history.commit([text]); history.commit([text, mosaic])
    history.undo(); history.commit([mosaic])
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toEqual([text])
    expect(history.undo()).toEqual([])
    expect(history.canUndo).toBe(false)
  })
})

describe('editable arrows and marker heads', () => {
  it('hits the arrow stroke and filled head without selecting empty bounding-box corners', () => {
    expect(hitTest([arrow], { x: 70, y: 70 }, 2)?.id).toBe('a')
    expect(hitTest([arrow], { x: 25, y: 110 }, 2)).toBeUndefined()
    const geometry = arrowGeometry(arrow)
    const insideHead = { x: (geometry.end.x + geometry.left.x + geometry.right.x) / 3, y: (geometry.end.y + geometry.left.y + geometry.right.y) / 3 }
    expect(hitTest([arrow], insideHead, 0)?.id).toBe('a')
    expect(arrowEndpointAt(arrow, { x: 23, y: 24 }, 5)).toBe('start')
    expect(arrowEndpointAt(arrow, { x: 120, y: 120 }, 5)).toBe('end')
    expect(arrowEndpointAt(arrow, { x: 70, y: 70 }, 5)).toBeUndefined()
  })
  it('moves and clips both endpoints together, retaining the original direction and length', () => {
    const moved = moveLayer(arrow, 1000, -1000, 200, 200) as ArrowLayer
    expect(moved.endX - moved.x).toBe(100)
    expect(moved.endY - moved.y).toBe(100)
    const bounds = layerBounds(moved)
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(200)
    expect(arrow.x).toBe(20)
  })
  it('bounds a short reversed arrow head by its length and handles a zero-length draft', () => {
    const geometry = arrowGeometry({ ...arrow, x: 120, y: 120, endX: 115, endY: 120, headSize: 160 })
    expect(geometry.length).toBe(5)
    expect(geometry.base.x).toBe(119)
    expect(arrowGeometry({ ...arrow, endX: 20, endY: 20 }).length).toBe(0)
  })
  it('changes the sequence head without changing description typography and supports older markers', () => {
    const marker: MarkerLayer = { ...text, type: 'marker', number: 1, style: 'number', text: '说明', headSize: 80 }
    expect(markerDiameter(marker)).toBe(80)
    expect(markerDiameter({ ...marker, size: 80 })).toBe(80)
    expect(layerBounds(marker).height).toBe(80)
    const legacy = { ...marker, headSize: undefined }
    expect(markerDiameter(legacy)).toBeGreaterThanOrEqual(marker.size * 1.8)
  })
})

describe('document undo and redo', () => {
  it('restores watermark changes and arrow deletion in their original order', () => {
    const watermark = defaultWatermark()
    const history = new DocumentHistory({ layers: [], watermark })
    history.commit({ layers: [arrow], watermark })
    history.commit({ layers: [arrow], watermark: { ...watermark, enabled: true, text: '内部资料' } })
    history.commit({ layers: [], watermark: { ...watermark, enabled: true, text: '内部资料' } })
    expect(history.undo().layers).toEqual([arrow])
    expect(history.undo().watermark).toEqual(watermark)
    expect(history.redo().watermark.text).toBe('内部资料')
  })
  it('takes isolated snapshots while sharing immutable image strings and discards a redo branch', () => {
    const watermark = { ...defaultWatermark(), imageDataUrl: 'data:image/png;base64,example' }
    const history = new DocumentHistory({ layers: [], watermark })
    history.commit({ layers: [arrow], watermark })
    watermark.opacity = .7
    history.commit({ layers: [arrow], watermark })
    const previous = history.undo()
    expect(previous.watermark.opacity).not.toBe(.7)
    previous.watermark.text = '外部修改'
    expect(history.redo().watermark.text).not.toBe('外部修改')
    history.undo()
    history.commit({ layers: [mosaic], watermark })
    expect(history.canRedo).toBe(false)
  })
})

describe('mosaic rendering', () => {
  it('always samples original pixels, changes strength and restores source on deletion', () => {
    const source = {} as CanvasImageSource
    const downsample = { drawImage: vi.fn() }
    const sampleCanvas = { width: 0, height: 0, getContext: () => downsample }
    vi.stubGlobal('document', { createElement: () => sampleCanvas })
    const ctx = { clearRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), imageSmoothingEnabled: true } as unknown as CanvasRenderingContext2D
    renderScene(ctx, source, 800, 600, [mosaic])
    expect(downsample.drawImage).toHaveBeenCalledWith(source, 10, 15, 80, 40, 0, 0, 4, 2)
    renderScene(ctx, source, 800, 600, [{ ...mosaic, strength: 40 }])
    expect(downsample.drawImage).toHaveBeenLastCalledWith(source, 10, 15, 80, 40, 0, 0, 2, 1)
    downsample.drawImage.mockClear()
    vi.mocked(ctx.drawImage).mockClear()
    renderScene(ctx, source, 800, 600, [])
    expect(downsample.drawImage).not.toHaveBeenCalled()
    expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(source, 0, 0, 800, 600)
    vi.unstubAllGlobals()
  })
})
