import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { WatermarkPlacement } from '../../src/shared'
import { watermarkLayout, rotatedSize } from '../../src/watermark/layout'
import { defaultWatermark, loadWatermarkImage, paintWatermark } from '../../src/watermark/render'
import { deletePreset, listPresets, plainWatermark, savePreset } from '../../src/watermark/presets'

afterEach(() => vi.unstubAllGlobals())

describe('水印位置与旋转边界', () => {
  it('旋转后四角仍保留指定边距，而不是把原始未旋转矩形贴边', () => {
    const positions: WatermarkPlacement[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
    for (const position of positions) {
      const layout = watermarkLayout(800, 600, 180, 50, position, 24, 100, 45)
      const center = layout.centers[0]!
      const left = center.x - layout.rotatedWidth / 2
      const right = center.x + layout.rotatedWidth / 2
      const top = center.y - layout.rotatedHeight / 2
      const bottom = center.y + layout.rotatedHeight / 2
      expect(left).toBeGreaterThanOrEqual(24 - 1e-8)
      expect(right).toBeLessThanOrEqual(776 + 1e-8)
      expect(top).toBeGreaterThanOrEqual(24 - 1e-8)
      expect(bottom).toBeLessThanOrEqual(576 + 1e-8)
      expect(position.endsWith('left') ? left : 800 - right).toBeCloseTo(24)
      expect(position.startsWith('top') ? top : 600 - bottom).toBeCloseTo(24)
    }
  })

  it('中心位置不随旋转和文字尺寸偏移', () => {
    for (const angle of [-180, -90, -37, 0, 45, 90, 180]) {
      expect(watermarkLayout(321, 179, 110, 27, 'center', 14, 20, angle).centers).toEqual([{ x: 160.5, y: 89.5 }])
    }
    expect(rotatedSize(100, 20, 90)).toEqual({ width: expect.closeTo(20), height: expect.closeTo(100) })
  })

  it('小截图中的超大图片与边距不会使水印完全落到图外，且保留比例', () => {
    const layout = watermarkLayout(30, 20, 2048, 1024, 'bottom-right', 1000, 100, 25)
    expect(layout.width / layout.height).toBeCloseTo(2)
    expect(layout.rotatedWidth).toBeLessThanOrEqual(12 + 1e-8)
    expect(layout.rotatedHeight).toBeLessThanOrEqual(2 + 1e-8)
    const center = layout.centers[0]!
    expect(center.x + layout.rotatedWidth / 2).toBeCloseTo(21)
    expect(center.y + layout.rotatedHeight / 2).toBeCloseTo(11)
  })

  it('全图平铺覆盖多个方向，并限制大图上密集水印的绘制量', () => {
    const layout = watermarkLayout(2400, 1600, 160, 40, 'tile', 24, 100, -30)
    expect(layout.centers.length).toBeGreaterThan(20)
    expect(new Set(layout.centers.map(center => center.x)).size).toBeGreaterThan(5)
    expect(new Set(layout.centers.map(center => center.y)).size).toBeGreaterThan(5)
    const dense = watermarkLayout(32000, 3000, 1, 1, 'tile', 0, 0, 0)
    expect(dense.centers.length).toBeGreaterThan(0)
    expect(dense.centers.length).toBeLessThanOrEqual(1600)
    expect(new Set(dense.centers.map(center => `${center.x}:${center.y}`)).size).toBe(dense.centers.length)
  })
})

describe('水印绘制与数据边界', () => {
  it('拒绝网络资源与超限图片，避免未经验证的图片进入绘制缓存', async () => {
    const create = vi.fn()
    vi.stubGlobal('Image', create)
    await expect(loadWatermarkImage('https://example.com/logo.png')).rejects.toThrow('PNG')
    await expect(loadWatermarkImage(`data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}`)).rejects.toThrow('8 MB')
    expect(create).not.toHaveBeenCalled()
  })

  it('解码失败后可以重试，同一图片并行加载只解码一次', async () => {
    let attempts = 0
    vi.stubGlobal('Image', class {
      src = ''
      naturalWidth = 128
      naturalHeight = 64
      async decode() { if (++attempts === 1) throw new Error('decode failed') }
    })
    const source = 'data:image/png;base64,cmV0cnktaW1hZ2U='
    await expect(loadWatermarkImage(source)).rejects.toThrow('无法解码')
    await Promise.all([loadWatermarkImage(source), loadWatermarkImage(source)])
    expect(attempts).toBe(2)
  })

  it('解码缓存有容量限制，被淘汰的图片会重新解码', async () => {
    let attempts = 0
    vi.stubGlobal('Image', class {
      src = ''
      naturalWidth = 128
      naturalHeight = 64
      async decode() { attempts++ }
    })
    const sources = [0, 1, 2, 3].map(index => `data:image/png;base64,${btoa(`cache-image-${index}`)}`)
    for (const source of sources) await loadWatermarkImage(source)
    await loadWatermarkImage(sources[3]!)
    expect(attempts).toBe(4)
    await loadWatermarkImage(sources[0]!)
    expect(attempts).toBe(5)
  })

  it('禁用或完全透明的水印不改变图片', () => {
    const context = { save: vi.fn() } as unknown as CanvasRenderingContext2D
    paintWatermark(context, 800, 600, defaultWatermark())
    paintWatermark(context, 800, 600, { ...defaultWatermark(), enabled: true, opacity: 0 })
    expect(context.save).not.toHaveBeenCalled()
  })

  it('文本水印保持多行、透明度和旋转，且限制绘制到图片内部', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 20 }),
      translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), fillText: vi.fn(),
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D
    paintWatermark(context, 800, 600, { ...defaultWatermark(), enabled: true, text: '第一行\n第二行', opacity: .3, rotation: 30, placement: 'center' })
    expect(context.rect).toHaveBeenCalledWith(0, 0, 800, 600)
    expect(context.clip).toHaveBeenCalledOnce()
    expect(context.globalAlpha).toBe(.3)
    expect(context.translate).toHaveBeenCalledWith(400, 300)
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 6)
    expect(context.fillText).toHaveBeenCalledTimes(2)
    expect(context.save).toHaveBeenCalledTimes(2)
    expect(context.restore).toHaveBeenCalledTimes(2)
  })

  it('复制响应式配置为可跨隔离桥传输的普通数据，并夹紧异常数值', () => {
    const value = reactive({ ...defaultWatermark(), opacity: 4, rotation: 999, fontSize: NaN })
    const plain = plainWatermark(value)
    expect(structuredClone(plain)).toEqual(plain)
    expect(plain).toMatchObject({ opacity: 1, rotation: 180, fontSize: 28 })
  })
})

describe('浏览器演示水印存档', () => {
  function storage() {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  }

  it('另存、覆盖、重新读取与删除保留实际样式且不产生重复项', async () => {
    storage()
    const saved = await savePreset('  作者水印  ', { ...defaultWatermark(), enabled: true, text: '原作者', opacity: .45 })
    expect(saved.name).toBe('作者水印')
    await savePreset('作者水印更新', { ...saved.config, text: '更改后的作者', placement: 'tile' }, saved.id)
    const loaded = await listPresets()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ id: saved.id, name: '作者水印更新', config: { text: '更改后的作者', placement: 'tile', opacity: .45 } })
    await deletePreset(saved.id)
    expect(await listPresets()).toEqual([])
  })

  it('存储失败明确报错，不把水印标记为已存档', async () => {
    storage()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } })
    await expect(savePreset('图片水印', defaultWatermark())).rejects.toThrow('未保存')
  })
})
