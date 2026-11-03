import { describe, expect, it } from 'vitest'
import { encodeBmp } from '../../src/editor/export'

describe('BMP export', () => {
  it('writes a valid bottom-up BGR bitmap with padded rows', () => {
    const bytes = encodeBmp(1, 2, new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]))
    const header = new DataView(bytes.buffer)
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('BM')
    expect(header.getUint32(2, true)).toBe(62)
    expect(header.getUint32(10, true)).toBe(54)
    expect(header.getInt32(18, true)).toBe(1)
    expect(header.getInt32(22, true)).toBe(2)
    expect(header.getUint16(28, true)).toBe(24)
    expect([...bytes.slice(54)]).toEqual([255, 0, 0, 0, 0, 0, 255, 0])
  })
  it('composites transparency on white and rejects inconsistent pixel data', () => {
    expect([...encodeBmp(1, 1, new Uint8ClampedArray([0, 0, 0, 0])).slice(54, 57)]).toEqual([255, 255, 255])
    expect(() => encodeBmp(2, 2, new Uint8ClampedArray(4))).toThrow('位图尺寸无效')
  })
})
