import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import type { OcrLine } from '../../src/shared'

const require = createRequire(import.meta.url)
const { clipLine, buildParagraphs, prepareOcrLayout } = require('../../electron/ocr-paragraphs.cjs')
const { deduplicateLines } = require('../../electron/ocr.cjs')
const line = (text: string, x: number, y: number, width = 260, height = 20): OcrLine => ({ text, bounds: { x, y, width, height } })
const group = (lines: OcrLine[], hints?: { lines: OcrLine[] }[]) => buildParagraphs(lines, 1000, 12000, hints) as { id: string; text: string; bounds: OcrLine['bounds']; lines: OcrLine[] }[]

describe('OCR 段落与原图位置', () => {
  it('根据行距组合多行中文，保留段落之间的空隙', () => {
    const result = group([
      line('第一段的第一行', 40, 30), line('第一段的第二行', 40, 58, 190),
      line('第二段的第一行', 40, 125), line('第二段的第二行', 40, 153, 210),
    ])
    expect(result.map(item => item.text)).toEqual(['第一段的第一行\n第一段的第二行', '第二段的第一行\n第二段的第二行'])
    expect(result[0]!.bounds).toEqual({ x: 40, y: 30, width: 260, height: 48 })
    expect(result.map(item => item.id)).toEqual(['ocr-paragraph-1', 'ocr-paragraph-2'])
  })

  it('两栏不混合，并按每栏从上到下排列段落', () => {
    const input = [
      line('左栏第一段', 30, 30), line('右栏第一段', 530, 30),
      line('左栏续行', 30, 58), line('右栏续行', 530, 58),
      line('左栏第二段', 30, 150), line('右栏第二段', 530, 150),
    ]
    const result = group(input)
    expect(result.map(item => item.text)).toEqual(['左栏第一段\n左栏续行', '左栏第二段', '右栏第一段\n右栏续行', '右栏第二段'])
    expect(new Set(result.flatMap(item => item.lines)).size).toBe(input.length)
    expect(result.flatMap(item => item.lines)).toHaveLength(input.length)
  })

  it('横跨两栏的标题先于左栏和右栏正文，不合并不同字号', () => {
    const result = group([
      line('跨栏标题', 30, 10, 760, 32),
      line('左栏正文', 30, 70), line('右栏正文', 530, 70),
      line('左栏续行', 30, 98), line('右栏续行', 530, 98),
    ])
    expect(result.map(item => item.text)).toEqual(['跨栏标题', '左栏正文\n左栏续行', '右栏正文\n右栏续行'])
    const heading = group([line('大标题', 30, 10, 200, 34), line('正文字体', 30, 50, 250, 20)])
    expect(heading).toHaveLength(2)
  })

  it('中文首行缩进归入随后正文，新缩进另起段落', () => {
    const result = group([
      line('第一段缩进', 70, 20, 220), line('第一段续行', 30, 48), line('第一段末行', 30, 76, 190),
      line('第二段缩进', 70, 104, 220), line('第二段续行', 30, 132),
    ])
    expect(result.map(item => item.lines.length)).toEqual([3, 2])
    expect(result[1]!.text).toBe('第二段缩进\n第二段续行')
  })

  it('保留离线引擎的段落分隔，不按相邻行距重新合并', () => {
    const input = [line('紧邻的段落一', 30, 20), line('紧邻的段落二', 30, 48), line('未提供段落的尾行', 30, 76)]
    const result = group(input, [{ lines: [input[0]!] }, { lines: [input[1]!] }])
    expect(result.map(item => item.text)).toEqual(input.map(item => item.text))
    expect(result.flatMap(item => item.lines)).toHaveLength(3)
  })

  it('相同位置的去重行只归属一个引擎段落，重复提示不会重复展示', () => {
    const input = [line('繁 花 有 图', 30, 20), line('繁花有图', 31, 21)]
    const clean = deduplicateLines(input)
    const result = group(clean, [{ lines: input }, { lines: input }])
    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe('繁花有图')
    expect(result[0]!.lines).toHaveLength(1)
  })

  it('长图分块接缝先去重再连续分段，坐标保持原始像素', () => {
    const input = [line('接缝上一行', 40, 9860), line('接缝文字', 40, 9888), line('接缝文字', 41, 9889), line('接缝下一行', 40, 9916)]
    const result = group(deduplicateLines(input))
    expect(result).toHaveLength(1)
    expect(result[0]!.lines).toHaveLength(3)
    expect(result[0]!.bounds).toEqual({ x: 40, y: 9860, width: 260, height: 76 })
  })

  it('裁剪越界位置并剔除无效、屏外和空文字，不生成虚假段落', () => {
    expect(clipLine(line('部分可见', -10, -5, 30, 20), 100, 80)).toEqual(line('部分可见', 0, 0, 20, 15))
    expect(clipLine(line('右下边缘', 90, 75, 30, 20), 100, 80)).toEqual(line('右下边缘', 90, 75, 10, 5))
    expect(clipLine(line('屏外', 120, 20), 100, 80)).toBeNull()
    expect(clipLine(line('非法', NaN, 20), 100, 80)).toBeNull()
    expect(clipLine(line('空尺寸', 0, 0, -1), 100, 80)).toBeNull()
    expect(clipLine(line('   ', 0, 0), 100, 80)).toBeNull()
    expect(group([])).toEqual([])
  })

  it('只有一行也返回可点击段落，反序输入产生同样的稳定编号', () => {
    expect(group([line('单行', 40, 40)])[0]).toMatchObject({ id: 'ocr-paragraph-1', text: '单行', bounds: { x: 40, y: 40, width: 260, height: 20 } })
    const input = [line('第二段', 40, 200), line('第一段', 40, 40)]
    expect(group(input)).toEqual(group([...input].reverse()))
  })

  it('拆开引擎错误合并的跨栏行，保留同栏短续行并按栏排序', () => {
    const title = line('横跨两栏标题', 30, 10, 800, 30)
    const merged = { ...line('Left one Right one', 30, 80, 750), words: [line('Left', 30, 80, 60), line('one', 98, 80, 50), line('Right', 530, 80, 80), line('one', 618, 80, 50)] }
    const continued = { ...line('Left two Right two', 30, 108, 750), words: [line('Left', 30, 108, 60), line('two', 98, 108, 50), line('Right', 530, 108, 80), line('two', 618, 108, 50)] }
    const short = line('Left third', 30, 136, 118)
    const bottomLeft = line('Left paragraph two', 30, 210), bottomRight = line('Right paragraph two', 530, 210)
    const prepared = prepareOcrLayout({ lines: [title, merged, continued, short, bottomLeft, bottomRight], paragraphs: [{ lines: [merged, continued] }] })
    expect(prepared.paragraphs).toBeUndefined()
    expect(group(prepared.lines).map(item => item.text)).toEqual(['横跨两栏标题', 'Left one\nLeft two\nLeft third', 'Left paragraph two', 'Right one\nRight two', 'Right paragraph two'])
  })

  it('普通词间距不会触发拆栏，保留引擎原来的段落提示', () => {
    const normal = { ...line('Hello OCR world', 20, 20, 230), words: [line('Hello', 20, 20, 50), line('OCR', 80, 20, 45), line('world', 135, 20, 60)] }
    const paragraphs = [{ lines: [normal] }]
    expect(prepareOcrLayout({ lines: [normal], paragraphs })).toEqual({ lines: [normal], paragraphs })
  })
})
