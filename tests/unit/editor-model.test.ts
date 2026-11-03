import { describe, expect, it, vi } from 'vitest'
import { EditHistory, hitTest, imagePoint, layerBounds, moveLayer, normalizeRect, sequenceLabel, type Layer, type MosaicLayer } from '../../src/editor/model'
import { renderScene } from '../../src/editor/render'

const text: Layer = { id: 't', type: 'text', x: 20, y: 30, text: '批注', font: 'Arial', size: 20, color: '#f00000' }
const mosaic: MosaicLayer = { id: 'm', type: 'mosaic', x: 10, y: 15, width: 80, height: 40, strength: 20 }

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
