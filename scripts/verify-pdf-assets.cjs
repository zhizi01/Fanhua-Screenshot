'use strict'

// Verify the real release ASAR, then render a generated CJK PDF in that EXE.
// --hash-only performs just the read-only archive/public byte comparison.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const asar = require('@electron/asar')
const { _electron: electron, expect } = require('@playwright/test')
const { PDFDocument, PDFName, PDFString } = require('pdf-lib')

const project = path.resolve(__dirname, '..')
const { version } = require('../package.json')
const executable = path.resolve(process.argv.find((argument, index) => index > 1 && argument !== '--hash-only')
  || path.join(project, 'release', version, 'win-unpacked', '繁花有图.exe'))
const archive = path.join(path.dirname(executable), 'resources', 'app.asar')
const source = path.join(project, 'public', 'pdf-assets')
const artifacts = path.join(project, 'artifacts')
const reportFile = path.join(artifacts, 'pdf-assets-packaged.json')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function allFiles(directory, prefix = '') {
  const result = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`
    if (entry.isDirectory()) result.push(...await allFiles(path.join(directory, entry.name), `${name}/`))
    else if (entry.isFile()) result.push(name)
    else throw Error(`Unexpected PDF asset link: ${name}`)
  }
  return result.sort()
}

async function verifyArchive() {
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'))
  assert.equal(manifest.package, 'pdfjs-dist')
  assert.equal(manifest.version, require('pdfjs-dist/package.json').version)
  const expected = [...manifest.files, 'manifest.json'].sort()
  assert.deepEqual(await allFiles(source), expected, 'The generated directory must contain exactly the declared offline assets and manifest')
  const archived = asar.listPackage(archive).map(name => name.replace(/\\/g, '/').replace(/^\//, ''))
    .filter(name => name.startsWith('dist/pdf-assets/') && !('files' in asar.statFile(archive, path.normalize(name))))
    .map(name => name.slice('dist/pdf-assets/'.length)).sort()
  assert.deepEqual(archived, expected, 'Release ASAR must contain every font, CMap, worker and decoder, without stale assets')
  const files = []
  for (const name of expected) {
    const storedPath = path.normalize(`dist/pdf-assets/${name}`)
    const info = asar.statFile(archive, storedPath)
    assert(!info.unpacked, `Expected asset inside app.asar: ${name}`)
    const local = await fs.readFile(path.join(source, name))
    const packaged = asar.extractFile(archive, storedPath)
    const sha256 = hash(local)
    assert.equal(packaged.length, local.length, `${name}: packaged byte length differs`)
    assert.equal(hash(packaged), sha256, `${name}: packaged SHA-256 differs`)
    files.push({ path: name, bytes: local.length, sha256 })
  }
  assert(!files.some(file => /quickjs|sandbox/i.test(file.path)), 'PDF JavaScript engines must not be shipped as render assets')
  return { appVersion: version, pdfjsVersion: manifest.version, executable, archive, assetCount: manifest.files.length,
    manifestAlsoVerified: true, identicalBytes: true, storedInsideAsar: true, files, guiTested: false }
}

async function createFixture() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([520, 300])
  const context = pdf.context
  const descriptor = context.register(context.obj({ Type: 'FontDescriptor', FontName: 'STSong-Light', Flags: 6,
    FontBBox: [0, -200, 1000, 900], ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 800, StemV: 80 }))
  const descendant = context.register(context.obj({ Type: 'Font', Subtype: 'CIDFontType0', BaseFont: 'STSong-Light',
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('GB1'), Supplement: 5 }, FontDescriptor: descriptor, DW: 1000 }))
  const chineseFont = context.register(context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'STSong-Light', Encoding: 'UniGB-UCS2-H', DescendantFonts: [descendant] }))
  const symbolFont = context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Symbol' }))
  const latinFont = context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }))
  page.node.set(PDFName.of('Resources'), context.obj({ Font: { FChinese: chineseFont, FSymbol: symbolFont, FLatin: latinFont } }))
  const text = '繁花有图 中文测试'
  const unicode = [...text].map(character => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  page.node.set(PDFName.of('Contents'), context.register(context.stream([
    'BT /FLatin 18 Tf 30 250 Td (Offline PDF - packaged ASAR assets) Tj ET',
    `BT /FChinese 28 Tf 30 180 Td <${unicode}> Tj ET`,
    'BT /FSymbol 28 Tf 30 80 Td (S p W) Tj ET',
    '0.4 0.2 0.8 rg 390 50 70 50 re f',
  ].join('\n'))))
  const file = path.join(artifacts, 'pdf-assets-chinese.pdf')
  await fs.writeFile(file, await pdf.save({ useObjectStreams: false }))
  return file
}

async function verifyPackagedGui(report) {
  const fixture = await createFixture()
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const app = await electron.launch({ executablePath: executable,
    args: [`--user-data-dir=${path.join(artifacts, 'pdf-assets-packaged-profile')}`, '--show-window'],
    cwd: project, env, timeout: 30000 })
  const pageErrors = [], remoteRequests = [], workerUrls = []
  let preview
  try {
    app.context().on('request', request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()) })
    app.context().on('page', page => {
      page.on('pageerror', error => pageErrors.push(error.message))
      page.on('worker', worker => workerUrls.push(worker.url()))
    })
    await app.context().addInitScript(() => {
      window.__pdfAssetReads = []
      const original = XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function(method, url, ...args) {
        if (String(url).includes('/pdf-assets/')) {
          const entry = { url: String(url), status: null, bytes: 0, sha256: '', error: '' }
          window.__pdfAssetReads.push(entry)
          this.addEventListener('load', async () => {
            entry.status = this.status
            if (this.response instanceof ArrayBuffer) {
              entry.bytes = this.response.byteLength
              entry.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', this.response))]
                .map(byte => byte.toString(16).padStart(2, '0')).join('')
            }
          })
          this.addEventListener('error', () => { entry.error = 'read failed' })
        }
        return original.call(this, method, url, ...args)
      }
    })
    await expect.poll(() => app.windows().some(page => page.url().includes('view=dashboard')), { timeout: 20000 }).toBe(true)
    const dashboard = app.windows().find(page => page.url().includes('view=dashboard'))
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, fixture)
    await dashboard.evaluate(() => window.fanhua.openImage())
    await expect.poll(() => app.windows().some(page => page.url().includes('view=preview')), { timeout: 20000 }).toBe(true)
    preview = app.windows().find(page => page.url().includes('view=preview'))
    preview.setDefaultTimeout(20000)
    await expect(preview.getByTestId('pdf-page-count')).toHaveText('/ 1')
    const canvas = preview.getByTestId('editor-canvas')
    await expect(canvas).toBeVisible()
    await expect.poll(() => canvas.evaluate(element => {
      const pixels = element.getContext('2d').getImageData(50, 170, 750, 90).data
      let ink = 0
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 180 && pixels[index + 1] < 180 && pixels[index + 2] < 180 && pixels[index + 3] > 200) ink++
      return ink
    })).toBeGreaterThan(1500)
    await expect.poll(() => preview.evaluate(() => window.__pdfAssetReads.filter(item => item.sha256).length)).toBeGreaterThanOrEqual(3)
    const reads = await preview.evaluate(() => window.__pdfAssetReads)
    const filenames = []
    for (const read of reads) {
      const url = new URL(read.url)
      const decoded = decodeURIComponent(url.pathname).replace(/\\/g, '/')
      const marker = '/resources/app.asar/dist/pdf-assets/'
      assert.equal(url.protocol, 'file:')
      assert(decoded.includes(marker), `PDF resource must actually be read from app.asar: ${read.url}`)
      const filename = decoded.slice(decoded.indexOf(marker) + marker.length)
      filenames.push(filename)
      const expected = report.files.find(file => file.path === filename)
      assert(expected, `Unexpected runtime PDF asset: ${filename}`)
      assert.equal(read.error, '')
      assert([0, 200].includes(read.status), `Local asset read failed: ${filename}`)
      assert.equal(read.bytes, expected.bytes)
      assert.equal(read.sha256, expected.sha256, `Runtime bytes differ from the verified ASAR asset: ${filename}`)
    }
    assert(filenames.includes('standard_fonts/FoxitSymbol.pfb'))
    assert(filenames.includes('cmaps/UniGB-UCS2-H.bcmap'))
    assert(filenames.includes('cmaps/Adobe-GB1-UCS2.bcmap'))
    assert(workerUrls.length > 0 && workerUrls.every(url => /^(blob:|file:)/.test(url)), 'Use a real local PDF parsing worker')
    const pixels = await canvas.evaluate(element => {
      const values = element.getContext('2d').getImageData(50, 390, 350, 80).data
      let ink = 0
      for (let index = 0; index < values.length; index += 4) if (values[index] < 180 && values[index + 1] < 180 && values[index + 2] < 180 && values[index + 3] > 200) ink++
      return { width: element.width, height: element.height, symbolInkPixels: ink }
    })
    assert.deepEqual({ width: pixels.width, height: pixels.height }, { width: 1040, height: 600 })
    assert(pixels.symbolInkPixels > 300, 'Symbol font must produce real glyph pixels')
    await preview.screenshot({ path: path.join(artifacts, 'pdf-assets-packaged.png'), animations: 'disabled' })
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(remoteRequests, [])
    Object.assign(report, { guiTested: true, fixture, actualAsarResourceReads: reads, actualLocalWorker: true, pixels,
      chineseGlyphsRendered: true, symbolGlyphsRendered: true, remoteRequests, pageErrors })
  } catch (error) {
    if (preview) await preview.screenshot({ path: path.join(artifacts, 'pdf-assets-packaged-failure.png') }).catch(() => {})
    throw error
  } finally { await app.close().catch(() => {}) }
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true })
  const report = await verifyArchive()
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n')
  console.log(`ASAR 内 ${report.assetCount} 项 PDF 资源与 manifest 已逐文件核对 SHA-256，一致。`)
  if (!process.argv.includes('--hash-only')) {
    await verifyPackagedGui(report)
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ appVersion: report.appVersion, assetCount: report.assetCount, guiTested: report.guiTested,
      actualAsarResourceReads: report.actualAsarResourceReads, actualLocalWorker: report.actualLocalWorker, pixels: report.pixels,
      chineseGlyphsRendered: report.chineseGlyphsRendered, symbolGlyphsRendered: report.symbolGlyphsRendered,
      remoteRequests: report.remoteRequests, pageErrors: report.pageErrors }, null, 2))
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
