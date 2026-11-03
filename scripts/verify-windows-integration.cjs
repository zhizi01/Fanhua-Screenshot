'use strict'

// Generates all fixtures locally. Never runs an installer, changes Explorer
// associations, touches the clipboard, or sends data to another device.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const project = path.resolve(__dirname, '..')
const artifacts = path.join(project, 'artifacts')

function spawnAndWait(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error('图片编辑启动测试超时')) }, 30000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`Electron exited ${code}\n${stdout}\n${stderr}`))
      else resolve(stdout)
    })
  })
}

function bitmapFixture(width, height) {
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4
    pixels[offset] = (x * 19 + y * 3) % 256
    pixels[offset + 1] = (x * 7 + y * 11) % 256
    pixels[offset + 2] = (x * 5 + y * 17) % 256
    pixels[offset + 3] = 255
  }
  return pixels
}

function bmp32(pixels, width, height, topDown) {
  const result = Buffer.alloc(54 + width * height * 4)
  result.write('BM'); result.writeUInt32LE(result.length, 2); result.writeUInt32LE(54, 10)
  result.writeUInt32LE(40, 14); result.writeInt32LE(width, 18); result.writeInt32LE(topDown ? -height : height, 22)
  result.writeUInt16LE(1, 26); result.writeUInt16LE(32, 28)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (y * width + x) * 4, target = 54 + ((topDown ? y : height - y - 1) * width + x) * 4
    pixels.copy(result, target, source, source + 3)
    // Reserved BI_RGB byte intentionally stays zero.
  }
  return result
}

async function checkInstaller() {
  const source = await fs.readFile(path.join(project, 'build/installer.nsh'), 'utf8')
  assert(!/^\s*WriteReg\w+\b/m.test(source), 'Installing must never opt the user into an Explorer menu')
  assert(!/UserChoice|SetShellVarContext/i.test(source), 'Cleanup must preserve default associations and installer-selected scope')
  assert(source.includes('"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" --edit-image "%1"'), 'Both executable and image path must be quoted')
  for (const extension of ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'pdf']) {
    assert(source.includes('!insertmacro FanhuaRemoveLegacyImageVerb ${ROOT} "' + extension + '"'))
    assert(source.includes('!insertmacro FanhuaUnregisterImageVerb ${ROOT} "' + extension + '"'))
  }
  const deletes = source.split('\n').filter(line => /DeleteRegKey/.test(line))
  assert(deletes.length > 0 && deletes.every(line => line.includes('${ROOT} "Software\\Classes\\SystemFileAssociations\\.${EXT}\\shell\\FanhuaScreenshot.Edit')))
  const legacy = source.slice(source.indexOf('!macro FanhuaRemoveLegacyImageVerb'), source.indexOf('!macroend'))
  assert(legacy.includes('${If} $R0 ==') && legacy.includes('"FanhuaOptIn"') && legacy.includes('${If} $R1 != "1"'), 'Legacy cleanup must preserve settings-created opt-in menus')
  assert(source.includes('!insertmacro FanhuaCleanLegacyScope SHCTX') && source.includes('!insertmacro FanhuaCleanLegacyScope HKCU'))
  const uninstall = source.slice(source.indexOf('!macro FanhuaUnregisterImageVerb'), source.indexOf('!macro FanhuaCleanLegacyScope'))
  assert(uninstall.includes('${If} $R0 ==') && uninstall.includes('DeleteRegKey ${ROOT}'), 'Uninstall must check command ownership before deleting its verb')
  const templates = path.join(project, 'node_modules/app-builder-lib/templates/nsis')
  const [multiUser, installer, uninstaller] = await Promise.all(['multiUser.nsh', 'installer.nsi', 'uninstaller.nsh'].map(file => fs.readFile(path.join(templates, file), 'utf8')))
  assert(/!macro setInstallModePerUser[\s\S]+?SetShellVarContext current/.test(multiUser))
  assert(/!macro setInstallModePerAllUsers[\s\S]+?SetShellVarContext all/.test(multiUser))
  assert(installer.indexOf('!insertmacro initMultiUser') < installer.indexOf('!include "installSection.nsh"'), 'Install context must be selected before customInstall')
  assert(uninstaller.indexOf('!insertmacro initMultiUser') < uninstaller.indexOf('!insertmacro customUnInstall'), 'Uninstall context must be selected before customUnInstall')
}

async function decoderTests(nativeImage) {
  const { EXTENSIONS, OPEN_EXTENSIONS, MAX_BYTES, parseEditImageArgs, validateImagePath, readImageFile, readPreviewFile, decodeImageBytes } = require('../electron/image-open.cjs')
  const { encodeBmp } = require('../electron/features.cjs')
  await fs.mkdir(artifacts, { recursive: true })
  await checkInstaller()
  assert.deepEqual(EXTENSIONS, ['png', 'jpg', 'jpeg', 'webp', 'bmp'])
  assert.deepEqual(OPEN_EXTENSIONS, [...EXTENSIONS, 'pdf'])
  const unusualPath = path.join(artifacts, '中文 图片 & 测试 (1).PNG')
  assert.equal(parseEditImageArgs(['electron.exe', '.', '--inspect=0', unusualPath]), null)
  assert.equal(parseEditImageArgs(['electron.exe', '.', '--edit-image', unusualPath, '--show-window']), unusualPath)
  assert.equal(parseEditImageArgs(['--edit-image=' + unusualPath]), null)
  for (const args of [['--edit-image'], ['--edit-image', 'photo.png'], ['--edit-image', '\\photo.png'], ['--edit-image', unusualPath, '--edit-image', unusualPath], ['--edit-image', 'https://example.test/a.png'], ['--edit-image', path.join(artifacts, 'a.gif')], ['--edit-image', unusualPath + '\0']]) {
    assert.throws(() => parseEditImageArgs(args))
  }
  assert.equal(validateImagePath('\\\\server\\pictures\\中文 图片.png'), '\\\\server\\pictures\\中文 图片.png')
  const pdfPath = path.join(artifacts, '中文文档.pdf')
  assert.equal(parseEditImageArgs(['--edit-image', pdfPath]), pdfPath)
  assert.throws(() => validateImagePath(pdfPath), /仅支持/, 'The image-only service must still reject PDFs')
  const width = 13, height = 7
  const pixels = bitmapFixture(width, height)
  const original = nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 })
  const png = original.toPNG(), jpeg = original.toJPEG(90), bmp = encodeBmp(original)
  for (const bytes of [png, jpeg, bmp, bmp32(pixels, width, height, false), bmp32(pixels, width, height, true)]) {
    const image = await decodeImageBytes(bytes, nativeImage)
    assert.deepEqual(image.getSize(), { width, height })
    if (bytes !== jpeg) assert(image.toBitmap().equals(pixels), 'PNG and BMP must retain every opaque pixel, row order and padding')
  }
  assert(!Object.keys(require.cache).some(file => /[\\/]sharp[\\/]lib[\\/]index\.js$/.test(file)), 'PNG/JPEG/BMP paths must not load Sharp')
  const topDown24 = Buffer.from(bmp), stride = Math.ceil(width * 3 / 4) * 4
  topDown24.writeInt32LE(-height, 22)
  for (let y = 0; y < height; y++) bmp.copy(topDown24, 54 + y * stride, 54 + (height - 1 - y) * stride, 54 + (height - y) * stride)
  assert((await decodeImageBytes(topDown24, nativeImage)).toBitmap().equals(pixels), 'Top-down padded 24-bit BMP must decode accurately')
  for (const mutate of [
    bytes => bytes.writeUInt32LE(20, 10),
    bytes => bytes.writeUInt32LE(0xffffffff, 10),
    bytes => bytes.writeUInt32LE(0xffffffff, 14),
    bytes => bytes.writeUInt32LE(12, 14),
    bytes => bytes.writeUInt32LE(bytes.length + 1, 2),
    bytes => bytes.writeUInt32LE(54, 2),
    bytes => bytes.writeInt32LE(-1, 18),
    bytes => bytes.writeInt32LE(32769, 18),
    bytes => bytes.writeInt32LE(0, 22),
    bytes => bytes.writeInt32LE(-2147483648, 22),
    bytes => { bytes.writeInt32LE(20000, 18); bytes.writeInt32LE(20000, 22) },
    bytes => bytes.writeUInt16LE(2, 26),
    bytes => bytes.writeUInt16LE(8, 28),
    bytes => bytes.writeUInt32LE(1, 30),
    bytes => bytes.writeUInt32LE(3, 30),
  ]) {
    const invalid = Buffer.from(bmp); mutate(invalid)
    await assert.rejects(decodeImageBytes(invalid, nativeImage))
  }
  await assert.rejects(decodeImageBytes(bmp.subarray(0, bmp.length - 1), nativeImage))
  await assert.rejects(decodeImageBytes(Buffer.from('GIF89a'), nativeImage))
  await assert.rejects(decodeImageBytes(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), nativeImage))
  const largePng = Buffer.from(png); largePng.writeUInt32BE(32769, 16)
  await assert.rejects(decodeImageBytes(largePng, nativeImage), /尺寸/)
  const sharp = require('sharp')
  const webp = await sharp(png).webp({ lossless: true }).toBuffer()
  assert((await decodeImageBytes(webp, nativeImage)).toBitmap().equals(pixels), 'Lossless WebP must decode through real Sharp')
  const invalidWebp = Buffer.from(webp); invalidWebp.fill(0, 12)
  await assert.rejects(decodeImageBytes(invalidWebp, nativeImage), /WebP/)

  const fixtures = []
  for (const [extension, bytes] of [['png', png], ['jpg', jpeg], ['jpeg', jpeg], ['webp', webp], ['bmp', bmp]]) {
    const file = path.join(artifacts, `右键 图片 & 测试.${extension}`)
    await fs.writeFile(file, bytes)
    assert.deepEqual((await readImageFile(file, nativeImage)).getSize(), { width, height })
    fixtures.push(file)
  }
  const { PDFDocument } = require('pdf-lib')
  const document = await PDFDocument.create()
  document.addPage([300, 200]).drawImage(await document.embedPng(png), { x: 0, y: 0, width: 300, height: 200 })
  const documentPath = path.join(artifacts, '右键 图片 & 测试.pdf')
  const pdfBytes = Buffer.from(await document.save())
  await fs.writeFile(documentPath, pdfBytes)
  const preview = await readPreviewFile(documentPath, nativeImage)
  assert.equal(preview.pdf.name, path.basename(documentPath))
  assert(Buffer.from(preview.pdf.bytes).equals(pdfBytes))
  await assert.rejects(readImageFile(documentPath, nativeImage), /仅支持/)
  fixtures.push(documentPath)
  await assert.rejects(readImageFile(path.join(artifacts, 'does-not-exist.png'), nativeImage), /不存在/)
  const directory = path.join(artifacts, 'not-a-file.png')
  await fs.mkdir(directory, { recursive: true })
  await assert.rejects(readImageFile(directory, nativeImage), /不是图片文件|访问权限/)
  const oversize = path.join(artifacts, 'oversize-image.png')
  const handle = await fs.open(oversize, 'w')
  try { await handle.truncate(MAX_BYTES + 1) } finally { await handle.close() }
  try { await assert.rejects(readImageFile(oversize, nativeImage), /96 MB/) }
  finally { await fs.unlink(oversize) }
  const report = { exactFlagOnly: true, fullyQualifiedPaths: true, chineseAndShellCharacters: true, formats: OPEN_EXTENSIONS, bmpPaddedRowsAndTopDown: true, bmp32ReservedAlphaOpaque: true, invalidBmpRejected: true, oversizedHeaderAndFileRejected: true, sharpLoadedOnlyForWebp: true, pdfInputBytesPreserved: true, explorerRegistryStaticChecks: true, installerExecuted: false, fixtures }
  await fs.writeFile(path.join(artifacts, 'windows-image-decoder-regression.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}

async function integrationTests(executable, env) {
  const { _electron: electron, expect } = require('@playwright/test')
  const mode = executable ? 'packaged' : 'source'
  const executablePath = executable || require('electron')
  const baseArgs = executable ? [] : ['.']
  const profileDirectory = path.join(artifacts, `windows-integration-${mode}-profile`)
  await fs.mkdir(profileDirectory, { recursive: true })
  await fs.writeFile(path.join(profileDirectory, 'settings.json'), JSON.stringify({ version: 1, settings: { startupNotification: false } }))
  const profile = `--user-data-dir=${profileDirectory}`
  const fixture = extension => path.join(artifacts, `右键 图片 & 测试.${extension}`)
  const app = await electron.launch({ executablePath, args: [...baseArgs, profile, '--edit-image', fixture('png')], cwd: project, env, timeout: 30000 })
  const errors = []
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
  const previews = () => app.windows().filter(page => page.url().includes('view=preview'))
  const report = { mode, opened: [], noSettingsWindow: false, previousPreviewPreserved: false, pdfFirstLaunchEditing: false, pdfSecondInstanceEditing: false, normalStartupStaysInTray: false, pageErrors: errors }
  try {
    await expect.poll(() => previews().length, { timeout: 20000 }).toBe(1)
    const first = previews()[0]
    await expect(first.locator('.editor-toolbar')).toBeVisible()
    await expect(first.getByTestId('editor-canvas')).toBeVisible()
    const original = await first.evaluate(() => window.fanhua.getPreview())
    assert.equal(original.initialEditing, true)
    assert.equal(original.width, 13); assert.equal(original.height, 7)
    report.opened.push('png')
    await app.evaluate(({ app, dialog }) => {
      app.__imageOpenRegression = { launches: [], messages: [] }
      app.on('second-instance', (_event, argv) => { app.__imageOpenRegression.launches.push(argv) })
      dialog.showMessageBox = async (...args) => { app.__imageOpenRegression.messages.push(args.at(-1)); return { response: 0 } }
    })
    await first.getByRole('button', { name: '文字工具', exact: true }).click()
    const canvas = await first.getByTestId('editor-canvas').boundingBox()
    await first.mouse.click(canvas.x + canvas.width / 3, canvas.y + canvas.height / 3)
    await first.getByRole('textbox', { name: '标注文字内容' }).fill('保留第一张图片的编辑')
    for (const extension of ['jpg', 'jpeg', 'webp', 'bmp', 'pdf']) {
      const before = new Set(previews())
      await spawnAndWait(executablePath, [...baseArgs, profile, '--edit-image', fixture(extension)], env)
      await expect.poll(() => previews().length, { timeout: 15000 }).toBe(before.size + 1)
      const next = previews().find(page => !before.has(page))
      await expect(next.locator('.editor-toolbar')).toBeVisible()
      await expect(next.getByTestId('editor-canvas')).toBeVisible()
      const context = await next.evaluate(async () => {
        const context = await window.fanhua.getPreview()
        return { ...context, pdf: context.pdf ? { name: context.pdf.name, bytesLength: context.pdf.bytes.byteLength } : undefined }
      })
      assert.equal(context.initialEditing, true)
      if (extension === 'pdf') {
        assert.equal(context.width, 0); assert.equal(context.height, 0); assert.equal(context.dataUrl, '')
        assert.equal(context.pdf.name, path.basename(fixture('pdf')))
        assert(context.pdf.bytesLength > 0)
        await expect(next.getByTestId('pdf-page-bar')).toBeVisible()
        await expect(next.getByTestId('pdf-page-count')).toHaveText('/ 1')
        assert(await next.getByTestId('editor-canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0))
        report.pdfSecondInstanceEditing = true
      } else { assert.equal(context.width, 13); assert.equal(context.height, 7) }
      assert.notEqual(context.id, original.id)
      report.opened.push(extension)
    }
    assert.equal(app.windows().filter(page => page.url().includes('view=settings')).length, 0, 'Image startup must not open the settings window')
    report.noSettingsWindow = true
    const launchState = await app.evaluate(({ app }) => app.__imageOpenRegression)
    assert.equal(launchState.launches.length, 5, 'All subsequent image/PDF opens must forward to the original process')
    assert.deepEqual(launchState.messages, [], 'Valid forwarded image paths must not produce native error dialogs')
    assert.deepEqual(await first.evaluate(() => window.fanhua.getPreview()), original)
    await expect(first.getByRole('textbox', { name: '标注文字内容' })).toHaveValue('保留第一张图片的编辑')
    report.previousPreviewPreserved = true
    await first.screenshot({ path: path.join(artifacts, `windows-edit-entry-${mode}.png`) })
    assert.deepEqual(errors, [])
  } finally { await app.close().catch(() => {}) }

  const pdfApp = await electron.launch({ executablePath, args: [...baseArgs, profile, '--edit-image', fixture('pdf')], cwd: project, env, timeout: 30000 })
  pdfApp.on('window', page => page.on('pageerror', error => errors.push(error.message)))
  try {
    await expect.poll(() => pdfApp.windows().filter(page => page.url().includes('view=preview')).length, { timeout: 20000 }).toBe(1)
    const page = pdfApp.windows().find(page => page.url().includes('view=preview'))
    await expect(page.locator('.editor-toolbar')).toBeVisible()
    await expect(page.getByTestId('editor-canvas')).toBeVisible()
    await expect(page.getByTestId('pdf-page-bar')).toBeVisible()
    await expect(page.getByTestId('pdf-page-count')).toHaveText('/ 1')
    const context = await page.evaluate(async () => {
      const context = await window.fanhua.getPreview()
      return { initialEditing: context.initialEditing, name: context.pdf?.name, byteLength: context.pdf?.bytes.byteLength }
    })
    assert.equal(context.initialEditing, true)
    assert.equal(context.name, path.basename(fixture('pdf')))
    assert(context.byteLength > 0)
    assert.equal(pdfApp.windows().filter(page => page.url().includes('view=settings')).length, 0)
    await page.screenshot({ path: path.join(artifacts, `windows-pdf-entry-${mode}.png`) })
    report.pdfFirstLaunchEditing = true
    assert.deepEqual(errors, [])
  } finally { await pdfApp.close().catch(() => {}) }

  const normal = await electron.launch({ executablePath, args: [...baseArgs, profile], cwd: project, env, timeout: 30000 })
  try {
    await expect.poll(() => normal.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().includes('view=capture')).length), { timeout: 20000 }).toBeGreaterThan(0)
    const visible = await normal.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.isVisible()).map(win => win.webContents.getURL()))
    assert.deepEqual(visible, [], 'Ordinary startup must remain in the tray')
    report.normalStartupStaysInTray = true
  } finally { await normal.close().catch(() => {}) }
  await fs.writeFile(path.join(artifacts, `windows-integration-${mode}.json`), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}

if (process.versions.electron) {
  const { app, nativeImage } = require('electron')
  app.setPath('userData', path.join(artifacts, 'windows-decoder-profile'))
  app.whenReady().then(() => decoderTests(nativeImage)).then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
} else if (process.argv.includes('--installer-only')) {
  checkInstaller().then(() => console.log('NSIS 默认不注入右键菜单；旧注册清理、主动启用标记保留、命令归属检查通过。未执行安装程序。'))
    .catch(error => { console.error(error); process.exitCode = 1 })
} else {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const executable = process.argv.find((argument, index) => index > 1 && !argument.startsWith('--')) || process.env.FANHUA_PACKAGED_EXE
  spawnAndWait(require('electron'), [__filename], env).then(stdout => {
    console.log(stdout.trim())
    if (!process.argv.includes('--unit')) return integrationTests(executable, env)
  }).catch(error => { console.error(error); process.exitCode = 1 })
}
