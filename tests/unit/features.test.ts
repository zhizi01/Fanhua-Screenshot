import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)
const { createFeatureHandlers, createPresetStore, validateWatermarkConfig, parseImageDataUrl, encodeBmp, webpDimensions } = require('../../electron/features.cjs')
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ6sAAAAASUVORK5CYII='
const webp = Buffer.from('UklGRmYAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgID/gABWUDggOgAAADACAJ0BKgIAAgABQCYloAJ0ugH4AALSLA0AAP7xu3HC9+uwbbicYZ6x5/+fmd24v6rf/G7cYb70AAA=', 'base64')
const folders: string[] = []
async function directory() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fanhua-features-test-')); folders.push(dir); return dir }
afterEach(async () => {
  for (const dir of folders.splice(0)) {
    // Only these generated test directories are recursively removed.
    if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('fanhua-features-test-')) throw new Error('测试目录边界无效')
    await fs.rm(dir, { recursive: true, force: true })
  }
})
const image = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => parseImageDataUrl(png) }
const nativeImage = { createFromBuffer: vi.fn(() => image) }
const config = {
  enabled: true, kind: 'text', text: '繁花有图\n内部资料', font: '微软雅黑', fontSize: 28, color: '#555555',
  imageDataUrl: '', imageWidth: 0, imageHeight: 0, scale: .35, placement: 'bottom-right', opacity: .18, rotation: 0, margin: 24, spacing: 100,
}

describe('原生图片保存', () => {
  it('拒绝格式不匹配及损坏的 WebP 容器', () => {
    expect(() => parseImageDataUrl(png, 'image/jpeg')).toThrow('不一致')
    expect(webpDimensions(webp)).toEqual({ width: 2, height: 2 })
    const broken = Buffer.from(webp); broken.writeUInt32LE(100000, 16)
    expect(() => webpDimensions(broken)).toThrow()
    expect(() => webpDimensions(webp.subarray(0, -1))).toThrow()
  })
  it('24 位 BMP 正确处理上下方向、行对齐与半透明白底', () => {
    const bmp = encodeBmp({
      getSize: () => ({ width: 1, height: 2 }),
      toBitmap: () => Buffer.from([0, 0, 128, 128, 0, 255, 0, 255]),
    })
    expect(bmp.toString('ascii', 0, 2)).toBe('BM')
    expect(bmp.readUInt16LE(28)).toBe(24)
    expect(bmp.readUInt32LE(2)).toBe(62)
    expect([...bmp.subarray(54)]).toEqual([0, 255, 0, 0, 127, 127, 255, 0])
  })
  it('扩展名冲突时不误写或覆盖另一种格式的文件', async () => {
    const dir = await directory(), output = path.join(dir, '已有图片.jpg')
    await fs.writeFile(output, '原文件')
    const handlers = createFeatureHandlers({ app: { getPath: () => dir }, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: output }) }, nativeImage, clipboard: {}, helper: {} })
    await expect(handlers.saveImage(null, png)).rejects.toThrow('扩展名')
    expect(await fs.readFile(output, 'utf8')).toBe('原文件')
    handlers.dispose()
  })
  it('保持默认 PNG 契约，并直接保存通过校验的 WebP', async () => {
    const dir = await directory()
    let output = path.join(dir, '截图.png')
    const handlers = createFeatureHandlers({ app: { getPath: () => dir }, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: output }) }, nativeImage, clipboard: {}, helper: {} })
    await expect(handlers.saveImage(null, png)).resolves.toEqual({ canceled: false, filePath: output })
    expect(await fs.readFile(output)).toEqual(parseImageDataUrl(png))
    output = path.join(dir, '截图.webp')
    const before = nativeImage.createFromBuffer.mock.calls.length
    await handlers.saveImage(null, `data:image/webp;base64,${webp.toString('base64')}`, { format: 'webp', quality: 92 })
    expect(nativeImage.createFromBuffer.mock.calls.length).toBe(before)
    expect(await fs.readFile(output)).toEqual(webp)
    handlers.dispose()
  })
})

describe('水印存档与输入校验', () => {
  it('拒绝越界设置，保留中文且只持久化明确的配置字段', () => {
    for (const patch of [{ opacity: 2 }, { fontSize: NaN }, { placement: '../目录' }, { color: 'url(secret)' }, { kind: 'image' }, { text: 'x'.repeat(2001) }]) {
      expect(() => validateWatermarkConfig({ ...config, ...patch }, nativeImage)).toThrow()
    }
    const clean = validateWatermarkConfig({ ...config, unknown: '不应持久化' }, nativeImage)
    expect(clean.text).toBe('繁花有图\n内部资料')
    expect(clean.unknown).toBeUndefined()
  })
  it('并发保存不会丢失存档，UTF-8 存档可以更新、重载和删除', async () => {
    const file = path.join(await directory(), 'watermarks.json')
    const store = createPresetStore(file, nativeImage)
    const saved = await Promise.all(['甲', '乙', '丙'].map(name => store.save({ name, config })))
    expect(await store.list()).toHaveLength(3)
    expect(await fs.readFile(file, 'utf8')).toContain('繁花有图')
    await store.save({ id: saved[0].id, name: '修改甲', config: { ...config, opacity: .5 } })
    await store.delete(saved[1].id)
    const reloaded = await createPresetStore(file, nativeImage).list()
    expect(reloaded.map((item: { name: string }) => item.name)).toEqual(['修改甲', '丙'])
    expect(await fs.readdir(path.dirname(file))).toEqual(['watermarks.json'])
  })
  it('失败写入不会堵住队列，也不会破坏已有存档', async () => {
    const file = path.join(await directory(), 'watermarks.json'), store = createPresetStore(file, nativeImage)
    const saved = await store.save({ name: '有效', config })
    await expect(store.save({ id: saved.id, name: '无效', config: { ...config, scale: 100 } })).rejects.toThrow()
    await store.save({ name: '后续有效', config })
    expect((await store.list()).map((item: { name: string }) => item.name)).toEqual(['有效', '后续有效'])
    await expect(store.delete('../anything')).rejects.toThrow()
  })
  it('限制最多 30 个存档，已存档仍可更新', async () => {
    const store = createPresetStore(path.join(await directory(), 'watermarks.json'), nativeImage)
    const saved = await Promise.all(Array.from({ length: 30 }, (_, i) => store.save({ name: `存档${i}`, config })))
    await expect(store.save({ name: '第31个', config })).rejects.toThrow('30')
    await expect(store.save({ id: saved[0].id, name: '更新', config })).resolves.toMatchObject({ name: '更新' })
  })
  it('损坏的存档不会被静默覆盖', async () => {
    const file = path.join(await directory(), 'watermarks.json')
    await fs.writeFile(file, '{损坏JSON', 'utf8')
    const store = createPresetStore(file, nativeImage)
    await expect(store.save({ name: '新存档', config })).rejects.toThrow('损坏')
    expect(await fs.readFile(file, 'utf8')).toBe('{损坏JSON')
  })
})

describe('系统字体缓存', () => {
  it('去重排序并在显式刷新时重新读取', async () => {
    const request = vi.fn(async () => ['微软雅黑', 'Arial', 'Arial', ''])
    const handlers = createFeatureHandlers({ app: { getPath: () => os.tmpdir() }, nativeImage, helper: { request }, dialog: {}, clipboard: {} })
    const first = await handlers.getFonts()
    expect(first).toHaveLength(2)
    await handlers.getFonts(); expect(request).toHaveBeenCalledTimes(1)
    await handlers.getFonts(true); expect(request).toHaveBeenCalledTimes(2)
    handlers.dispose()
  })
})
