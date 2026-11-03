import { test, expect, _electron as electron, chromium, type ElectronApplication } from '@playwright/test'
import electronPath from 'electron'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { ImageFormat } from '../../src/shared'

function launchOptions(showWindow = true) {
  const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const packaged = process.env.FANHUA_PACKAGED_EXE
  return { executablePath: packaged || electronPath as unknown as string, args: [...(packaged ? [] : ['.']), ...(showWindow ? ['--show-window'] : [])], env, timeout: 30000 }
}

async function findWindow(app: ElectronApplication, view: string) {
  await expect.poll(() => app.windows().some(page => page.url().includes(`view=${view}`))).toBe(true)
  return app.windows().find(page => page.url().includes(`view=${view}`))!
}

test('默认启动只驻留后台，可再次打开紧凑设置窗口', async () => {
  const app = await electron.launch(launchOptions(false))
  try {
    await app.evaluate(({ app }) => app.whenReady())
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.isVisible()).length)).toBe(0)
    const overlay = await findWindow(app, 'capture')
    await expect.poll(() => overlay.evaluate(() => window.fanhua?.getCaptureContext())).toBeNull()
    await app.evaluate(({ app }) => app.emit('second-instance', {}, [], process.cwd()))
    const settings = await findWindow(app, 'dashboard')
    await expect(settings.getByRole('heading', { name: '繁花有图', exact: true })).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=dashboard'))!.getSize())).toEqual([560, 460])
    const fonts = await settings.evaluate(() => window.fanhua!.getFonts())
    expect(fonts.length).toBeGreaterThan(10)
    if (process.env.FANHUA_PACKAGED_EXE) expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  } finally { await app.close() }
})

test('真实桌面：原生窗口识别、框选、预览固定、导出、取消和后台常驻', async () => {
  test.setTimeout(120000)
  const app = await electron.launch(launchOptions())
  const errors: string[] = []
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
  let fixtureBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const dashboard = await findWindow(app, 'dashboard')
    await expect(dashboard.getByRole('button', { name: /开始截图/ })).toBeVisible()
    const state = await dashboard.evaluate(() => window.fanhua!.getAppState())
    expect(state.platform).toBe('win32')
    expect(typeof state.shortcutRegistered).toBe('boolean')
    await mkdir('artifacts', { recursive: true })
    await dashboard.screenshot({ path: 'artifacts/electron-dashboard.png' })
    fixtureBrowser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1024,768', '--window-position=30,30'] })
    const fixture = await fixtureBrowser.newPage()
    await fixture.setContent('<html lang="zh-CN"><head><title>Fanhua Capture Fixture</title></head><body style="margin:0;background:#eee8f8;font:36px sans-serif;color:#7860d2"><div style="padding:80px">繁花有图 · 截图测试窗口<br><span style="font-size:20px">原生窗口识别与原像素裁剪</span></div></body></html>')
    await fixture.bringToFront()
    await dashboard.evaluate(() => window.fanhua!.startCapture())
    const capture = await findWindow(app, 'capture')
    await expect(capture.getByTestId('capture-stage')).toBeVisible()
    const context = (await capture.evaluate(() => window.fanhua!.getCaptureContext()))!
    expect(context).toBeTruthy()
    expect(context.windowDetectionAvailable).toBe(true)
    const fixtureRegion = context.windows.find(region => region.title.includes('Fanhua Capture Fixture'))
    expect(fixtureRegion).toBeTruthy()
    expect(context.pixelWidth).toBeGreaterThan(0)
    const region = fixtureRegion!
    expect(await capture.locator('.screen-image').evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([context.pixelWidth, context.pixelHeight])
    await capture.mouse.move(region.x + region.width / 2, region.y + region.height / 2)
    await expect(capture.getByText(/Fanhua Capture Fixture/)).toBeVisible()
    const previewPromise = app.waitForEvent('window', { timeout: 10000 })
    await capture.mouse.click(region.x + region.width / 2, region.y + region.height / 2)
    const preview = await previewPromise
    await expect(preview.getByTestId('editor-canvas')).toBeVisible()
    const imageSize = await preview.getByTestId('editor-canvas').evaluate((el: HTMLCanvasElement) => [el.width, el.height])
    expect(imageSize[0]).toBe(Math.ceil((region.x + region.width) * context.pixelWidth / context.width) - Math.floor(region.x * context.pixelWidth / context.width))
    expect(imageSize[1]).toBeGreaterThan(300)
    // The fixture's center is a solid known color: reject blank/black captures.
    await expect.poll(() => preview.getByTestId('editor-canvas').evaluate((el: HTMLCanvasElement) => Array.from(el.getContext('2d')!.getImageData(Math.floor(el.width / 2), Math.floor(el.height / 2), 1, 1).data))).toEqual([238, 232, 248, 255])
    await preview.getByRole('button', { name: '固定窗口' }).click()
    await expect(preview.getByRole('button', { name: '固定窗口' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=preview'))?.isAlwaysOnTop())).toBe(true)
    await preview.getByRole('button', { name: '进入编辑模式' }).click()
    await preview.getByRole('button', { name: '文字工具' }).click()
    const bounds = (await preview.getByTestId('editor-canvas').boundingBox())!
    await preview.mouse.click(bounds.x + 90, bounds.y + 100)
    await preview.getByRole('textbox', { name: '标注文字内容' }).fill('中文保存验证')
    const exportPath = path.resolve('artifacts/native-export.png')
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, exportPath)
    await preview.getByRole('button', { name: '保存图片', exact: true }).click()
    await preview.getByRole('button', { name: '确认保存', exact: true }).click()
    await expect(preview.getByText('已保存到本地', { exact: true })).toBeVisible()
    expect((await readFile(exportPath)).subarray(1, 4).toString()).toBe('PNG')
    await preview.getByRole('button', { name: '固定窗口' }).click()
    await expect(preview.getByRole('button', { name: '固定窗口' })).toHaveAttribute('aria-pressed', 'false')
    await preview.getByRole('button', { name: '关闭窗口不保存' }).click()
    await expect.poll(() => app.windows().filter(page => page.url().includes('view=preview')).length).toBe(0)
    // Reverse drag creates a region whose exact native-pixel size is predictable.
    await dashboard.evaluate(() => window.fanhua!.startCapture())
    const nextCapture = await findWindow(app, 'capture')
    expect(nextCapture).toBe(capture)
    await expect(nextCapture.getByTestId('capture-stage')).toBeVisible()
    const nextContext = (await nextCapture.evaluate(() => window.fanhua!.getCaptureContext()))!
    expect(nextContext.sessionId).not.toBe(context.sessionId)
    await nextCapture.evaluate(id => window.fanhua!.cancelCapture(id), context.sessionId)
    const staleError = await nextCapture.evaluate(async id => {
      try { await window.fanhua!.completeCapture({ x: 0, y: 0, width: 100, height: 100 }, id); return '' }
      catch (error) { return String(error) }
    }, context.sessionId)
    expect(staleError).toContain('截图会话已结束')
    expect((await nextCapture.evaluate(() => window.fanhua!.getCaptureContext()))?.sessionId).toBe(nextContext.sessionId)
    const cropPromise = app.waitForEvent('window')
    await nextCapture.mouse.move(420, 340)
    await nextCapture.mouse.down()
    await nextCapture.mouse.move(120, 140, { steps: 12 })
    await nextCapture.mouse.up()
    const cropped = await cropPromise
    await expect(cropped.getByTestId('editor-canvas')).toBeVisible()
    expect(await cropped.getByTestId('editor-canvas').evaluate((el: HTMLCanvasElement) => [el.width, el.height])).toEqual([
      Math.ceil(420 * nextContext.pixelWidth / nextContext.width) - Math.floor(120 * nextContext.pixelWidth / nextContext.width),
      Math.ceil(340 * nextContext.pixelHeight / nextContext.height) - Math.floor(140 * nextContext.pixelHeight / nextContext.height),
    ])
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=preview'))!.getSize()[0])).toBe(420)
    await cropped.getByRole('button', { name: '进入编辑模式' }).click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=preview'))!.getSize()[0])).toBeGreaterThanOrEqual(760)
    await cropped.getByRole('button', { name: '关闭窗口不保存' }).click()
    await dashboard.evaluate(() => window.fanhua!.startCapture())
    const cancelWindow = await findWindow(app, 'capture')
    await expect(cancelWindow.getByTestId('capture-stage')).toBeVisible()
    await cancelWindow.keyboard.press('Escape')
    await expect.poll(() => cancelWindow.evaluate(() => window.fanhua!.getCaptureContext())).toBeNull()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().includes('view=capture')).every(win => !win.isVisible()))).toBe(true)
    // A stalled idle overlay must be discarded, so the next capture can recover.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=capture'))!.emit('unresponsive'))
    await expect.poll(() => cancelWindow.isClosed()).toBe(true)
    await dashboard.evaluate(() => window.fanhua!.startCapture())
    const recovered = await findWindow(app, 'capture')
    expect(recovered).not.toBe(cancelWindow)
    await expect(recovered.locator('.screen-image')).toBeVisible()
    await recovered.keyboard.press('Escape')
    await dashboard.getByRole('button', { name: '隐藏到系统托盘' }).click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(win => !win.isVisible()))).toBe(true)
    expect(await dashboard.evaluate(() => window.fanhua!.getAppState())).toMatchObject({ version: '1.1.0' })
    expect(errors).toEqual([])
  } finally {
    await fixtureBrowser?.close()
    await app.close()
  }
})

test('离线中英文识别、四种保存格式与水印存档', async () => {
  test.setTimeout(180000)
  const app = await electron.launch(launchOptions())
  let presetId: string | undefined
  try {
    const settings = await findWindow(app, 'dashboard')
    await expect(settings.getByRole('button', { name: /开始截图/ })).toBeVisible()
    const dataUrl = await settings.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 300
      const context = canvas.getContext('2d')!
      context.fillStyle = '#fff'; context.fillRect(0, 0, 1000, 300)
      context.fillStyle = '#111'; context.font = '48px "Microsoft YaHei"'
      context.fillText('繁花有图 文字识别', 60, 100)
      context.font = '48px Arial'; context.fillText('FANHUA 2026 HELLO WORLD', 60, 200)
      return canvas.toDataURL()
    })
    await mkdir('artifacts', { recursive: true })
    const sourcePath = path.resolve('artifacts/ocr-fixture.png')
    await writeFile(sourcePath, Buffer.from(dataUrl.split(',')[1]!, 'base64'))
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, sourcePath)
    const opened = app.waitForEvent('window')
    await settings.evaluate(() => window.fanhua!.openImage())
    const preview = await opened
    await expect(preview.getByTestId('editor-canvas')).toBeVisible()
    const fonts = await preview.evaluate(() => window.fanhua!.getFonts(true))
    expect(fonts.length).toBeGreaterThan(10)
    expect(fonts).toContain('Arial')
    const capabilities = await preview.evaluate(() => window.fanhua!.getOcrCapabilities())
    expect(capabilities.available).toBe(true)
    await preview.getByRole('button', { name: '识别文字', exact: true }).click()
    await expect(preview.getByRole('textbox', { name: '识别结果' })).toHaveValue(/FANHUA/, { timeout: 90000 })
    const recognized = await preview.getByRole('textbox', { name: '识别结果' }).inputValue()
    expect(recognized.replace(/\s/g, '')).toContain('繁花有图')
    expect(recognized).toContain('2026')
    await expect(preview.getByRole('button', { name: '翻译', exact: true })).toBeDisabled()
    await preview.getByRole('button', { name: '复制文字', exact: true }).click()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(recognized)
    await preview.screenshot({ path: 'artifacts/ocr-result.png' })
    await preview.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    // Force the bundled engine too: validates unpacked workers and language paths in the installation build.
    const offline = await app.evaluate(async ({ app }, png) => {
      const localRequire = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
      const { createOcrService } = localRequire(app.getAppPath() + '/electron/ocr.cjs')
      const service = createOcrService({ app, preferNative: false })
      try { return await service.recognize(Buffer.from(png.split(',')[1]!, 'base64'), 'auto') }
      finally { service.dispose() }
    }, dataUrl)
    expect(offline.text.replace(/\s/g, '')).toContain('文字识别')
    expect(offline.text).toContain('FANHUA')
    for (const format of ['png', 'jpeg', 'webp', 'bmp'] as ImageFormat[]) {
      const extension = format === 'jpeg' ? 'jpg' : format
      const savePath = path.resolve(`artifacts/native-format.${extension}`)
      await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, savePath)
      await preview.getByRole('button', { name: '保存图片', exact: true }).click()
      await preview.locator('.ant-select[aria-label="保存格式"]').click()
      await preview.locator('.ant-select-dropdown:visible').getByTitle(({ png: 'PNG · 无损图片', jpeg: 'JPEG · 照片图片', webp: 'WebP · 轻量图片', bmp: 'BMP · 位图图片' })[format], { exact: true }).click()
      await preview.getByRole('button', { name: '确认保存', exact: true }).click()
      await expect(preview.getByRole('dialog')).toHaveCount(0)
      const file = await readFile(savePath)
      if (format === 'png') expect(file.subarray(1, 4).toString()).toBe('PNG')
      if (format === 'jpeg') expect(Array.from(file.subarray(0, 3))).toEqual([255, 216, 255])
      if (format === 'webp') expect(file.subarray(8, 12).toString()).toBe('WEBP')
      if (format === 'bmp') expect(file.subarray(0, 2).toString()).toBe('BM')
    }
    const watermark = await preview.evaluate(() => window.fanhua!.chooseWatermarkImage())
    expect(watermark?.width).toBe(1000)
    const saved = await preview.evaluate(async image => window.fanhua!.saveWatermarkPreset({ name: '自动验证水印', config: {
      enabled: true, kind: 'image', text: '繁花有图', font: 'Arial', fontSize: 28, color: '#555555',
      imageDataUrl: image!.dataUrl, imageWidth: image!.width, imageHeight: image!.height, scale: .25,
      placement: 'bottom-right', opacity: .4, rotation: 0, margin: 20, spacing: 60,
    } }), watermark)
    presetId = saved.id
    expect((await preview.evaluate(() => window.fanhua!.listWatermarkPresets())).find(item => item.id === saved.id)?.config.imageDataUrl).toBe(watermark!.dataUrl)
    await preview.evaluate(id => window.fanhua!.deleteWatermarkPreset(id), saved.id)
    presetId = undefined
    expect((await preview.evaluate(() => window.fanhua!.listWatermarkPresets())).some(item => item.id === saved.id)).toBe(false)
  } finally {
    if (presetId) await app.windows().find(page => page.url().includes('view=preview'))?.evaluate(id => window.fanhua!.deleteWatermarkPreset(id), presetId)
    await app.close()
  }
})
