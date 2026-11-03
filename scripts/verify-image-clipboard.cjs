'use strict'
// A real Windows clipboard regression using generated pixels only.
const path = require('node:path')
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')
const project = path.resolve(__dirname, '..')

if (!process.versions.electron) {
  const { spawn } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename], { cwd: project, env, windowsHide: true, stdio: 'inherit' })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} else {
  const { app, clipboard, ClipboardItem, nativeImage } = require('electron')
  const { createImageClipboard, JPEG_RAW, JPEG_JFIF, decodeJpegDataUrl } = require('../electron/image-clipboard.cjs')
  app.setPath('userData', path.join(project, 'artifacts', 'image-clipboard-profile'))
  app.whenReady().then(async () => {
    const width = 224, height = 160
    const pixels = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      pixels[index] = (x * 19 + y * 7) % 256
      pixels[index + 1] = (x * 3 + y * 11) % 256
      pixels[index + 2] = x > 30 && x < 190 && y > 60 && y < 100 ? 240 : (x + y) % 256
      pixels[index + 3] = 255
    }
    const original = nativeImage.createFromBitmap(pixels, { width, height })
    const png = original.toPNG(), jpeg60 = original.toJPEG(60), jpeg100 = original.toJPEG(100)
    const service = createImageClipboard({ clipboard, ClipboardItem, nativeImage })
    const pngResult = await service.copy(`data:image/png;base64,${png.toString('base64')}`)
    const [pngItem] = await clipboard.read()
    const copiedPng = Buffer.from(await (await pngItem.getType('image/png')).arrayBuffer())
    assert.equal(pngResult.format, 'png')
    assert(nativeImage.createFromBuffer(copiedPng).toBitmap().equals(pixels), 'PNG clipboard must retain exact edited pixels')

    const jpegUrl = `data:image/jpeg;base64,${jpeg60.toString('base64')}`
    assert.deepEqual(decodeJpegDataUrl(jpegUrl).size, { width, height })
    const jpegResult = await service.copy(jpegUrl, 'deskflow')
    assert.equal(jpegResult.quality, 60)
    assert(jpeg60.length < jpeg100.length)
    const [item] = await clipboard.read()
    for (const type of [JPEG_RAW, JPEG_JFIF]) {
      assert(item.types.includes(type))
      const bytes = Buffer.from(await (await item.getType(type)).arrayBuffer())
      assert(bytes.equals(jpeg60), `Raw JPEG format must retain the original quality-60 bytes: ${type}`)
      assert.equal(bytes.readUInt16BE(0), 0xffd8)
      assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9)
    }
    const compatiblePng = Buffer.from(await (await item.getType('image/png')).arrayBuffer())
    const compatibility = nativeImage.createFromBuffer(compatiblePng)
    assert.deepEqual(compatibility.getSize(), { width, height })
    assert(compatibility.toBitmap().equals(nativeImage.createFromBuffer(jpeg60).toBitmap()), 'Native bitmap must come from the compressed JPEG, not original PNG')
    assert(!compatibility.toBitmap().equals(pixels), 'JPEG compression must be real, not just a MIME rename')

    await clipboard.writeText('clipboard-validation-sentinel')
    await assert.rejects(service.copy(jpegUrl, 'unknown'), /复制模式/)
    await assert.rejects(service.copy(`data:image/png;base64,${png.toString('base64')}`, 'deskflow'), /JPEG/)
    await assert.rejects(service.copy('data:image/jpeg;base64,/9j/2Q==', 'deskflow'), /JPEG/)
    assert.equal(await clipboard.readText(), 'clipboard-validation-sentinel', 'Invalid images must not replace clipboard')
    await service.copy(`data:image/png;base64,${png.toString('base64')}`)
    assert.equal(await clipboard.has(JPEG_RAW), false, 'Normal PNG copy must remove the preceding JPEG representation')
    const report = { pngPixelsExact: true, jpegRawBytesExact: true, jpegQuality: 60, jpegBytes: jpeg60.length, fullQualityJpegBytes: jpeg100.length,
      dimensions: { width, height }, nativePixelsEqualDecodedJpeg: true, compressionIsLossy: true, invalidInputPreservesClipboard: true,
      pngCopyClearsPreviousJpeg: true, clipboardFormatsForDeskflow: item.types, deskflowWireSizeNotAsserted: true }
    await fs.mkdir(path.join(project, 'artifacts'), { recursive: true })
    await fs.writeFile(path.join(project, 'artifacts', 'image-clipboard-regression.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
    app.quit()
  }).catch(error => { console.error(error); app.exit(1) })
}
