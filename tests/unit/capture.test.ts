import { describe, expect, it } from 'vitest'
import { clampPoint, clipRect, containsPoint, dragRect, isDrag, pixelRect, pixelSize, windowAtPoint } from '../../src/capture/geometry'
import type { WindowRegion } from '../../src/shared'

describe('截图选区的屏幕局部坐标', () => {
  it('从右下向左上拖动时归一化并保持正确位置', () => {
    expect(dragRect({ x: 400, y: 300 }, { x: 100, y: 70 }, 1920, 1080))
      .toEqual({ x: 100, y: 70, width: 300, height: 230 })
  })

  it('捕获指针越出屏幕时仍限制在屏幕内', () => {
    expect(dragRect({ x: 300, y: 200 }, { x: -100, y: 1200 }, 1920, 1080))
      .toEqual({ x: 0, y: 200, width: 300, height: 880 })
    expect(clampPoint({ x: 2000, y: -10 }, 1920, 1080)).toEqual({ x: 1920, y: 0 })
  })

  it('忽略鼠标轻微抖动，达到阈值才变为框选', () => {
    expect(isDrag({ x: 20, y: 20 }, { x: 22, y: 22 })).toBe(false)
    expect(isDrag({ x: 20, y: 20 }, { x: 24, y: 20 })).toBe(true)
  })

  it('使用真实截图尺寸换算高 DPI 像素而不假定整数缩放', () => {
    expect(pixelSize({ x: 20, y: 30, width: 180, height: 90 }, 1536, 864, 1920, 1080))
      .toEqual({ width: 225, height: 113 })
  })

  it('150% DPI 下标签与裁剪共同覆盖小数选区端点，避免少显示一像素', () => {
    const rect = { x: 10.2, y: 20.4, width: 100.1, height: 80.2 }
    expect(pixelRect(rect, 1920, 1080, 2880, 1620))
      .toEqual({ x: 15, y: 30, width: 151, height: 121 })
    expect(pixelSize(rect, 1920, 1080, 2880, 1620))
      .toEqual({ width: 151, height: 121 })
  })

  it('像素端点取整仍夹紧在真实图像边界，演示裁剪不会补出透明像素', () => {
    expect(pixelRect({ x: 1919.5, y: 1079.5, width: 5, height: 5 }, 1920, 1080, 2880, 1620))
      .toEqual({ x: 2879, y: 1619, width: 1, height: 1 })
    expect(pixelRect({ x: -2.2, y: -2.2, width: 5.2, height: 5.2 }, 1920, 1080, 2880, 1620))
      .toEqual({ x: 0, y: 0, width: 5, height: 5 })
  })
})

describe('窗口自动识别', () => {
  const windows: WindowRegion[] = [
    { id: 'top', title: '置顶窗口', x: 100, y: 100, width: 300, height: 200 },
    { id: 'back', title: '后方窗口', x: 0, y: 0, width: 1000, height: 700 },
  ]

  it('重叠区域总是优先命中最上层窗口', () => {
    expect(windowAtPoint(windows, { x: 150, y: 150 }, 1920, 1080)?.id).toBe('top')
    expect(windowAtPoint(windows, { x: 450, y: 150 }, 1920, 1080)?.id).toBe('back')
  })

  it('鼠标不在窗口中返回空，由界面回退到全屏', () => {
    expect(windowAtPoint(windows, { x: 1100, y: 750 }, 1920, 1080)).toBeUndefined()
  })

  it('跨屏窗口裁剪到当前显示器，而不是生成越界截图', () => {
    const crossing = [{ id: 'cross', title: '跨屏窗口', x: -250, y: -20, width: 600, height: 400 }]
    expect(windowAtPoint(crossing, { x: 100, y: 100 }, 1920, 1080))
      .toEqual({ id: 'cross', title: '跨屏窗口', x: 0, y: 0, width: 350, height: 380 })
    expect(clipRect({ x: 1800, y: 1000, width: 600, height: 300 }, 1920, 1080))
      .toEqual({ x: 1800, y: 1000, width: 120, height: 80 })
  })

  it('不命中零面积或右边界外的窗口', () => {
    expect(containsPoint({ x: 0, y: 0, width: 0, height: 100 }, { x: 0, y: 0 })).toBe(false)
    expect(containsPoint(windows[0]!, { x: 400, y: 150 })).toBe(false)
  })
})
