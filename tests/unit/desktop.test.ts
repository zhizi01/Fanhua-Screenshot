import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { selectionToPixels, intersectRect, decodePngDataUrl } = require('../../electron/geometry.cjs')

describe('桌面截图坐标与边界', () => {
  it('按实际图像尺寸映射高 DPI 屏幕，覆盖选区的所有像素', () => {
    expect(selectionToPixels({ x: 10.2, y: 20.4, width: 100.1, height: 80.2 }, { width: 1920, height: 1080 }, { width: 2880, height: 1620 }))
      .toEqual({ x: 15, y: 30, width: 151, height: 121 })
  })
  it('夹紧超出屏幕的框选并拒绝空选区', () => {
    expect(selectionToPixels({ x: -20, y: -20, width: 60, height: 60 }, { width: 100, height: 100 }, { width: 200, height: 200 }))
      .toEqual({ x: 0, y: 0, width: 80, height: 80 })
    expect(() => selectionToPixels({ x: 110, y: 0, width: 20, height: 30 }, { width: 100, height: 100 }, { width: 200, height: 200 })).toThrow()
    expect(() => selectionToPixels({ x: NaN, y: 0, width: 20, height: 30 }, { width: 100, height: 100 }, { width: 200, height: 200 })).toThrow()
  })
  it('支持负坐标副屏并保持窗口与屏幕交集', () => {
    expect(intersectRect({ x: -150, y: 10, width: 200, height: 100 }, { x: -1920, y: 0, width: 1920, height: 1080 }))
      .toEqual({ x: -150, y: 10, width: 150, height: 100 })
    expect(intersectRect({ x: 20, y: 20, width: 10, height: 10 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toBeNull()
  })
})

describe('图片写入数据校验', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ6sAAAAASUVORK5CYII='
  it('允许合法 PNG 并拒绝任意 URL 与非 PNG 内容', () => {
    expect(decodePngDataUrl(tinyPng).length).toBeGreaterThan(33)
    expect(() => decodePngDataUrl('file:///secret.png')).toThrow()
    expect(() => decodePngDataUrl('data:image/png;base64,aGVsbG8=')).toThrow()
  })
  it('在解码前拒绝超大 PNG 尺寸', () => {
    const malicious = decodePngDataUrl(tinyPng)
    malicious.writeUInt32BE(40000, 16)
    expect(() => decodePngDataUrl(`data:image/png;base64,${malicious.toString('base64')}`)).toThrow()
  })
})
