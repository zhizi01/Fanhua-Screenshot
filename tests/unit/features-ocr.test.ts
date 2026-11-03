import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)
const { createOcrService, deduplicateLines, normalizeText, validatePngBuffer } = require('../../electron/ocr.cjs')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ6sAAAAASUVORK5CYII=', 'base64')

describe('本地 OCR 边界与生命周期', () => {
  it('合并重叠分块中的重复文字并保留空间位置不同的相同内容', () => {
    const lines = deduplicateLines([
      { text: '繁 花 有 图', bounds: { x: 5, y: 100, width: 100, height: 20 } },
      { text: '繁花有图', bounds: { x: 6, y: 101, width: 98, height: 20 } },
      { text: '繁花有图', bounds: { x: 5, y: 200, width: 100, height: 20 } },
      { text: 'Hello OCR', bounds: { x: 5, y: 5, width: 100, height: 20 } },
    ])
    expect(lines.map((line: { text: string }) => line.text)).toEqual(['Hello OCR', '繁花有图', '繁花有图'])
    expect(normalizeText('Hello OCR 繁 花')).toBe('Hello OCR 繁花')
  })
  it('在进入任一 OCR 引擎前拒绝无效输入和超大图片', async () => {
    const service = createOcrService({ preferNative: false })
    await expect(service.recognize(Buffer.from('invalid'))).rejects.toThrow('数据无效')
    const oversized = Buffer.from(png); oversized.writeUInt32BE(40000, 16)
    expect(() => validatePngBuffer(oversized)).toThrow('尺寸')
    service.dispose()
    await expect(service.recognize(png)).rejects.toThrow('已关闭')
  })
  it.runIf(process.platform === 'win32')('限制同时识别并清理临时图片文件', async () => {
    let release: (() => void) | undefined, input = ''
    const pending = new Promise<void>(resolve => { release = resolve })
    const service = createOcrService({
      modelPath: path.join(os.tmpdir(), 'fanhua-nonexistent-model-test'),
      nativeRunner: async (mode: string, imagePath: string) => {
        if (mode === 'capabilities') return { available: true, languages: [{ tag: 'en-US', name: '英语' }] }
        input = imagePath
        expect(await fs.readFile(imagePath)).toEqual(png)
        await pending
        return { lines: [], language: 'en-US' }
      },
    })
    const first = service.recognize(png)
    await expect(service.recognize(png)).rejects.toThrow('正在进行')
    release?.()
    expect(await first).toMatchObject({ text: '', lines: [], paragraphs: [], width: 1, height: 1 })
    await expect(fs.stat(input)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.dirname(input))).rejects.toMatchObject({ code: 'ENOENT' })
    service.dispose()
  })
})
