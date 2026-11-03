'use strict'

// Isolated file:// Electron harness using the production PDF service and CSP.
// Fixtures are generated locally; no external document or network is required.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { _electron: electron, expect } = require('@playwright/test')
const { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, StandardFonts, degrees, rgb, cmyk } = require('pdf-lib')

const project = path.resolve(__dirname, '..')
const harness = path.join(project, 'artifacts', 'pdf-renderer-harness')

async function fixtures() {
  const pdf = await PDFDocument.create()
  const text = await pdf.embedFont(StandardFonts.Helvetica)
  const symbol = await pdf.embedFont(StandardFonts.Symbol)
  const first = pdf.addPage([300, 200])
  first.drawRectangle({ x: 20, y: 20, width: 60, height: 40, color: rgb(1, 0, 0) })
  first.drawRectangle({ x: 100, y: 20, width: 50, height: 40, color: cmyk(1, 0, 0, 0) })
  first.drawText('Offline PDF rendering', { x: 20, y: 150, size: 18, font: text })
  first.drawText('Σ', { x: 20, y: 100, size: 26, font: symbol })
  const rotated = pdf.addPage([200, 400])
  rotated.setRotation(degrees(90))
  rotated.drawRectangle({ x: 10, y: 20, width: 30, height: 50, color: rgb(0, 0, 1) })
  const cropped = pdf.addPage([600, 400])
  cropped.setCropBox(40, 50, 200, 150)
  cropped.setRotation(degrees(270))
  cropped.node.set(PDFName.of('UserUnit'), PDFNumber.of(2))
  cropped.drawText('Crop + unit + rotation', { x: 50, y: 100, size: 16, font: text })
  pdf.addPage([40_000, 20_000])
  pdf.addPage([30_000, 1_000])

  // Non-embedded Adobe GB1 CID font forces the actual bundled CMap path.
  const chinese = pdf.addPage([300, 200])
  const context = pdf.context
  const descriptor = context.register(context.obj({ Type: 'FontDescriptor', FontName: 'STSong-Light', Flags: 6,
    FontBBox: [0, -200, 1000, 900], ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 800, StemV: 80 }))
  const descendant = context.register(context.obj({ Type: 'Font', Subtype: 'CIDFontType0', BaseFont: 'STSong-Light',
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('GB1'), Supplement: 5 }, FontDescriptor: descriptor, DW: 1000 }))
  const chineseFont = context.register(context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'STSong-Light', Encoding: 'UniGB-UCS2-H', DescendantFonts: [descendant] }))
  chinese.node.set(PDFName.of('Resources'), context.obj({ Font: { FChinese: chineseFont } }))
  chinese.node.set(PDFName.of('Contents'), context.register(context.stream('BT /FChinese 28 Tf 30 110 Td <4E2D65876D4B8BD5> Tj ET')))
  pdf.addJavaScript('never-execute', 'globalThis.__pdfScriptExecuted = true; app.alert("PDF scripts must not run");')

  const many = await PDFDocument.create()
  for (let index = 0; index < 201; index++) many.addPage([20, 20])
  const encrypted = await PDFDocument.create()
  encrypted.addPage([100, 100])
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({ Filter: 'Standard', V: 1, R: 2, Length: 40,
    O: PDFHexString.of('00'.repeat(32)), U: PDFHexString.of('11'.repeat(32)), P: -4 }))
  encrypted.context.trailerInfo.ID = encrypted.context.obj([PDFHexString.of('12'.repeat(16)), PDFHexString.of('12'.repeat(16))])
  return {
    normal: Array.from(await pdf.save({ useObjectStreams: false })),
    tooMany: Array.from(await many.save({ useObjectStreams: false })),
    encrypted: Array.from(await encrypted.save({ useObjectStreams: false })),
  }
}

async function main() {
  await fs.mkdir(harness, { recursive: true })
  const { build } = await import('vite')
  await build({ configFile: false, root: project, base: './', publicDir: false, logLevel: 'warn', build: {
    target: 'chrome132', outDir: harness, emptyOutDir: false,
    lib: { entry: path.join(project, 'src/pdf/document.ts'), formats: ['es'], fileName: () => 'service.js' },
  } })
  await fs.cp(path.join(project, 'public/pdf-assets'), path.join(harness, 'pdf-assets'), { recursive: true })
  const csp = (await fs.readFile(path.join(project, 'index.html'), 'utf8')).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1]
  await fs.writeFile(path.join(harness, 'index.html'), `<!doctype html><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>PDF 离线渲染验证</title><script type="module" src="./harness.js"></script><body><h2>PDF 本地渲染验证</h2><img id="page" style="max-width:95vw;max-height:80vh"></body>`, 'utf8')
  await fs.writeFile(path.join(harness, 'harness.js'), `import * as service from './service.js'; window.pdfService = service; window.pdfAssetRequests = []; const original = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(method,url,...args){ window.pdfAssetRequests.push(String(url)); return original.call(this,method,url,...args) };`, 'utf8')
  await fs.writeFile(path.join(harness, 'main.cjs'), `'use strict'; const {app,BrowserWindow}=require('electron'); const path=require('node:path'); app.setPath('userData',path.join(__dirname,'profile')); app.whenReady().then(()=>{ const win=new BrowserWindow({width:900,height:720,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});win.loadFile(path.join(__dirname,'index.html')); });`, 'utf8')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(harness, 'main.cjs')], env, timeout: 30000 })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    const errors = [], remoteRequests = [], workers = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()) })
    page.on('worker', worker => workers.push(worker.url()))
    await page.waitForFunction(() => !!window.pdfService)
    const data = await fixtures()
    const opened = await page.evaluate(async bytes => {
      const input = new Uint8Array(bytes)
      window.pdfSource = await window.pdfService.openPdf(input)
      return { count: window.pdfSource.pageCount, originalBytesPreserved: input.length === bytes.length && input[0] === 37 }
    }, data.normal)
    assert.deepEqual(opened, { count: 6, originalBytesPreserved: true })
    const dimensions = []
    for (let number = 1; number <= 6; number++) {
      const rendered = await page.evaluate(async number => {
        const result = await window.pdfSource.renderPage(number)
        const image = new Image(); image.src = result.dataUrl; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = result.width; canvas.height = result.height
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
        const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let ink = 0, red = 0, cyan = 0
        for (let i = 0; i < bytes.length; i += 4) {
          if (bytes[i] < 230 || bytes[i + 1] < 230 || bytes[i + 2] < 230) ink++
          if (bytes[i] > 220 && bytes[i + 1] < 30 && bytes[i + 2] < 30) red++
          if (bytes[i] < 100 && bytes[i + 1] > 120 && bytes[i + 2] > 150) cyan++
        }
        if (number === 1 || number === 6) document.getElementById('page').src = result.dataUrl
        canvas.width = canvas.height = 0
        const { dataUrl, ...metadata } = result
        return { ...metadata, ink, red, cyan, png: dataUrl.startsWith('data:image/png;base64,') }
      }, number)
      assert(rendered.png)
      assert(rendered.width <= 8192 && rendered.height <= 8192 && rendered.width * rendered.height <= 16_000_000)
      dimensions.push(rendered)
    }
    assert.deepEqual(dimensions.slice(0, 3).map(({ width, height, widthPoints, heightPoints }) => ({ width, height, widthPoints, heightPoints })), [
      { width: 600, height: 400, widthPoints: 300, heightPoints: 200 },
      { width: 800, height: 400, widthPoints: 400, heightPoints: 200 },
      { width: 600, height: 800, widthPoints: 300, heightPoints: 400 },
    ])
    assert(dimensions[0].red > 9000 && dimensions[0].ink > dimensions[0].red, 'Text and vector graphics must actually render')
    assert(dimensions[0].cyan > 7000, 'Local CMYK conversion must render the cyan fill')
    assert(dimensions[3].width * dimensions[3].height > 15_000_000, 'Large pages should use the available resolution budget')
    assert.equal(dimensions[4].width, 8192)
    assert(dimensions[5].ink > 200, 'CJK text must produce visible glyphs')
    assert.equal(await page.evaluate(() => !!window.__pdfScriptExecuted), false)
    const assets = await page.evaluate(() => window.pdfAssetRequests)
    assert(assets.some(url => /\/cmaps\/.*\.bcmap$/.test(url)), 'Exercise real local CMap bytes')
    assert(assets.some(url => /\/standard_fonts\/.*\.(pfb|ttf)$/.test(url)), 'Exercise real local standard font bytes')
    assert(assets.every(url => url.startsWith('file:') && url.includes('/pdf-assets/')))
    assert(workers.some(url => url.startsWith('blob:') || url.startsWith('file:')), 'Use a real local parsing worker')
    const browserWindow = await app.browserWindow(page)
    await browserWindow.evaluate(win => win.show())
    await page.screenshot({ path: path.join(project, 'artifacts', 'pdf-renderer-cjk.png') })

    // Request a new page after the service has allocated its first canvas:
    // cancel an actual RenderTask, not just a request still in the queue.
    const canceled = await page.evaluate(async () => {
      const original = document.createElement.bind(document)
      let next
      const started = new Promise(resolve => {
        document.createElement = function(tag, ...args) {
          const element = original(tag, ...args)
          if (tag === 'canvas') {
            document.createElement = original
            queueMicrotask(() => { next = window.pdfSource.renderPage(2); resolve() })
          }
          return element
        }
      })
      const first = window.pdfSource.renderPage(4)
      await started
      const settled = await Promise.allSettled([first, next])
      document.createElement = original
      return settled.map(item => item.status === 'rejected' ? item.reason.name : item.value.width)
    })
    assert.deepEqual(canceled, ['AbortError', 800])
    const cancelWithoutClose = await page.evaluate(async () => {
      const original = document.createElement.bind(document)
      document.createElement = function(tag, ...args) {
        const element = original(tag, ...args)
        if (tag === 'canvas') { document.createElement = original; queueMicrotask(() => window.pdfSource.cancelRender()) }
        return element
      }
      let canceled
      try { await window.pdfSource.renderPage(4) } catch (error) { canceled = error.name }
      document.createElement = original
      const next = await window.pdfSource.renderPage(2)
      return { canceled, retryWidth: next.width }
    })
    assert.deepEqual(cancelWithoutClose, { canceled: 'AbortError', retryWidth: 800 })
    const closed = await page.evaluate(async () => {
      const original = document.createElement.bind(document)
      let closing
      const started = new Promise(resolve => {
        document.createElement = function(tag, ...args) {
          const element = original(tag, ...args)
          if (tag === 'canvas') {
            document.createElement = original
            queueMicrotask(() => { closing = window.pdfSource.destroy(); resolve() })
          }
          return element
        }
      })
      const render = window.pdfSource.renderPage(4)
      await started
      const settled = await Promise.allSettled([render, closing])
      document.createElement = original
      let after
      try { await window.pdfSource.renderPage(1) } catch (error) { after = error.name }
      await window.pdfSource.destroy()
      return { render: settled[0].status === 'rejected' && settled[0].reason.name, closed: settled[1].status, after }
    })
    assert.deepEqual(closed, { render: 'AbortError', closed: 'fulfilled', after: 'AbortError' })
    const failures = {}
    for (const [name, bytes] of Object.entries({ broken: Array.from(Buffer.from('%PDF-1.7\nnot a valid PDF')), tooMany: data.tooMany, encrypted: data.encrypted })) {
      failures[name] = await page.evaluate(async bytes => {
        try { const source = await window.pdfService.openPdf(new Uint8Array(bytes)); await source.destroy(); return '' }
        catch (error) { return error.message }
      }, bytes)
    }
    assert.match(failures.broken, /损坏|无效/)
    assert.match(failures.tooMany, /200/)
    assert.match(failures.encrypted, /密码|解密/)
    assert.deepEqual(errors, [])
    assert.deepEqual(remoteRequests, [])
    const result = { fileProtocol: true, actualWorker: true, dimensions, localAssets: assets, canceledRender: true, cancelWithoutClose, destroyDuringRender: true,
      originalBytesPreserved: true, scriptNotExecuted: true, failures, remoteRequests, pageErrors: errors }
    await fs.writeFile(path.join(project, 'artifacts', 'pdf-renderer-regression.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result, null, 2))
  } finally { await app.close().catch(() => {}) }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
