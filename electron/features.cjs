'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { decodePngDataUrl } = require('./geometry.cjs')
const { createOcrService } = require('./ocr.cjs')

const MAX_PIXELS = 100000000
const MAX_ASSET_BYTES = 8 * 1024 * 1024
const MAX_STORE_BYTES = 64 * 1024 * 1024
const FORMATS = {
  png: { mime: 'image/png', extension: 'png', name: 'PNG 图片' },
  jpeg: { mime: 'image/jpeg', extension: 'jpg', name: 'JPEG 图片' },
  webp: { mime: 'image/webp', extension: 'webp', name: 'WebP 图片' },
  bmp: { mime: 'image/png', extension: 'bmp', name: 'BMP 位图' },
}
const PLACEMENTS = new Set(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right', 'tile'])

function parseImageDataUrl(dataUrl, expectedMime = 'image/png') {
  if (typeof dataUrl !== 'string' || dataUrl.length > 128 * 1024 * 1024) throw new Error('图片数据无效或过大')
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match || match[1] !== expectedMime) throw new Error('图片编码与所选保存格式不一致')
  if (expectedMime === 'image/png') return decodePngDataUrl(dataUrl)
  const buffer = Buffer.from(match[2], 'base64')
  if (expectedMime === 'image/jpeg' && (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff)) throw new Error('JPEG 图片数据无效')
  if (expectedMime === 'image/webp' && (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length)) throw new Error('WebP 图片数据无效')
  return buffer
}

function checkedImage(nativeImage, buffer, limit = MAX_PIXELS) {
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) throw new Error('图片解码失败')
  const size = image.getSize()
  if (size.width < 1 || size.height < 1 || size.width > 32768 || size.height > 32768 || size.width * size.height > limit) throw new Error('图片尺寸超出支持范围')
  return image
}

// Electron NativeImage only decodes PNG/JPEG. Chromium supplies the already
// encoded WebP; validate its RIFF chunks and frame dimensions before writing.
function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('WebP 图片数据无效')
  let canvas, frame
  for (let offset = 12; offset < buffer.length;) {
    if (offset + 8 > buffer.length) throw new Error('WebP 数据不完整')
    const name = buffer.toString('ascii', offset, offset + 4), length = buffer.readUInt32LE(offset + 4)
    const start = offset + 8, end = start + length
    if (end + (length % 2) > buffer.length) throw new Error('WebP 数据不完整')
    if (name === 'VP8X') {
      if (length !== 10 || (buffer[start] & 2)) throw new Error('不支持此 WebP 图片')
      canvas = { width: buffer.readUIntLE(start + 4, 3) + 1, height: buffer.readUIntLE(start + 7, 3) + 1 }
    } else if (name === 'VP8 ') {
      if (length < 10 || buffer[start] & 1 || !buffer.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 1, 0x2a]))) throw new Error('WebP 图像帧无效')
      frame = { width: buffer.readUInt16LE(start + 6) & 0x3fff, height: buffer.readUInt16LE(start + 8) & 0x3fff }
    } else if (name === 'VP8L') {
      if (length < 5 || buffer[start] !== 0x2f) throw new Error('WebP 图像帧无效')
      const bits = buffer.readUInt32LE(start + 1)
      frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    offset = end + (length % 2)
  }
  if (!frame || (canvas && (canvas.width !== frame.width || canvas.height !== frame.height))) throw new Error('WebP 图片尺寸无效')
  const size = canvas || frame
  if (size.width < 1 || size.height < 1 || size.width > 32768 || size.height > 32768 || size.width * size.height > MAX_PIXELS) throw new Error('图片尺寸超出支持范围')
  return size
}

/** NativeImage exposes premultiplied BGRA. Composite onto white, bottom-up BMP. */
function encodeBmp(image) {
  const { width, height } = image.getSize()
  const stride = Math.ceil(width * 3 / 4) * 4
  const pixels = image.toBitmap()
  if (pixels.length !== width * height * 4) throw new Error('无法读取位图像素')
  const buffer = Buffer.alloc(54 + stride * height)
  buffer.write('BM', 0, 2, 'ascii')
  buffer.writeUInt32LE(buffer.length, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(width, 18); buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26); buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(stride * height, 34)
  buffer.writeInt32LE(3780, 38); buffer.writeInt32LE(3780, 42)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4
    const to = 54 + (height - 1 - y) * stride + x * 3
    const white = 255 - pixels[from + 3]
    buffer[to] = Math.min(255, pixels[from] + white)
    buffer[to + 1] = Math.min(255, pixels[from + 1] + white)
    buffer[to + 2] = Math.min(255, pixels[from + 2] + white)
  }
  return buffer
}

function requiredNumber(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name}超出范围`)
  return value
}
function requiredString(value, max, name) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${name}无效`)
  return value
}
function validateWatermarkConfig(config, nativeImage) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('水印设置无效')
  if (typeof config.enabled !== 'boolean' || !['text', 'image'].includes(config.kind) || !PLACEMENTS.has(config.placement)) throw new Error('水印类型或铺设方式无效')
  const text = requiredString(config.text, 2000, '水印文字')
  const font = requiredString(config.font, 200, '水印字体').trim()
  if (!font || typeof config.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(config.color)) throw new Error('水印字体或颜色无效')
  let imageDataUrl = requiredString(config.imageDataUrl, Math.ceil(MAX_ASSET_BYTES * 4 / 3) + 100, '水印图片')
  let imageWidth = requiredNumber(config.imageWidth, 0, 8192, '水印图片宽度')
  let imageHeight = requiredNumber(config.imageHeight, 0, 8192, '水印图片高度')
  if (config.kind === 'image' && !imageDataUrl) throw new Error('请先选择图片水印')
  if (imageDataUrl) {
    const buffer = parseImageDataUrl(imageDataUrl)
    if (buffer.length > MAX_ASSET_BYTES) throw new Error('水印图片过大，请使用小于 8 MB 的 PNG')
    const image = checkedImage(nativeImage, buffer, 16000000)
    const size = image.getSize()
    if (size.width > 8192 || size.height > 8192) throw new Error('水印图片尺寸超出支持范围')
    imageWidth = size.width; imageHeight = size.height
    const png = image.toPNG()
    if (png.length > MAX_ASSET_BYTES) throw new Error('水印图片转为 PNG 后超过 8 MB')
    imageDataUrl = `data:image/png;base64,${png.toString('base64')}`
  }
  return {
    enabled: config.enabled, kind: config.kind, text, font,
    fontSize: requiredNumber(config.fontSize, 8, 240, '水印字号'), color: config.color.toLowerCase(),
    imageDataUrl, imageWidth, imageHeight,
    scale: requiredNumber(config.scale, .05, 4, '水印缩放'), placement: config.placement,
    opacity: requiredNumber(config.opacity, 0, 1, '水印透明度'), rotation: requiredNumber(config.rotation, -180, 180, '水印角度'),
    margin: requiredNumber(config.margin, 0, 1000, '水印边距'), spacing: requiredNumber(config.spacing, 0, 1000, '水印间隔'),
  }
}

function createPresetStore(file, nativeImage) {
  let queue = Promise.resolve()
  const read = async () => {
    try {
      const stat = await fs.stat(file)
      if (stat.size > MAX_STORE_BYTES) throw new Error('水印存档库过大')
      const json = JSON.parse(await fs.readFile(file, 'utf8'))
      if (!json || json.version !== 1 || !Array.isArray(json.presets) || json.presets.length > 30) throw new Error('水印存档格式无效')
      const ids = new Set()
      return json.presets.map(preset => {
        if (!preset || typeof preset.updatedAt !== 'string' || Number.isNaN(Date.parse(preset.updatedAt))) throw new Error('水印存档格式无效')
        const id = validateId(preset.id)
        if (ids.has(id)) throw new Error('水印存档编号重复')
        ids.add(id)
        return { id, name: validateName(preset.name), config: validateWatermarkConfig(preset.config, nativeImage), updatedAt: preset.updatedAt }
      })
    } catch (error) {
      if (error.code === 'ENOENT') return []
      if (error instanceof SyntaxError) throw new Error('水印存档损坏，请备份后移除 watermarks.json 再重试')
      if (error.code) throw new Error('无法读取水印存档，请检查用户数据目录权限')
      throw error
    }
  }
  const mutate = work => {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
  }
  const write = async presets => {
    const text = JSON.stringify({ version: 1, presets }, null, 2)
    if (Buffer.byteLength(text, 'utf8') > MAX_STORE_BYTES) throw new Error('水印存档总容量超过 64 MB，请删除不需要的存档')
    const temp = `${file}.${randomUUID()}.tmp`
    try { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' }); await fs.rename(temp, file) }
    catch { throw new Error('无法保存水印存档，请检查用户数据目录权限和磁盘空间') }
    finally { await fs.unlink(temp).catch(() => {}) }
  }
  return {
    list: () => queue.then(read),
    save: input => mutate(async () => {
      if (!input || typeof input !== 'object') throw new Error('水印存档无效')
      const existing = await read()
      const id = input.id === undefined ? randomUUID() : validateId(input.id)
      const index = existing.findIndex(item => item.id === id)
      if (input.id && index === -1) throw new Error('水印存档不存在，请另存为新存档')
      if (index === -1 && existing.length >= 30) throw new Error('最多保存 30 个水印存档')
      const preset = { id, name: validateName(input.name), config: validateWatermarkConfig(input.config, nativeImage), updatedAt: new Date().toISOString() }
      if (index === -1) existing.push(preset)
      else existing[index] = preset
      await write(existing)
      return preset
    }),
    delete: id => mutate(async () => {
      validateId(id)
      const existing = await read()
      await write(existing.filter(item => item.id !== id))
    }),
  }
}
function validateId(id) { if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('水印存档编号无效'); return id }
function validateName(name) { const value = requiredString(name, 80, '存档名称').trim(); if (!value) throw new Error('请输入存档名称'); return value }
function localTimestamp() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function createFeatureHandlers({ app, dialog, nativeImage, clipboard, helper }) {
  const ocr = createOcrService({ app })
  const store = createPresetStore(path.join(app.getPath('userData'), 'watermarks.json'), nativeImage)
  let fontsPromise
  return {
    async getFonts(refresh = false) {
      if (typeof refresh !== 'boolean') throw new Error('字体刷新参数无效')
      if (refresh) fontsPromise = null
      if (!fontsPromise) fontsPromise = helper.request('fonts').then(fonts => [...new Set(fonts.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].sort((a, b) => a.localeCompare(b))).catch(error => { fontsPromise = null; throw new Error(`无法读取系统字体：${error.message}`) })
      return fontsPromise
    },
    getOcrCapabilities: () => ocr.capabilities(),
    recognizeText: (_win, dataUrl, language) => {
      const buffer = parseImageDataUrl(dataUrl)
      checkedImage(nativeImage, buffer)
      return ocr.recognize(buffer, language)
    },
    copyText(text) { requiredString(text, 2000000, '复制文字'); clipboard.writeText(text) },
    async chooseWatermarkImage(win) {
      const selected = await dialog.showOpenDialog(win, { title: '选择图片水印', properties: ['openFile'], filters: [{ name: 'PNG / JPEG 图片', extensions: ['png', 'jpg', 'jpeg'] }] })
      if (selected.canceled || !selected.filePaths[0]) return null
      let stat, source
      try { stat = await fs.stat(selected.filePaths[0]) }
      catch { throw new Error('无法读取所选水印图片，请重新选择') }
      if (stat.size > 16 * 1024 * 1024) throw new Error('请选择小于 16 MB 的水印图片')
      try { source = await fs.readFile(selected.filePaths[0]) }
      catch { throw new Error('无法读取所选水印图片，请重新选择') }
      let image = checkedImage(nativeImage, source, 16000000)
      const size = image.getSize()
      if (Math.max(size.width, size.height) > 2048) {
        const ratio = 2048 / Math.max(size.width, size.height)
        image = image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)), quality: 'best' })
      }
      const png = image.toPNG()
      if (png.length > MAX_ASSET_BYTES) throw new Error('水印图片转为 PNG 后超过 8 MB，请压缩图片后重试')
      return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, ...image.getSize() }
    },
    listWatermarkPresets: () => store.list(),
    saveWatermarkPreset: input => store.save(input),
    deleteWatermarkPreset: id => store.delete(id),
    async saveImage(win, dataUrl, options = { format: 'png' }) {
      if (!options || typeof options !== 'object' || !Object.hasOwn(FORMATS, options.format)) throw new Error('不支持此保存格式')
      const format = FORMATS[options.format]
      if (options.quality !== undefined) requiredNumber(options.quality, 1, 100, '图片质量')
      const buffer = parseImageDataUrl(dataUrl, format.mime)
      const image = options.format === 'webp' ? (webpDimensions(buffer), null) : checkedImage(nativeImage, buffer)
      const encoded = options.format === 'bmp' ? encodeBmp(image) : options.format === 'png' ? image.toPNG() : buffer
      const result = await dialog.showSaveDialog(win, {
        title: `保存 ${options.format.toUpperCase()} 图片`,
        defaultPath: path.join(app.getPath('pictures'), `繁花有图-${localTimestamp()}.${format.extension}`),
        filters: [{ name: format.name, extensions: options.format === 'jpeg' ? ['jpg', 'jpeg'] : [format.extension] }],
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      let filePath = result.filePath
      const extension = path.extname(filePath).slice(1).toLowerCase()
      const accepted = options.format === 'jpeg' ? ['jpg', 'jpeg'] : [format.extension]
      if (!accepted.includes(extension)) {
        // Changing an already-confirmed path could overwrite another file that
        // was never shown in the system dialog. Ask for the matching extension.
        throw new Error(`文件扩展名与保存格式不一致，请使用 .${format.extension} 后缀重新保存`)
      }
      try { await fs.writeFile(filePath, encoded) }
      catch { throw new Error('保存失败，请检查目录权限和磁盘空间') }
      return { canceled: false, filePath }
    },
    dispose: () => ocr.dispose?.(),
  }
}

module.exports = { createFeatureHandlers, createPresetStore, validateWatermarkConfig, parseImageDataUrl, encodeBmp, webpDimensions, FORMATS }
