'use strict'

// Real Electron + real PDF.js/pdf-lib. Only native file pickers and deliberate
// error/cancellation delays are replaced. No installer or external app is run.
const { _electron: electron, expect } = require('@playwright/test')
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const artifacts = path.join(root, 'artifacts')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
async function fixture() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const sizes = [[500, 300], [360, 480], [280, 420]]
  for (let index = 0; index < sizes.length; index++) {
    const page = doc.addPage(sizes[index])
    page.drawText(`PAGE ${index + 1} SOURCE`, { x: 35, y: sizes[index][1] - 55, size: 25, font, color: rgb(.1, .1, .2) })
    page.drawRectangle({ x: 35, y: 35, width: 75, height: 60, color: [rgb(.8, .1, .1), rgb(.1, .2, .8), rgb(.1, .65, .25)][index] })
    if (index === 2) page.setRotation(degrees(90))
  }
  const bytes = await doc.save()
  const file = path.join(artifacts, 'PDF 中文 & 分页测试.pdf')
  await fs.writeFile(file, bytes)
  return { file, bytes }
}

async function run() {
  await fs.mkdir(artifacts, { recursive: true })
  const source = await fixture()
  const packaged = process.argv[2] || process.env.FANHUA_PACKAGED_EXE
  const mode = packaged ? 'packaged' : 'source'
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const app = await electron.launch({ executablePath: packaged || require('electron'), args: [...(packaged ? [] : ['.']), `--user-data-dir=${path.join(artifacts, 'pdf-regression-profile')}`, '--show-window'], cwd: root, env, timeout: 30000 })
  const errors = [], remoteRequests = []
  app.on('window', page => {
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()) })
  })
  const report = { mode }
  let current
  try {
    await expect.poll(() => app.windows().some(page => page.url().includes('view=dashboard')), { timeout: 30000 }).toBe(true)
    const settings = app.windows().find(page => page.url().includes('view=dashboard'))
    async function open(file) {
      const previous = new Set(app.windows())
      await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, file)
      await settings.evaluate(() => window.fanhua.openImage())
      await expect.poll(() => app.windows().some(page => !previous.has(page) && page.url().includes('view=preview')), { timeout: 30000 }).toBe(true)
      const page = app.windows().find(page => !previous.has(page) && page.url().includes('view=preview'))
      page.setDefaultTimeout(20000); current = page
      return page
    }
    async function ready(page, width, height) {
      const canvas = page.getByTestId('editor-canvas')
      await expect(canvas).toBeVisible({ timeout: 30000 })
      await expect(canvas).toHaveAttribute('width', String(width))
      await expect(canvas).toHaveAttribute('height', String(height))
      await expect.poll(() => canvas.evaluate(element => element.getContext('2d').getImageData(2, 2, 1, 1).data[3])).toBe(255)
    }
    async function go(page, number, width, height) {
      const input = page.getByRole('spinbutton', { name: 'PDF 页码', exact: true })
      await input.fill(String(number)); await input.press('Enter')
      await expect(input).toHaveValue(String(number))
      await ready(page, width, height)
    }
    async function clickImage(page, x, y) {
      const canvas = page.getByTestId('editor-canvas'), bounds = await canvas.boundingBox()
      const size = await canvas.evaluate(element => ({ width: element.width, height: element.height }))
      await page.mouse.click(bounds.x + bounds.width * x / size.width, bounds.y + bounds.height * y / size.height)
    }
    async function select(page, label, option) {
      await page.getByLabel(label, { exact: true }).click()
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: option }).click()
    }
    async function saveDialog(file, canceled = false) {
      await app.evaluate(({ dialog }, data) => { dialog.showSaveDialog = async () => ({ canceled: data.canceled, filePath: data.file }) }, { file, canceled })
    }
    async function beginSave(page) {
      await page.getByRole('button', { name: '保存图片', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    }
    async function finishSave(page) {
      await page.getByRole('button', { name: '确认保存', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 60000 })
      await expect(page.getByTestId('pdf-export-progress')).toBeHidden({ timeout: 60000 })
    }
    const denied = await settings.evaluate(async () => {
      try { await window.fanhua.beginPdfSave({ pageCount: 1 }); return false } catch { return true }
    })
    assert.equal(denied, true, 'Non-preview windows cannot start PDF exports')

    const preview = await open(source.file)
    await ready(preview, 1000, 600)
    const originalFirstPage = await preview.getByTestId('editor-canvas').evaluate(canvas => canvas.toDataURL())
    await expect(preview.getByTestId('pdf-page-bar')).toBeVisible()
    await expect(preview.getByRole('button', { name: '上一页', exact: true })).toBeDisabled()
    await preview.getByRole('button', { name: '进入编辑模式', exact: true }).click()
    await preview.getByRole('button', { name: '文字工具', exact: true }).click()
    await clickImage(preview, 140, 240)
    const textInput = preview.getByRole('textbox', { name: '标注文字内容', exact: true })
    await textInput.fill('PDF PAGE ONE EDIT')
    await preview.getByRole('button', { name: '水印设置', exact: true }).click()
    await preview.getByRole('switch', { name: '启用水印', exact: true }).click()
    await preview.getByRole('textbox', { name: '水印文字内容', exact: true }).fill('PDF WATERMARK')
    await preview.getByRole('button', { name: '水印位置 左下', exact: true }).click()
    await preview.getByRole('button', { name: '完成水印设置', exact: true }).click()
    // Simulate the OCR engine's single active job. Paging quickly must wait for
    // that old job and then identify only the latest page, never queue all pages.
    await app.evaluate(({ ipcMain, nativeImage }) => {
      const handlers = Reflect.get(ipcMain, '_invokeHandlers')
      global.__originalPdfOcrHandler = handlers.get('ocr:recognize')
      global.__pdfOcrInputs = []; global.__pdfOcrBusy = false; global.__pdfReleaseOcr = false
      ipcMain.removeHandler('ocr:recognize')
      ipcMain.handle('ocr:recognize', async (_event, dataUrl) => {
        if (global.__pdfOcrBusy) throw Error('已有文字识别任务正在进行')
        global.__pdfOcrBusy = true
        global.__pdfOcrInputs.push(dataUrl)
        const size = nativeImage.createFromDataURL(dataUrl).getSize()
        if (global.__pdfOcrInputs.length === 1) while (!global.__pdfReleaseOcr) await new Promise(resolve => setTimeout(resolve, 20))
        global.__pdfOcrBusy = false
        const text = `PAGE ${size.width === 1000 ? 1 : size.width === 720 ? 2 : 3} SOURCE`
        const bounds = { x: 70, y: 60, width: 300, height: 50 }
        const lines = [{ text, bounds }]
        return { text, language: 'en-US', ...size, lines, paragraphs: [{ id: text, text, bounds, lines }] }
      })
    })
    await preview.getByRole('button', { name: '识别文字', exact: true }).click()
    await expect.poll(() => app.evaluate(() => global.__pdfOcrInputs.length)).toBe(1)
    await go(preview, 2, 720, 960)
    await go(preview, 3, 840, 560)
    await go(preview, 2, 720, 960)
    assert.equal(await app.evaluate(() => global.__pdfOcrInputs.length), 1)
    await app.evaluate(() => { global.__pdfReleaseOcr = true })
    await expect.poll(() => app.evaluate(() => global.__pdfOcrInputs.length)).toBe(2)
    await preview.getByRole('button', { name: '选择第 1 段：PAGE 2 SOURCE', exact: true }).click()
    await expect(preview.getByRole('textbox', { name: '编辑第 1 段文字', exact: true })).toHaveValue('PAGE 2 SOURCE')
    const originalOcr = await app.evaluate(({ nativeImage }, original) => nativeImage.createFromDataURL(global.__pdfOcrInputs[0]).toBitmap().equals(nativeImage.createFromDataURL(original).toBitmap()), originalFirstPage)
    assert.equal(originalOcr, true, 'PDF OCR must read the source page without edits or watermark')
    await preview.getByRole('button', { name: '识别文字', exact: true }).click()
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('ocr:recognize'); ipcMain.handle('ocr:recognize', global.__originalPdfOcrHandler) })
    report.ocrOriginalPixelsAndLatestPageQueue = true
    await expect(preview.getByRole('button', { name: /^选择图层 / })).toHaveCount(0)
    await expect(preview.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await preview.getByRole('button', { name: '文字工具', exact: true }).click()
    await clickImage(preview, 100, 260)
    await textInput.fill('PDF PAGE TWO EDIT')
    await go(preview, 1, 1000, 600)
    await expect(preview.getByRole('button', { name: '选择图层 PDF PAGE ONE EDIT', exact: true })).toBeVisible()
    await expect(preview.getByRole('button', { name: '选择图层 PDF PAGE TWO EDIT', exact: true })).toHaveCount(0)
    await preview.getByRole('button', { name: '水印设置', exact: true }).click()
    await expect(preview.getByRole('textbox', { name: '水印文字内容', exact: true })).toHaveValue('PDF WATERMARK')
    await preview.getByRole('button', { name: '完成水印设置', exact: true }).click()
    await go(preview, 2, 720, 960)
    await preview.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(preview.getByRole('button', { name: '选择图层 PDF PAGE TWO EDIT', exact: true })).toHaveCount(0)
    await preview.getByRole('button', { name: '重做', exact: true }).click()
    await expect(preview.getByRole('button', { name: '选择图层 PDF PAGE TWO EDIT', exact: true })).toBeVisible()
    await go(preview, 3, 840, 560)
    await expect(preview.getByRole('button', { name: '下一页', exact: true })).toBeDisabled()
    await expect(preview.getByRole('button', { name: /^选择图层 / })).toHaveCount(0)
    report.pageEditsHistoryAndWatermarkIndependent = true
    report.rotatedPageDimensions = [840, 560]

    // Capture actual composed PNGs handed to the PDF service for round-trip
    // comparison; the handler still executes and writes the real PDF.
    await app.evaluate(({ ipcMain }) => {
      global.__pdfPages = []
      const handlers = Reflect.get(ipcMain, '_invokeHandlers')
      const channel = [...handlers.keys()].find(key => /pdf.*append|pdf.*page/.test(key))
      if (!channel) throw Error('PDF append handler missing')
      const original = handlers.get(channel)
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, jobId, page) => {
        global.__pdfPages.push(page)
        if (global.__pdfHoldAppend) {
          global.__pdfAppendWaiting = true
          while (global.__pdfHoldAppend) await new Promise(resolve => setTimeout(resolve, 20))
        }
        return original(event, jobId, page)
      })
    })
    const allFile = path.join(artifacts, `pdf-edited-all-${mode}.pdf`)
    await saveDialog(allFile)
    await beginSave(preview)
    await expect(preview.getByLabel('保存格式', { exact: true })).toContainText('PDF')
    await finishSave(preview)
    const exported = await PDFDocument.load(await fs.readFile(allFile))
    assert.equal(exported.getPageCount(), 3)
    assert.deepEqual(exported.getPages().map(page => [page.getWidth(), page.getHeight()]), [[500, 300], [360, 480], [420, 280]])
    const composed = await app.evaluate(() => global.__pdfPages)
    assert.equal(composed.length, 3)
    assert.deepEqual(composed.map(page => [page.widthPoints, page.heightPoints]), [[500, 300], [360, 480], [420, 280]])
    report.allPagesPdfPreservesOrderAndPhysicalSize = true
    assert.equal(hash(await fs.readFile(source.file)), hash(source.bytes), 'Editing must not rewrite the input file')
    report.originalFileUnchanged = true
    await preview.screenshot({ path: path.join(artifacts, `pdf-editor-${mode}.png`) })

    // Reopen the generated file through the actual application and compare its
    // raster against each pre-save composed PNG, including text and watermark.
    const reopened = await open(allFile)
    for (const [index, size] of [[1000, 600], [720, 960], [840, 560]].entries()) {
      if (index) await go(reopened, index + 1, ...size); else await ready(reopened, ...size)
      const pixels = await reopened.getByTestId('editor-canvas').evaluate(async (canvas, png) => {
        const image = new Image(); image.src = png
        await image.decode()
        const expected = document.createElement('canvas'); expected.width = image.naturalWidth; expected.height = image.naturalHeight
        const ctx = expected.getContext('2d'); ctx.drawImage(image, 0, 0)
        const a = ctx.getImageData(0, 0, expected.width, expected.height).data
        const b = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let different = 0, totalDelta = 0
        for (let i = 0; i < a.length; i += 4) {
          const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
          if (delta > 12) different++
          totalDelta += delta
        }
        return { width: canvas.width, height: canvas.height, fraction: different / (a.length / 4), average: totalDelta / (a.length / 4) }
      }, composed[index].dataUrl)
      assert(pixels.fraction < .015 && pixels.average < 2, `PDF page ${index + 1} raster changed: ${JSON.stringify(pixels)}`)
    }
    report.savedPdfRenderedAndPixelCompared = true
    await reopened.screenshot({ path: path.join(artifacts, `pdf-reopened-${mode}.png`) })
    await reopened.close()

    await go(preview, 2, 720, 960)
    const pngFile = path.join(artifacts, `pdf-current-page-${mode}.png`)
    await saveDialog(pngFile); await beginSave(preview)
    await select(preview, '保存格式', 'PNG ·')
    await finishSave(preview)
    const pngSize = await app.evaluate(({ nativeImage }, file) => nativeImage.createFromPath(file).getSize(), pngFile)
    assert.deepEqual(pngSize, { width: 720, height: 960 })
    report.currentPageImageExport = true
    const singleFile = path.join(artifacts, `pdf-current-page-${mode}.pdf`)
    await saveDialog(singleFile); await beginSave(preview)
    await select(preview, '保存格式', 'PDF ·')
    await select(preview, 'PDF 导出范围', '当前页')
    await finishSave(preview)
    const single = await PDFDocument.load(await fs.readFile(singleFile))
    assert.equal(single.getPageCount(), 1)
    assert.deepEqual(single.getPage(0).getSize(), { width: 360, height: 480 })
    report.currentPagePdfExport = true

    // A normal image uses the same PDF output, with predictable 96-dpi size.
    const imagePreview = await open(pngFile)
    await ready(imagePreview, 720, 960)
    await expect(imagePreview.getByTestId('pdf-page-bar')).toHaveCount(0)
    const imagePdfFile = path.join(artifacts, `image-to-pdf-${mode}.pdf`)
    await saveDialog(imagePdfFile); await beginSave(imagePreview)
    await select(imagePreview, '保存格式', 'PDF ·')
    await finishSave(imagePreview)
    const imagePdf = await PDFDocument.load(await fs.readFile(imagePdfFile))
    assert.equal(imagePdf.getPageCount(), 1)
    assert.deepEqual(imagePdf.getPage(0).getSize(), { width: 540, height: 720 })
    report.imageToPdf = true
    await imagePreview.close()

    // Cancel while a page is being handed off. The prior destination remains
    // untouched, editing/navigation are locked, and dirty pages stay dirty.
    await preview.getByRole('button', { name: '选择图层 PDF PAGE TWO EDIT', exact: true }).click()
    await textInput.fill('PDF CANCELLED EDIT')
    const cancelFile = path.join(artifacts, `pdf-cancel-preserve-${mode}.pdf`)
    await fs.writeFile(cancelFile, 'KEEP_EXISTING_DOCUMENT')
    await saveDialog(cancelFile)
    await app.evaluate(() => { global.__pdfHoldAppend = true; global.__pdfAppendWaiting = false })
    await beginSave(preview)
    await preview.getByRole('button', { name: '确认保存', exact: true }).click()
    await expect.poll(() => app.evaluate(() => global.__pdfAppendWaiting)).toBe(true)
    await expect(preview.getByRole('spinbutton', { name: 'PDF 页码', exact: true })).toBeDisabled()
    await expect(preview.getByTestId('pdf-export-progress')).toBeVisible()
    await preview.getByRole('button', { name: '取消 PDF 导出', exact: true }).click()
    await app.evaluate(() => { global.__pdfHoldAppend = false })
    await expect(preview.getByRole('dialog')).toBeHidden()
    await expect(preview.getByRole('spinbutton', { name: 'PDF 页码', exact: true })).toBeEnabled()
    await expect(preview.locator('.image-status')).toContainText('未保存')
    assert.equal(await fs.readFile(cancelFile, 'utf8'), 'KEEP_EXISTING_DOCUMENT')
    assert.equal((await fs.readdir(artifacts)).some(file => /^\.fanhua-.*\.pdf\.tmp$/.test(file)), false)
    report.cancelPreservesExistingFileAndDirtyState = true

    const damaged = path.join(artifacts, 'pdf-damaged.pdf')
    await fs.writeFile(damaged, '%PDF-1.7\nThis document is deliberately incomplete.\n%%EOF')
    const invalid = await open(damaged)
    await expect(invalid.getByTestId('editor-canvas')).toHaveCount(0)
    await expect(invalid.locator('.load-state h2')).not.toContainText('正在读取', { timeout: 30000 })
    await expect(invalid.locator('.load-state h2')).toContainText(/PDF|文件|损坏/, { timeout: 30000 })
    report.damagedPdfShowsRecoverableError = true
    await invalid.close()

    assert.deepEqual(errors, [])
    assert.deepEqual(remoteRequests, [], 'PDF operations must not request remote resources')
    report.pageErrors = errors; report.remoteRequests = remoteRequests
    await fs.writeFile(path.join(artifacts, `pdf-regression-${mode}.json`), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    if (current && !current.isClosed()) {
      await current.screenshot({ path: path.join(artifacts, `pdf-failure-${mode}.png`) }).catch(() => {})
      await fs.writeFile(path.join(artifacts, `pdf-failure-${mode}.txt`), await current.locator('body').innerText().catch(() => String(error)))
    }
    throw error
  } finally { await app.close().catch(() => {}) }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
