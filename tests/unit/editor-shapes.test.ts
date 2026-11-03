import { describe, expect, it, vi } from 'vitest'
import { EditHistory, hitTest, layerBounds, moveLayer, resizeShape, shapeHandleAt, shapeHandles, shapeRect, type ShapeLayer } from '../../src/editor/model'
import { paintShape, renderScene, renderSelection } from '../../src/editor/render'

const rectangle: ShapeLayer = { id: 'rectangle', type: 'rectangle', x: 20, y: 30, width: 120, height: 80, color: '#ef5c68', lineWidth: 4, borderStyle: 'solid' }
const ellipse: ShapeLayer = { ...rectangle, id: 'ellipse', type: 'ellipse' }

function drawingContext() {
  return {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), setLineDash: vi.fn(),
    rect: vi.fn(), ellipse: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
    strokeRect: vi.fn(), fillRect: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
    strokeStyle: '', lineWidth: 0, lineCap: 'butt', lineJoin: 'miter',
  } as unknown as CanvasRenderingContext2D
}

describe('空心矩形和椭圆的原图几何', () => {
  it('支持反向拖动，Shift 从四个方向绘制正方形并限制到图片边界', () => {
    expect(shapeRect({ x: 100, y: 80 }, { x: 20, y: 40 }, 300, 200)).toEqual({ x: 20, y: 40, width: 80, height: 40 })
    expect(shapeRect({ x: 100, y: 80 }, { x: 20, y: 40 }, 300, 200, true)).toEqual({ x: 20, y: 0, width: 80, height: 80 })
    expect(shapeRect({ x: 100, y: 80 }, { x: 500, y: 500 }, 300, 200, true)).toEqual({ x: 100, y: 80, width: 120, height: 120 })
    expect(shapeRect({ x: 100, y: 80 }, { x: 150, y: 50 }, 300, 200, true)).toEqual({ x: 100, y: 30, width: 50, height: 50 })
  })

  it('矩形只命中边框，空心区域不会抢占其下的文字标注', () => {
    expect(hitTest([rectangle], { x: 21, y: 31 }, 0)?.id).toBe('rectangle')
    expect(hitTest([rectangle], { x: 70, y: 70 }, 2)).toBeUndefined()
    expect(hitTest([rectangle], { x: 17, y: 70 }, 2)).toBeUndefined()
    expect(hitTest([rectangle], { x: 18, y: 70 }, 2)?.id).toBe('rectangle')
    const text = { id: 'text', type: 'text' as const, x: 50, y: 55, text: '文字', color: '#fff000', size: 20, font: 'Arial' }
    expect(hitTest([text, rectangle], { x: 60, y: 60 }, 0)?.id).toBe('text')
  })

  it('椭圆仅命中弧线，不命中矩形角落或圆心', () => {
    expect(hitTest([ellipse], { x: 80, y: 31 }, 0)?.id).toBe('ellipse')
    expect(hitTest([ellipse], { x: 139, y: 70 }, 0)?.id).toBe('ellipse')
    expect(hitTest([ellipse], { x: 21, y: 31 }, 1)).toBeUndefined()
    expect(hitTest([ellipse], { x: 80, y: 70 }, 2)).toBeUndefined()
    expect(hitTest([ellipse], { x: 80, y: 26 }, 2)).toBeUndefined()
  })

  it('扁椭圆的命中距离依照弧线实际位置，而非缩放后的包围盒', () => {
    const flat: ShapeLayer = { ...ellipse, x: 0, y: 0, width: 1000, height: 40 }
    expect(hitTest([flat], { x: 250, y: 20 }, 2)).toBeUndefined()
    expect(hitTest([flat], { x: 500, y: 1 }, 0)?.id).toBe('ellipse')
    expect(hitTest([flat], { x: 500 + 498 / Math.SQRT2, y: 20 + 18 / Math.SQRT2 }, 0)?.id).toBe('ellipse')
    expect(hitTest([{ ...flat, width: 1 }], { x: .5, y: 20 }, 0)?.id).toBe('ellipse')
  })

  it('移动保持尺寸与边框类型并将完整边框限制在原图内', () => {
    const moved = moveLayer({ ...rectangle, borderStyle: 'dashed' }, -1000, 1000, 300, 200)
    expect(moved).toMatchObject({ x: 0, y: 120, width: 120, height: 80, borderStyle: 'dashed' })
    expect(layerBounds(moved)).toEqual({ x: 0, y: 120, width: 120, height: 80 })
    expect(rectangle.x).toBe(20)
  })

  it('八个角点和边中控制点都可命中，邻近时选最近控制点', () => {
    expect(shapeHandles(rectangle)).toHaveLength(8)
    for (const item of shapeHandles(rectangle)) expect(shapeHandleAt(rectangle, item.point, 4)).toBe(item.handle)
    expect(shapeHandleAt(rectangle, { x: 80, y: 70 }, 4)).toBeUndefined()
    expect(shapeHandleAt({ ...rectangle, width: 4, height: 4 }, { x: 24, y: 34 }, 8)).toBe('se')
  })

  it('角点越过对角锚点时正常翻转，并裁掉原图外的坐标', () => {
    expect(resizeShape(rectangle, 'se', { x: 5, y: 10 }, 300, 200)).toMatchObject({ x: 5, y: 10, width: 15, height: 20 })
    expect(resizeShape(rectangle, 'nw', { x: -50, y: -50 }, 300, 200)).toMatchObject({ x: 0, y: 0, width: 140, height: 110 })
    expect(resizeShape(ellipse, 'se', { x: 500, y: 500 }, 300, 200, true)).toMatchObject({ type: 'ellipse', x: 20, y: 30, width: 170, height: 170 })
  })

  it('拖动边中控制点只改变对应方向，Shift 保持正圆', () => {
    expect(resizeShape(rectangle, 'w', { x: 150, y: 0 }, 300, 200)).toMatchObject({ x: 140, y: 30, width: 10, height: 80 })
    expect(resizeShape(rectangle, 'n', { x: 0, y: 120 }, 300, 200)).toMatchObject({ x: 20, y: 110, width: 120, height: 10 })
    const square = resizeShape(ellipse, 'n', { x: 0, y: -100 }, 300, 200, true)
    expect(square.width).toBe(square.height)
    expect(square.x + square.width / 2).toBe(80)
    expect(square.y).toBe(0)
    const collapsed = resizeShape(rectangle, 'se', { x: 20, y: 30 }, 300, 200)
    expect(collapsed.width).toBe(1)
    expect(collapsed.height).toBe(1)
  })

  it('形状移动、样式变更和删除可精确撤销', () => {
    const history = new EditHistory()
    history.commit([rectangle, ellipse])
    history.commit([{ ...rectangle, borderStyle: 'dotted', lineWidth: 12, color: '#438fe8' }])
    expect(history.undo()).toEqual([rectangle, ellipse])
    expect(history.redo()).toEqual([{ ...rectangle, borderStyle: 'dotted', lineWidth: 12, color: '#438fe8' }])
  })
})

describe('形状绘制与导出', () => {
  it('矩形线条向内绘制，粗细与颜色使用原图参数且保持空心', () => {
    const context = drawingContext()
    paintShape(context, rectangle)
    expect(context.rect).toHaveBeenCalledWith(22, 32, 116, 76)
    expect(context.lineWidth).toBe(4)
    expect(context.strokeStyle).toBe('#ef5c68')
    expect(context.setLineDash).toHaveBeenCalledWith([])
    expect(context.stroke).toHaveBeenCalledOnce()
    expect(context.fill).not.toHaveBeenCalled()
  })

  it('虚线和点线随原图线宽绘制，点线使用圆形端帽', () => {
    const context = drawingContext()
    paintShape(context, { ...rectangle, borderStyle: 'dashed', lineWidth: 6 })
    expect(context.setLineDash).toHaveBeenLastCalledWith([18, 12])
    expect(context.lineCap).toBe('butt')
    paintShape(context, { ...ellipse, borderStyle: 'dotted', lineWidth: 6 })
    expect(context.setLineDash).toHaveBeenLastCalledWith([0, 15])
    expect(context.lineCap).toBe('round')
    expect(context.ellipse).toHaveBeenCalledWith(80, 70, 57, 37, 0, 0, Math.PI * 2)
  })

  it('过粗边框不会超出极小图形，零尺寸草稿跳过绘制', () => {
    const context = drawingContext()
    paintShape(context, { ...ellipse, width: 2, height: 3, lineWidth: 40 })
    expect(context.lineWidth).toBe(2)
    expect(context.ellipse).toHaveBeenCalledWith(21, 31.5, 0, .5, 0, 0, Math.PI * 2)
    vi.mocked(context.stroke).mockClear()
    paintShape(context, { ...rectangle, width: 0 })
    expect(context.stroke).not.toHaveBeenCalled()
  })

  it('场景导出包含形状边框，不会绘制选择控制点或背景填充', () => {
    const context = drawingContext(), source = {} as CanvasImageSource
    renderScene(context, source, 400, 300, [rectangle, ellipse])
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, 400, 300)
    expect(context.stroke).toHaveBeenCalledTimes(2)
    expect(context.fillRect).not.toHaveBeenCalled()
    expect(context.fill).not.toHaveBeenCalled()
  })

  it('选择状态的八个控制点按显示比例保持屏幕尺寸', () => {
    const context = drawingContext()
    renderSelection(context, ellipse, .5)
    expect(context.fillRect).toHaveBeenCalledTimes(8)
    expect(context.fillRect).toHaveBeenCalledWith(13, 23, 14, 14)
    expect(context.strokeRect).toHaveBeenCalledTimes(9)
  })
})
