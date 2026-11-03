import { test, expect, _electron as electron, chromium } from '@playwright/test'
import electronPath from 'electron'
import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'

function launchOptions(showWindow = true) {
  const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const packaged = process.env.FANHUA_PACKAGED_EXE
  return { executablePath: packaged || electronPath as unknown as string, args: [...(packaged ? [] : ['.']), ...(showWindow ? ['--show-window'] : [])], env, timeout: 30000 }
}

test('默认启动只驻留后台，可再次打开紧凑设置窗口', async () => {
  const app = await electron.launch(launchOptions(false))
  try {
    await app.evaluate(({ app }) => app.whenReady())
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
    const nextWindow = app.waitForEvent('window')
    await app.evaluate(({ app }) => app.emit('second-instance', {}, [], process.cwd()))
    const settings = await nextWindow
    await expect(settings.getByRole('heading', { name: '繁花有图', exact: true })).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize())).toEqual([560, 460])
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
    const dashboard = await app.firstWindow()
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
    const capturePromise = app.waitForEvent('window', { predicate: page => page.url().includes('view=capture') || page.url() === 'about:blank' })
    await dashboard.evaluate(() => window.fanhua!.startCapture())
    const capture = await capturePromise
    await expect(capture.getByTestId('capture-stage')).toBeVisible()
    const context = await capture.evaluate(() => window.fanhua!.getCaptureContext())
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
    await expect(preview.getByText('已保存到本地', { exact: true })).toBeVisible()
    expect((await readFile(exportPath)).subarray(1, 4).toString()).toBe('PNG')
    await preview.getByRole('button', { name: '固定窗口' }).click()
    await expect(preview.getByRole('button', { name: '固定窗口' })).toHaveAttribute('aria-pressed', 'false')
    await preview.getByRole('button', { name: '关闭窗口不保存' }).click()
    await expect.poll(() => app.windows().filter(page => page.url().includes('view=preview')).length).toBe(0)
    // Reverse drag creates a region whose exact native-pixel size is predictable.
    const nextCapturePromise = app.waitForEvent('window')
    await dashboard.evaluate(() => window.fanhua!.startCapture())
    const nextCapture = await nextCapturePromise
    await expect(nextCapture.getByTestId('capture-stage')).toBeVisible()
    const nextContext = await nextCapture.evaluate(() => window.fanhua!.getCaptureContext())
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
    const cancelPromise = app.waitForEvent('window')
    await dashboard.evaluate(() => window.fanhua!.startCapture())
    const cancelWindow = await cancelPromise
    await expect(cancelWindow.getByTestId('capture-stage')).toBeVisible()
    // Escape destroys its target window before CDP can acknowledge key-up.
    await cancelWindow.keyboard.press('Escape').catch(error => { if (!cancelWindow.isClosed()) throw error })
    await expect.poll(() => app.windows().filter(page => page.url().includes('view=capture')).length).toBe(0)
    await dashboard.getByRole('button', { name: '隐藏到系统托盘' }).click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(win => !win.isVisible()))).toBe(true)
    expect(await dashboard.evaluate(() => window.fanhua!.getAppState())).toMatchObject({ version: '1.0.0' })
    expect(errors).toEqual([])
  } finally {
    await fixtureBrowser?.close()
    await app.close()
  }
})
