'use strict'
// Pure Node verification: generated local fixtures and simulated native save
// dialogs only. No GUI, registry, clipboard, external documents or installer.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const zlib = require('node:zlib')
const { createPdfService, MAX_TOTAL_BYTES } = require('../electron/pdf.cjs')
const { readPreviewFile, readImageFile, parseEditImageArgs, MAX_BYTES } = require('../electron/image-open.cjs')
const directory = path.resolve(__dirname, '..', 'artifacts', 'pdf-service')
const app = { getPath: () => directory }
let owner = 0
function windowStub() {
  const win = { destroyed: false, isDestroyed: () => win.destroyed }
  win.webContents = { id: ++owner, isDestroyed: () => win.destroyed }
  return win
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function dialogFor(filePath) { return { showSaveDialog: async () => ({ canceled: false, filePath }) } }
const serviceFor = (file, extra = {}) => createPdfService({ app, dialog: dialogFor(path.join(directory, file)), ...extra })
const asPage = (bytes, widthPoints = 300, heightPoints = 200) => ({ dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, widthPoints, heightPoints })
async function noTemps() { assert.deepEqual((await fs.readdir(directory)).filter(file => file.endsWith('.pdf.tmp')), [], 'No partial PDF should remain after failure or cancellation') }

async function run() {
  await fs.mkdir(directory, { recursive: true })
  assert(!Object.keys(require.cache).some(file => /[\\/]pdf-lib[\\/]/.test(file)), 'Tray startup and PDF input must not eagerly load pdf-lib')
  const canceled = createPdfService({ app, dialog: { showSaveDialog: async () => ({ canceled: true }) } })
  assert.deepEqual(await canceled.begin(windowStub(), { pageCount: 1 }), { canceled: true })
  assert(!Object.keys(require.cache).some(file => /[\\/]pdf-lib[\\/]/.test(file)), 'Canceling the save chooser must not load pdf-lib')
  await canceled.dispose()
  const sharp = require('sharp')
  const red = await sharp({ create: { width: 24, height: 16, channels: 4, background: { r: 200, g: 40, b: 30, alpha: 1 } } }).png().toBuffer()
  const blue = await sharp({ create: { width: 24, height: 16, channels: 4, background: { r: 20, g: 50, b: 190, alpha: .5 } } }).png().toBuffer()
  const win = windowStub(), foreign = windowStub()
  const output = path.join(directory, '合成 图片 & PDF.pdf')
  let chosenOptions
  const service = serviceFor('unused.pdf', { dialog: { showSaveDialog: async (_win, options) => { chosenOptions = options; return { canceled: false, filePath: output } } } })
  for (const pageCount of [0, -1, 201, 1.5, NaN, '2']) await assert.rejects(service.begin(win, { pageCount }), /1 至 200/)
  await assert.rejects(service.begin(win, { pageCount: 1, name: {} }), /文件名/)
  const start = await service.begin(win, { pageCount: 2, name: '../外部路径\\CON.pdf' })
  assert.equal(start.canceled, false)
  assert.equal(path.dirname(chosenOptions.defaultPath), directory, 'Renderer names must never choose a directory')
  await assert.rejects(service.begin(win, { pageCount: 1 }), /当前 PDF/)
  await assert.rejects(service.append(foreign, start.jobId, asPage(red)), /其他窗口/)
  await assert.rejects(service.finish(foreign, start.jobId), /其他窗口/)
  await assert.rejects(service.cancel(foreign, start.jobId), /其他窗口/)
  await fs.writeFile(output, 'previous-file-sentinel')
  const a = service.append(win, start.jobId, asPage(red, 300, 200))
  const b = service.append(win, start.jobId, asPage(blue, 200, 400))
  const finish = service.finish(win, start.jobId)
  await Promise.all([a, b])
  assert.deepEqual(await finish, { canceled: false, filePath: output })
  await service.cancel(win, start.jobId) // Safe renderer finally block after success.
  const { PDFDocument, PDFName, PDFDict } = require('pdf-lib')
  const binary = await fs.readFile(output), document = await PDFDocument.load(binary)
  assert.equal(document.getPageCount(), 2)
  assert.deepEqual(document.getPages().map(page => page.getSize()), [{ width: 300, height: 200 }, { width: 200, height: 400 }])
  assert.equal(document.catalog.has(PDFName.of('Names')), false, 'Static export must not add JavaScript or attachments')
  const images = document.getPages().map(page => {
    assert.equal(page.node.Annots()?.size() || 0, 0)
    const objects = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict)
    return document.context.lookup(objects.values()[0])
  })
  assert.deepEqual([...zlib.inflateSync(images[0].getContents()).subarray(0, 3)], [200, 40, 30], 'Composited page pixels must survive embedding')
  assert.equal(images[1].dict.has(PDFName.of('SMask')), true, 'PNG transparency must survive embedding')
  const input = await readPreviewFile(output)
  assert.equal(input.pdf.name, path.basename(output))
  assert(input.pdf.bytes instanceof Uint8Array)
  assert(Buffer.from(input.pdf.bytes).equals(binary))
  assert.equal(parseEditImageArgs(['--edit-image', output]), output)
  await assert.rejects(readImageFile(output), /仅支持/)
  await assert.rejects(readPreviewFile('https://example.test/test.pdf'), /绝对路径/)
  await assert.rejects(readPreviewFile(path.join(directory, 'missing.pdf')), /不存在/)
  const directoryPdf = path.join(directory, 'directory.pdf')
  await fs.mkdir(directoryPdf, { recursive: true })
  await assert.rejects(readPreviewFile(directoryPdf), /不是PDF文件|访问权限/)
  const badPdf = path.join(directory, 'invalid.pdf')
  for (const data of [red, Buffer.from('%PDF-9.9\n%%EOF'), Buffer.from([0xa5, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a])]) {
    await fs.writeFile(badPdf, data)
    await assert.rejects(readPreviewFile(badPdf), /不是有效的 PDF/)
  }
  const largeFile = path.join(directory, 'oversize.pdf'), handle = await fs.open(largeFile, 'w')
  try { await handle.truncate(MAX_BYTES + 1) } finally { await handle.close() }
  try { await assert.rejects(readPreviewFile(largeFile), /96 MB/) } finally { await fs.unlink(largeFile) }
  await service.dispose()

  const badDestination = serviceFor('wrong.png')
  await assert.rejects(badDestination.begin(win, { pageCount: 1 }), /\.pdf/)
  await badDestination.dispose()
  const validation = serviceFor('validation.pdf')
  for (const page of [asPage(red, 0, 10), asPage(red, NaN, 10), asPage(red, 14401, 10), { ...asPage(red), dataUrl: 'data:image/jpeg;base64,AA==' }, asPage(Buffer.from('not a PNG'))]) {
    const job = await validation.begin(win, { pageCount: 1 })
    await assert.rejects(validation.append(win, job.jobId, page))
    await assert.rejects(validation.finish(win, job.jobId), /已结束/)
  }
  const huge = Buffer.from(red); huge.writeUInt32BE(4001, 16); huge.writeUInt32BE(4000, 20)
  const hugeJob = await validation.begin(win, { pageCount: 1 })
  await assert.rejects(validation.append(win, hugeJob.jobId, asPage(huge)), /1600 万/)
  const corrupt = red.subarray(0, 33)
  const badJob = await validation.begin(win, { pageCount: 1 })
  await assert.rejects(validation.append(win, badJob.jobId, asPage(corrupt)), /PNG/)
  const duplicateHeader = Buffer.concat([red.subarray(0, 33), red.subarray(8, 33), red.subarray(33)])
  const duplicateJob = await validation.begin(win, { pageCount: 1 })
  await assert.rejects(validation.append(win, duplicateJob.jobId, asPage(duplicateHeader)), /PNG 图片头/)
  const animationChunk = Buffer.alloc(20); animationChunk.writeUInt32BE(8); animationChunk.write('acTL', 4)
  const animated = Buffer.concat([red.subarray(0, 33), animationChunk, red.subarray(33)])
  const animationJob = await validation.begin(win, { pageCount: 1 })
  await assert.rejects(validation.append(win, animationJob.jobId, asPage(animated)), /静态 PNG/)
  const badIdat = Buffer.from(red)
  for (let offset = 8; offset + 12 <= badIdat.length;) {
    const length = badIdat.readUInt32BE(offset)
    if (badIdat.toString('ascii', offset + 4, offset + 8) === 'IDAT') { badIdat.fill(0, offset + 8, offset + 8 + length); break }
    offset += length + 12
  }
  const badDataJob = await validation.begin(win, { pageCount: 1 })
  await assert.rejects(validation.append(win, badDataJob.jobId, asPage(badIdat)), /PNG 解码/)
  const incomplete = await validation.begin(win, { pageCount: 2 })
  await validation.append(win, incomplete.jobId, asPage(red))
  await assert.rejects(validation.finish(win, incomplete.jobId), /尚未全部添加/)
  const tooMany = await validation.begin(win, { pageCount: 1 })
  await validation.append(win, tooMany.jobId, asPage(red))
  await assert.rejects(validation.append(win, tooMany.jobId, asPage(red)), /页面数量/)
  const maximum = await validation.begin(win, { pageCount: 200 })
  await validation.cancel(win, maximum.jobId)
  await validation.dispose()

  // Exercise byte accounting with a codec stub so a 128 MB validation test
  // doesn't retain hundreds of megabytes of real PDF compressed image streams.
  const padded = Buffer.alloc(20 * 1024 * 1024); red.copy(padded)
  const paddedPage = asPage(padded)
  const budget = serviceFor('budget.pdf', { loadPdfLib: () => ({ PDFDocument: { create: async () => ({ setCreator() {}, embedPng: async () => ({ width: 24, height: 16, embed: async () => {} }), addPage: () => ({ drawImage() {} }) }) } }) })
  const budgetJob = await budget.begin(win, { pageCount: 7 })
  for (let index = 0; index < Math.floor(MAX_TOTAL_BYTES / padded.length); index++) await budget.append(win, budgetJob.jobId, paddedPage)
  await assert.rejects(budget.append(win, budgetJob.jobId, paddedPage), /128 MB/)
  await budget.dispose()

  const chooser = deferred()
  const choosingWindow = windowStub()
  const choosing = serviceFor('choose.pdf', { dialog: { showSaveDialog: () => chooser.promise } })
  const choosingResult = choosing.begin(choosingWindow, { pageCount: 1 })
  choosingWindow.destroyed = true
  await choosing.cancelOwner(choosingWindow.webContents.id)
  chooser.resolve({ canceled: false, filePath: path.join(directory, 'choose.pdf') })
  assert.deepEqual(await choosingResult, { canceled: true })
  await choosing.dispose()

  for (const failure of ['write', 'rename', 'cancel', 'close', 'quit']) {
    const filename = path.join(directory, `${failure}.pdf`)
    await fs.writeFile(filename, 'old PDF must survive')
    const entered = deferred(), continueWrite = deferred()
    const fileSystem = {
      ...fs,
      open: async (...args) => {
        const real = await fs.open(...args)
        return {
          close: () => real.close(), sync: () => real.sync(),
          writeFile: async bytes => {
            if (failure === 'write') throw Object.assign(new Error('No space'), { code: 'ENOSPC' })
            if (['cancel', 'close', 'quit'].includes(failure)) { entered.resolve(); await continueWrite.promise }
            await real.writeFile(bytes)
          },
        }
      },
      rename: failure === 'rename' ? async () => { throw Object.assign(new Error('File locked'), { code: 'EPERM' }) } : fs.rename,
    }
    const transaction = serviceFor(`${failure}.pdf`, { fileSystem })
    const targetWindow = windowStub(), job = await transaction.begin(targetWindow, { pageCount: 1 })
    await transaction.append(targetWindow, job.jobId, asPage(red))
    const completion = transaction.finish(targetWindow, job.jobId)
    if (['cancel', 'close', 'quit'].includes(failure)) {
      await entered.promise
      let cancel
      if (failure === 'close') { targetWindow.destroyed = true; cancel = transaction.cancelOwner(targetWindow.webContents.id) }
      else cancel = failure === 'quit' ? transaction.dispose() : transaction.cancel(targetWindow, job.jobId)
      continueWrite.resolve()
      await cancel
      assert.deepEqual(await completion, { canceled: true })
    } else await assert.rejects(completion, /保存失败/)
    assert.equal(await fs.readFile(filename, 'utf8'), 'old PDF must survive')
    await transaction.dispose()
    await noTemps()
  }
  const parallel = serviceFor('parallel.pdf')
  const first = await parallel.begin(win, { pageCount: 1 })
  await assert.rejects(parallel.begin(foreign, { pageCount: 1 }), /另一窗口/)
  await parallel.cancel(win, first.jobId)
  const ownerAgain = await parallel.begin(foreign, { pageCount: 1 })
  await parallel.cancel(foreign, ownerAgain.jobId)
  await parallel.dispose()
  const collision = serviceFor('collision.pdf'), collisionJob = await collision.begin(win, { pageCount: 1 })
  await collision.append(win, collisionJob.jobId, asPage(red))
  const foreignTemp = path.join(directory, `.fanhua-${collisionJob.jobId}.pdf.tmp`)
  await fs.writeFile(foreignTemp, 'not created by this save job')
  await assert.rejects(collision.finish(win, collisionJob.jobId), /保存失败/)
  assert.equal(await fs.readFile(foreignTemp, 'utf8'), 'not created by this save job', 'An exclusive-create collision must never delete a preexisting file')
  await fs.unlink(foreignTemp)
  await collision.dispose()
  await noTemps()
  const installer = await fs.readFile(path.resolve(__dirname, '../build/installer.nsh'), 'utf8')
  assert(!installer.includes('WriteRegStr'), 'Installing PDF support must not opt into the Explorer menu')
  assert(installer.includes('!insertmacro FanhuaUnregisterImageVerb ${ROOT} "pdf"'))
  const report = { pureNode: true, guiOpened: false, staticPdfPages: 2, pageSizesAndPixelsPreserved: true, transparencyPreserved: true, pngBytesLimit: MAX_TOTAL_BYTES, staticPngAndChunkBoundariesValidated: true, corruptIdatRejectedBeforePdfLib: true, lazyLoadingAndChooserCancellation: true, pdfInputAndHeaderValidation: true, ownerIsolation: true, appendOrderAndCount: true, atomicReplace: true, writeFailurePreservesExisting: true, renameFailurePreservesExisting: true, preexistingTemporaryFilePreserved: true, cancelCloseAndQuitCleanTemporary: true, noPartialFiles: true, pdfExplorerVerb: true }
  await fs.writeFile(path.join(directory, 'service-regression.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}

run().catch(error => { console.error(error); process.exitCode = 1 })
