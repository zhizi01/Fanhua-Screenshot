'use strict'

/** Convert a renderer selection in local DIP units to actual capture pixels. */
function selectionToPixels(rect, logicalSize, pixelSize) {
  if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) {
    throw new Error('截图区域无效')
  }
  if (rect.width < 1 || rect.height < 1 || rect.width > 100000 || rect.height > 100000) {
    throw new Error('请选择至少 1 × 1 的截图区域')
  }
  const left = Math.max(0, Math.min(logicalSize.width, rect.x))
  const top = Math.max(0, Math.min(logicalSize.height, rect.y))
  const right = Math.max(left, Math.min(logicalSize.width, rect.x + rect.width))
  const bottom = Math.max(top, Math.min(logicalSize.height, rect.y + rect.height))
  const x = Math.floor(left * pixelSize.width / logicalSize.width)
  const y = Math.floor(top * pixelSize.height / logicalSize.height)
  const width = Math.min(pixelSize.width, Math.ceil(right * pixelSize.width / logicalSize.width)) - x
  const height = Math.min(pixelSize.height, Math.ceil(bottom * pixelSize.height / logicalSize.height)) - y
  if (width < 1 || height < 1) throw new Error('截图区域超出了屏幕边界')
  return { x, y, width, height }
}

function intersectRect(rect, bounds) {
  const x = Math.max(rect.x, bounds.x)
  const y = Math.max(rect.y, bounds.y)
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width)
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

function decodePngDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 128 * 1024 * 1024 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(dataUrl)) {
    throw new Error('图片格式无效，请使用 PNG 图片')
  }
  const buffer = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG 图片数据无效')
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width < 1 || height < 1 || width > 32768 || height > 32768 || width * height > 100000000) {
    throw new Error('图片尺寸过大，最多支持一亿像素')
  }
  return buffer
}

module.exports = { selectionToPixels, intersectRect, decodePngDataUrl }
