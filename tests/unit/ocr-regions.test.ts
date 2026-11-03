import { describe, expect, it } from 'vitest'
import type { OcrParagraph } from '../../src/shared'
import { clipOcrBounds, hitOcrParagraph, ocrRegionStyle } from '../../src/ocr/regions'

const paragraph = (id: string, x: number, y: number, width: number, height: number): OcrParagraph => ({ id, text: id, bounds: { x, y, width, height }, lines: [] })

describe('OCR 虚拟识别区域', () => {
  it('保留小数坐标并裁剪图片外的识别边界', () => {
    expect(clipOcrBounds({ x: -5.5, y: 12.5, width: 40, height: 95 }, 100, 100)).toEqual({ x: 0, y: 12.5, width: 34.5, height: 87.5 })
    expect(clipOcrBounds({ x: 80, y: 20, width: 30, height: 20 }, 100, 100)).toEqual({ x: 80, y: 20, width: 20, height: 20 })
  })
  it('拒绝空区域、图片外区域和无效引擎坐标', () => {
    for (const bounds of [
      { x: 0, y: 0, width: 0, height: 10 },
      { x: 100, y: 20, width: 20, height: 20 },
      { x: 1, y: 1, width: NaN, height: 10 },
      { x: -20, y: 0, width: 5, height: 10 },
    ]) expect(clipOcrBounds(bounds, 100, 100)).toBeUndefined()
    expect(clipOcrBounds({ x: 1, y: 1, width: 10, height: 10 }, 0, 100)).toBeUndefined()
  })
  it('按原图坐标命中段落，重叠时选择更具体的小区域', () => {
    const large = paragraph('large', 10, 10, 100, 100)
    const small = paragraph('small', 20, 20, 30, 20)
    const invalid = paragraph('invalid', 20, 20, 0, 10)
    expect(hitOcrParagraph([large, small, invalid], { x: 25, y: 30 })?.id).toBe('small')
    expect(hitOcrParagraph([large, small], { x: 90, y: 90 })?.id).toBe('large')
    expect(hitOcrParagraph([large, small], { x: 0, y: 0 })).toBeUndefined()
    expect(hitOcrParagraph([large], { x: Infinity, y: 20 })).toBeUndefined()
  })
  it('CSS 百分比随图像缩放而保持边界，无效框不生成样式', () => {
    expect(ocrRegionStyle({ x: 25, y: 40, width: 50, height: 20 }, 100, 200)).toEqual({ left: '25%', top: '20%', width: '50%', height: '10%' })
    expect(ocrRegionStyle({ x: 105, y: 40, width: 50, height: 20 }, 100, 200)).toBeUndefined()
  })
})
