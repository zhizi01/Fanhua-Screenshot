'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_BYTES = 96 * 1024 * 1024
const MAX_PIXELS = 100000000
const EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'bmp'])
const OPEN_EXTENSIONS = Object.freeze([...EXTENSIONS, 'pdf'])
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function validDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 32768 || height > 32768 || width * height > MAX_PIXELS) throw new Error('图片尺寸超出支持范围，最多支持一亿像素')
  return { width, height }
}

function validateImagePath(file, allowPdf = false) {
  if (typeof file !== 'string' || !file || file.length > 32760 || file.includes('\0') || !path.isAbsolute(file)) throw new Error('请提供图片文件的完整绝对路径')
  // A drive-relative root such as "\\photo.png" still depends on the caller's
  // current drive. Explorer supplies a fully qualified drive or UNC path.
  if (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|\\\\[^\\/?]+\\[^\\/]+\\)/i.test(file)) throw new Error('请提供图片文件的完整绝对路径')
  if (!(allowPdf ? OPEN_EXTENSIONS : EXTENSIONS).includes(path.extname(file).slice(1).toLowerCase())) throw new Error(allowPdf ? '仅支持 PNG、JPEG、WebP、未压缩 BMP 和 PDF 文档' : '仅支持 PNG、JPEG、WebP 和未压缩 BMP 图片')
  return path.normalize(file)
}

function parseEditImageArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('图片编辑启动参数无效')
  const flags = argv.reduce((found, argument, index) => argument === '--edit-image' ? [...found, index] : found, [])
  if (!flags.length) return null
  if (flags.length !== 1) throw new Error('一次只能通过右键打开一个图片或 PDF 文件')
  return validateImagePath(argv[flags[0] + 1], true)
}

async function readBoundedFile(file, label = '图片') {
  let handle
  try {
    handle = await fs.open(file, 'r')
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`所选路径不是${label}文件`)
    if (stat.size > MAX_BYTES) throw new Error(`${label}文件过大，请选择不超过 96 MB 的文件`)
    const chunks = []; let bytes = 0
    for await (const chunk of handle.createReadStream({ start: 0, end: MAX_BYTES, autoClose: false })) {
      bytes += chunk.length
      if (bytes > MAX_BYTES) throw new Error(`${label}文件过大，请选择不超过 96 MB 的文件`)
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, bytes)
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label}文件不存在或已被移动`)
    if (error.code === 'EACCES' || error.code === 'EPERM') throw new Error(`无法读取${label}，请检查文件访问权限`)
    throw error
  } finally { await handle?.close().catch(() => {}) }
}

function jpegSize(bytes) {
  for (let offset = 2; offset + 3 < bytes.length;) {
    if (bytes[offset++] !== 0xff) break
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) break
      return validDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))
    }
    offset += length
  }
  throw new Error('JPEG 图片头或尺寸无效')
}

function decodeBmp(bytes, nativeImage) {
  if (bytes.length < 54 || bytes.toString('ascii', 0, 2) !== 'BM') throw new Error('BMP 图片数据不完整')
  const declaredSize = bytes.readUInt32LE(2)
  const pixelOffset = bytes.readUInt32LE(10)
  const headerSize = bytes.readUInt32LE(14)
  if (headerSize < 40 || headerSize > bytes.length - 14 || pixelOffset < 14 + headerSize
    || (declaredSize && declaredSize > bytes.length)) throw new Error('BMP 图片头或像素偏移无效')
  const width = bytes.readInt32LE(18), signedHeight = bytes.readInt32LE(22), height = Math.abs(signedHeight)
  validDimensions(width, height)
  const planes = bytes.readUInt16LE(26), depth = bytes.readUInt16LE(28), compression = bytes.readUInt32LE(30)
  if (planes !== 1 || ![24, 32].includes(depth) || compression !== 0) throw new Error('仅支持 24／32 位未压缩 BMP，请先转换为 PNG')
  const channels = depth / 8, stride = Math.ceil(width * channels / 4) * 4
  const pixelEnd = pixelOffset + stride * height
  if (pixelEnd > bytes.length || (declaredSize && declaredSize < pixelEnd)) throw new Error('BMP 像素数据不完整')
  const bitmap = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = pixelOffset + (signedHeight < 0 ? y : height - y - 1) * stride
    for (let x = 0; x < width; x++) {
      const source = row + x * channels, target = (y * width + x) * 4
      bitmap[target] = bytes[source]; bitmap[target + 1] = bytes[source + 1]; bitmap[target + 2] = bytes[source + 2]
      // BI_RGB's fourth byte is unused, not an alpha channel. A zero padding
      // byte must not turn a common 32-bit BMP into an invisible image.
      bitmap[target + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 })
}

async function decodeImageBytes(bytes, nativeImage) {
  let image
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    validDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
    image = nativeImage.createFromBuffer(bytes)
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    jpegSize(bytes)
    image = nativeImage.createFromBuffer(bytes)
  } else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    // Lazy-load only for a WebP file, never during tray startup.
    const sharp = require('sharp')
    const decoder = sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false, failOn: 'error' })
    let metadata
    try { metadata = await decoder.metadata() }
    catch { throw new Error('WebP 图片头无效或文件已损坏') }
    validDimensions(metadata.width, metadata.height)
    if ((metadata.pages || 1) > 1) throw new Error('暂不支持动画 WebP，请先转换为静态 PNG')
    let png
    try { png = await decoder.png().toBuffer() }
    catch { throw new Error('WebP 图片解码失败，请检查文件是否损坏') }
    image = nativeImage.createFromBuffer(png)
  } else if (bytes.length >= 2 && bytes.toString('ascii', 0, 2) === 'BM') {
    image = decodeBmp(bytes, nativeImage)
  } else throw new Error('无法识别图片内容，请选择 PNG、JPEG、静态 WebP 或未压缩 BMP')
  if (!image || image.isEmpty()) throw new Error('图片解码失败，请检查文件是否损坏')
  const size = image.getSize(); validDimensions(size.width, size.height)
  return image
}

async function readImageFile(file, nativeImage) {
  const normalized = validateImagePath(file)
  return decodeImageBytes(await readBoundedFile(normalized), nativeImage)
}

async function readPreviewFile(file, nativeImage) {
  const normalized = validateImagePath(file, true)
  if (path.extname(normalized).toLowerCase() !== '.pdf') return { image: await readImageFile(normalized, nativeImage) }
  const bytes = await readBoundedFile(normalized, 'PDF')
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r\n|\r|\n)/.test(bytes.subarray(0, 16).toString('latin1'))) throw new Error('文件内容不是有效的 PDF，请检查文件格式')
  return { pdf: { name: path.basename(normalized), bytes: new Uint8Array(bytes) } }
}

module.exports = { EXTENSIONS, OPEN_EXTENSIONS, MAX_BYTES, parseEditImageArgs, validateImagePath, readImageFile, readPreviewFile, decodeImageBytes, decodeBmp }
