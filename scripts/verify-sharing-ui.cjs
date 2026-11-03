'use strict'

// Real Electron clipboard integration; LocalSend handoff is intercepted so the
// UI regression never sends a fixture to another device or opens a real app.
const { _electron: electron, expect } = require('@playwright/test')
const electronPath = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function findWindow(app, view) {
  await expect.poll(() => app.windows().some(page => page.url().includes(`view=${view}`)), { timeout: 20000 }).toBe(true)
  return app.windows().find(page => page.url().includes(`view=${view}`))
}

async function run() {
  await fs.mkdir('artifacts', { recursive: true })
  const packaged = process.argv[2] || process.env.FANHUA_PACKAGED_EXE
  const mode = packaged ? 'packaged' : 'source'
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const app = await electron.launch({
    executablePath: packaged || electronPath,
    args: [...(packaged ? [] : ['.']), `--user-data-dir=${path.resolve('artifacts/sharing-regression-profile')}`, '--show-window'],
    env, timeout: 30000,
  })
  const errors = []
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
  try {
    const settings = await findWindow(app, 'dashboard')
    const denied = await settings.evaluate(async () => {
      const result = []
      for (const operation of [() => window.fanhua.copyImage('data:image/png;base64,AA=='), () => window.fanhua.shareViaLocalSend('data:image/png;base64,AA==')]) {
        try { await operation(); result.push(false) } catch (error) { result.push(/不允许/.test(String(error))) }
      }
      return result
    })
    assert.deepEqual(denied, [true, true], 'Only a preview may copy or share images')

    const source = await settings.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 700
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 700)
      ctx.fillStyle = '#111'; ctx.font = '52px Arial'; ctx.fillText('SHARING TEST', 60, 110)
      const gradient = ctx.createLinearGradient(700, 120, 1120, 500)
      gradient.addColorStop(0, '#4e55e8'); gradient.addColorStop(.45, '#e966b7'); gradient.addColorStop(1, '#36a98f')
      ctx.fillStyle = gradient; ctx.fillRect(700, 120, 420, 380)
      ctx.clearRect(1120, 620, 80, 80)
      return canvas.toDataURL()
    })
    const sourcePath = path.resolve('artifacts/sharing-source.png')
    await fs.writeFile(sourcePath, Buffer.from(source.split(',')[1], 'base64'))
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, sourcePath)
    await settings.evaluate(() => window.fanhua.openImage())
    const preview = await findWindow(app, 'preview')
    preview.setDefaultTimeout(20000)
    await expect(preview.getByTestId('editor-canvas')).toBeVisible()

    await app.evaluate(({ ipcMain }) => {
      const handlers = Reflect.get(ipcMain, '_invokeHandlers')
      const original = handlers.get('image:copy')
      if (!original || !handlers.get('localsend:share')) throw Error('Sharing IPC handlers missing')
      ipcMain.__sharingTest = { copies: [], shares: [], action: 'success', release: null, copyFailure: false }
      handlers.set('image:copy', async (event, data, mode) => {
        ipcMain.__sharingTest.copies.push({ data, mode })
        if (ipcMain.__sharingTest.copyFailure) throw Error('测试：剪贴板暂时不可用')
        return original(event, data, mode)
      })
      handlers.set('localsend:share', async (_event, data) => {
        const state = ipcMain.__sharingTest
        state.shares.push(data)
        if (state.action === 'fail') throw Error('测试：LocalSend 无法启动')
        if (state.action === 'cancel') return { canceled: true }
        if (state.action === 'hold') await new Promise(resolve => { state.release = resolve })
        return { canceled: false, fileName: '繁花有图-测试.png' }
      })
    })
    const copyCount = () => app.evaluate(({ ipcMain }) => ipcMain.__sharingTest.copies.length)
    const lastCopy = () => app.evaluate(({ ipcMain }) => ipcMain.__sharingTest.copies.at(-1))

    await preview.getByRole('button', { name: '进入编辑模式', exact: true }).click()
    await preview.getByRole('button', { name: '文字工具', exact: true }).click()
    let box = await preview.getByTestId('editor-canvas').boundingBox()
    await preview.mouse.click(box.x + box.width * .1, box.y + box.height * .35)
    await preview.getByRole('textbox', { name: '标注文字内容' }).fill('编辑后的文字')
    await preview.getByRole('spinbutton', { name: '标注字号' }).fill('40')
    await preview.getByRole('spinbutton', { name: '标注字号' }).press('Tab')
    await preview.getByRole('button', { name: '箭头工具', exact: true }).click()
    box = await preview.getByTestId('editor-canvas').boundingBox()
    await preview.mouse.move(box.x + box.width * .12, box.y + box.height * .6)
    await preview.mouse.down(); await preview.mouse.move(box.x + box.width * .45, box.y + box.height * .7, { steps: 8 }); await preview.mouse.up()
    await preview.getByRole('button', { name: '水印设置', exact: true }).click()
    await preview.getByRole('switch', { name: '启用水印' }).click()
    await preview.getByRole('textbox', { name: '水印文字内容' }).fill('共享水印')
    await preview.getByRole('button', { name: '水印位置 左下', exact: true }).click()
    await preview.getByRole('button', { name: '完成水印设置', exact: true }).click()

    await preview.getByRole('button', { name: '复制图片', exact: true }).click()
    await expect(preview.getByText('已复制图片', { exact: true })).toBeVisible()
    const png = await lastCopy()
    assert.equal(png.mode, 'png')
    assert(png.data.startsWith('data:image/png;base64,'))
    const pixels = await app.evaluate(async ({ clipboard, nativeImage }, input) => {
      const original = nativeImage.createFromDataURL(input.original)
      const copied = nativeImage.createFromDataURL(input.png)
      const items = await clipboard.read()
      const item = items.find(entry => entry.types.includes('image/png'))
      if (!item) throw Error('PNG clipboard image missing')
      const actual = nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer()))
      const image = copied.toBitmap(), source = original.toBitmap()
      const changed = (left, top, right, bottom) => {
        let count = 0
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
          const offset = (y * 1200 + x) * 4
          if (!image.subarray(offset, offset + 4).equals(source.subarray(offset, offset + 4))) count++
        }
        return count
      }
      return { clipboardMatches: actual.toBitmap().equals(image), text: changed(100, 220, 650, 310), arrow: changed(100, 380, 600, 520), watermark: changed(0, 600, 600, 700), transparencyPreserved: image[(699 * 1200 + 1199) * 4 + 3] === 0 }
    }, { original: source, png: png.data })
    assert.equal(pixels.clipboardMatches, true)
    assert.equal(pixels.transparencyPreserved, true)
    assert(pixels.text > 100 && pixels.arrow > 100 && pixels.watermark > 100, 'PNG must include edits and watermark')

    await preview.getByRole('button', { name: '识别文字', exact: true }).click()
    await expect.poll(() => preview.getByTestId('ocr-region').count(), { timeout: 120000 }).toBeGreaterThan(0)
    await preview.getByRole('button', { name: '复制图片', exact: true }).click()
    await expect.poll(copyCount).toBe(2)
    assert.equal((await lastCopy()).data, png.data, 'Virtual OCR overlays must not enter export')

    await preview.getByRole('button', { name: '选择复制方式', exact: true }).click()
    await preview.getByTestId('deskflow-copy-option').hover()
    await expect(preview.getByRole('tooltip')).toContainText('由于DeskFlow传输有限制，会造成质量压缩。')
    await preview.screenshot({ path: `artifacts/sharing-tooltip-${mode}.png`, animations: 'disabled' })
    await preview.getByRole('menuitem', { name: '复制到 DeskFlow 剪贴板', exact: true }).click()
    await expect(preview.getByText('已复制 DeskFlow 图片（JPG 60%）', { exact: true })).toBeVisible()
    const jpeg = await lastCopy()
    assert.equal(jpeg.mode, 'deskflow')
    assert(jpeg.data.startsWith('data:image/jpeg;base64,'))
    assert.equal(Buffer.from(jpeg.data.split(',')[1], 'base64').readUInt16BE(0), 0xffd8)
    const expectedJpeg = await preview.evaluate(async data => {
      const image = new Image(); image.src = data; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', .6)
    }, png.data)
    assert.equal(jpeg.data, expectedJpeg, 'DeskFlow image must be a single JPEG encode at quality 0.6 with white backing')

    // Ctrl+C always means normal PNG, regardless of the preceding menu choice.
    await preview.getByTestId('editor-canvas').focus()
    await preview.keyboard.press('Control+c')
    await expect.poll(copyCount).toBe(4)
    assert.equal((await lastCopy()).mode, 'png')
    assert.equal((await lastCopy()).data, png.data)
    await preview.getByRole('button', { name: '选择复制方式', exact: true }).click()
    await preview.getByRole('menuitem', { name: '复制到剪贴板', exact: true }).click()
    await expect.poll(copyCount).toBe(5)

    await preview.getByRole('button', { name: '通过 LocalSend 共享', exact: true }).click()
    await expect(preview.getByText('已交给 LocalSend，请选择接收设备', { exact: true })).toBeVisible()
    const shared = await app.evaluate(({ ipcMain }) => ipcMain.__sharingTest.shares.at(-1))
    assert.equal(shared, png.data, 'LocalSend must receive the edited PNG without virtual OCR overlays')
    await fs.writeFile(`artifacts/sharing-localsend-${mode}.png`, Buffer.from(shared.split(',')[1], 'base64'))
    await expect(preview.getByText('已交给 LocalSend，请选择接收设备', { exact: true })).toHaveCount(0, { timeout: 10000 })
    await app.evaluate(({ ipcMain }) => { ipcMain.__sharingTest.action = 'cancel' })
    await preview.getByRole('button', { name: '通过 LocalSend 共享', exact: true }).click()
    await expect(preview.getByRole('button', { name: '通过 LocalSend 共享', exact: true })).toBeEnabled()
    await expect(preview.getByText('已交给 LocalSend，请选择接收设备', { exact: true })).toHaveCount(0)
    await app.evaluate(({ ipcMain }) => { ipcMain.__sharingTest.action = 'fail' })
    await preview.getByRole('button', { name: '通过 LocalSend 共享', exact: true }).click()
    await expect(preview.getByText('测试：LocalSend 无法启动', { exact: true })).toBeVisible()
    await app.evaluate(({ ipcMain }) => { ipcMain.__sharingTest.action = 'hold' })
    await preview.getByRole('button', { name: '通过 LocalSend 共享', exact: true }).click()
    await expect(preview.getByRole('button', { name: '通过 LocalSend 共享', exact: true })).toBeDisabled()
    await expect(preview.getByRole('button', { name: '复制图片', exact: true })).toBeDisabled()
    const before = await copyCount()
    await preview.getByTestId('editor-canvas').focus(); await preview.keyboard.press('Control+c')
    assert.equal(await copyCount(), before, 'Repeated keyboard actions must be ignored while sharing')
    await app.evaluate(({ ipcMain }) => { ipcMain.__sharingTest.release() })
    await expect(preview.getByRole('button', { name: '复制图片', exact: true })).toBeEnabled()
    await app.evaluate(({ ipcMain }) => { ipcMain.__sharingTest.copyFailure = true })
    await preview.getByRole('button', { name: '复制图片', exact: true }).click()
    await expect(preview.getByText('测试：剪贴板暂时不可用', { exact: true })).toBeVisible()
    await expect(preview.getByRole('button', { name: '复制图片', exact: true })).toBeEnabled()
    await app.evaluate(({ ipcMain }) => { ipcMain.__sharingTest.copyFailure = false })
    await preview.getByRole('button', { name: '复制图片', exact: true }).click()
    await expect.poll(copyCount).toBe(7)
    await expect(preview.getByRole('button', { name: '复制图片', exact: true })).toBeEnabled()

    await preview.getByRole('button', { name: '关闭文字识别', exact: true }).click()
    await preview.getByRole('button', { name: '进入编辑模式', exact: true }).click()
    await expect(preview.locator('.ant-message-notice')).toHaveCount(0, { timeout: 10000 })
    const compactLayouts = []
    for (const width of [420, 360]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=preview'))
        win.setMinimumSize(360, 240); win.setBounds({ width, height: 300 })
      }, width)
      await expect.poll(() => preview.evaluate(() => innerWidth)).toBe(width)
      const layout = await preview.evaluate(() => {
        const bar = document.querySelector('.preview-topbar').getBoundingClientRect()
        const buttons = ['复制图片', '选择复制方式', '通过 LocalSend 共享', '保存图片'].map(label => {
          const node = document.querySelector(`[aria-label="${label}"]`), bounds = node.getBoundingClientRect()
          return { label, x: bounds.left, right: bounds.right, width: bounds.width }
        })
        return { viewport: innerWidth, barRight: bar.right, buttons }
      })
      assert(layout.buttons.every(button => button.x >= 0 && button.right <= layout.viewport && button.width >= 14), 'Compact window sharing actions must remain visible')
      compactLayouts.push(layout)
      await preview.screenshot({ path: `artifacts/sharing-compact-${width}-${mode}.png`, animations: 'disabled' })
    }
    await preview.getByRole('button', { name: '选择复制方式', exact: true }).click()
    await expect(preview.getByRole('menuitem', { name: '复制到 DeskFlow 剪贴板', exact: true })).toBeVisible()
    const menu = await preview.getByRole('menu').boundingBox()
    assert(menu.x >= 0 && menu.x + menu.width <= 360, 'Copy menu must fit the smallest preview width')
    await preview.getByTestId('deskflow-copy-option').hover()
    await expect(preview.getByRole('tooltip')).toContainText('由于DeskFlow传输有限制，会造成质量压缩。')
    await preview.screenshot({ path: `artifacts/sharing-compact-menu-${mode}.png`, animations: 'disabled' })
    assert.deepEqual(errors, [])
    const report = { mode, realPngClipboard: true, editedPixels: pixels, jpegQuality60Exact: true, jpegBytes: Buffer.from(jpeg.data.split(',')[1], 'base64').length, pngBytes: Buffer.from(png.data.split(',')[1], 'base64').length, localSendHandoffPngMatches: true, localSendTransportStubbed: true, tooltipVerified: true, ctrlCRemainsPng: true, cancellationAndFailureHandled: true, clipboardFailureRecovery: true, repeatedActionsBlocked: true, compactLayouts, nonPreviewRejected: true, pageErrors: errors }
    await fs.writeFile(`artifacts/sharing-regression-${mode}.json`, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    const preview = app.windows().find(page => page.url().includes('view=preview'))
    if (preview) {
      await preview.screenshot({ path: `artifacts/sharing-failure-${mode}.png` }).catch(() => {})
      await fs.writeFile(`artifacts/sharing-failure-${mode}.txt`, await preview.locator('body').innerText().catch(() => String(error)))
    }
    throw error
  } finally { await app.close().catch(() => {}) }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
