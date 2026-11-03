'use strict'
const { Blob } = require('node:buffer')
const { decodePngDataUrl } = require('./geometry.cjs')

const JPEG_RAW = 'electron application/osclipboard;format="image/jpeg"'
const JPEG_JFIF = 'electron application/osclipboard;format="JFIF"'
const MAX_PIXELS = 100000000

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new Error('JPEG 图片数据无效')
  for (let offset = 2; offset < bytes.length - 1;) {
    if (bytes[offset++] !== 0xff) throw new Error('JPEG 图片段无效')
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) throw new Error('JPEG 图片数据不完整')
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) throw new Error('JPEG 图片尺寸无效')
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5)
      if (width < 1 || height < 1 || width > 32768 || height > 32768 || width * height > MAX_PIXELS) throw new Error('图片尺寸过大，最多支持一亿像素')
      return { width, height }
    }
    offset += length
  }
  throw new Error('JPEG 图片缺少尺寸信息')
}

function decodeJpegDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 128 * 1024 * 1024) throw new Error('JPEG 图片数据无效或过大')
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) throw new Error('DeskFlow 复制需要 JPEG 图片')
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.toString('base64') !== match[1]) throw new Error('JPEG 图片编码无效')
  return { bytes, size: jpegDimensions(bytes) }
}

function createImageClipboard({ clipboard, ClipboardItem, nativeImage }) {
  return {
    async copy(dataUrl, mode = 'png') {
      if (mode !== 'png' && mode !== 'deskflow') throw new Error('图片复制模式无效')
      const jpeg = mode === 'deskflow'
      const input = jpeg ? decodeJpegDataUrl(dataUrl) : { bytes: decodePngDataUrl(dataUrl) }
      const decoded = nativeImage.createFromBuffer(input.bytes)
      if (decoded.isEmpty()) throw new Error('图片解码失败')
      const size = decoded.getSize()
      if (size.width < 1 || size.height < 1 || size.width > 32768 || size.height > 32768 || size.width * size.height > MAX_PIXELS) throw new Error('图片尺寸超出支持范围')
      if (input.size && (input.size.width !== size.width || input.size.height !== size.height)) throw new Error('JPEG 图片尺寸不一致')

      if (jpeg) {
        // The renderer encodes the composed image once at JPEG quality 60.
        // Electron's image/* path produces a native bitmap, not raw JPEG data.
        // Publish the exact JPEG separately, atomically with its bitmap fallback.
        // Deskflow currently uses CF_DIB; JPEG size is not its wire payload size.
        const blob = new Blob([input.bytes], { type: 'image/jpeg' })
        await clipboard.write([new ClipboardItem({ 'image/jpeg': blob, [JPEG_JFIF]: blob, [JPEG_RAW]: blob })])
        return { format: 'jpeg', quality: 60, bytes: input.bytes.length }
      }
      const png = decoded.toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
      return { format: 'png', bytes: png.length }
    },
  }
}

module.exports = { createImageClipboard, decodeJpegDataUrl, jpegDimensions, JPEG_RAW, JPEG_JFIF }
