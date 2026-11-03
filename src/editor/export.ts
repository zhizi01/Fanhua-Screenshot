/** 24-bit uncompressed BMP, compositing transparent pixels onto white. */
export function encodeBmp(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 100000000 || rgba.length !== width * height * 4) throw new Error('位图尺寸无效')
  const stride = Math.ceil(width * 3 / 4) * 4
  const result = new Uint8Array(54 + stride * height)
  const view = new DataView(result.buffer)
  view.setUint16(0, 0x4d42, true)
  view.setUint32(2, result.length, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, stride * height, true)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4
    const to = 54 + (height - y - 1) * stride + x * 3
    const alpha = rgba[from + 3]! / 255
    result[to] = Math.round(rgba[from + 2]! * alpha + 255 * (1 - alpha))
    result[to + 1] = Math.round(rgba[from + 1]! * alpha + 255 * (1 - alpha))
    result[to + 2] = Math.round(rgba[from]! * alpha + 255 * (1 - alpha))
  }
  return result
}
