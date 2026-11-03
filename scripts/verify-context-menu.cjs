'use strict'

// Exercise the actual Electron renderer with native pointer/keyboard input.
// Only the file picker is replaced, so no interaction with another app is needed.
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
    args: [...(packaged ? [] : ['.']), `--user-data-dir=${path.resolve('artifacts/context-menu-regression-profile')}`, '--show-window'],
    env, timeout: 30000,
  })
  const errors = []
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
  try {
    const settings = await findWindow(app, 'dashboard')
    const source = await settings.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 700
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#f8f5fc'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#514368'; ctx.font = '42px Arial'; ctx.fillText('CONTEXT MENU TEST', 60, 95)
      ctx.fillStyle = '#e4ddf2'; ctx.fillRect(840, 420, 260, 180)
      return canvas.toDataURL()
    })
    const sourcePath = path.resolve('artifacts/context-menu-source.png')
    await fs.writeFile(sourcePath, Buffer.from(source.split(',')[1], 'base64'))
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, sourcePath)
    await settings.evaluate(() => window.fanhua.openImage())
    const preview = await findWindow(app, 'preview')
    preview.setDefaultTimeout(20000)
    const canvas = preview.getByTestId('editor-canvas')
    const menu = preview.getByRole('menu', { name: '图片右键菜单', exact: true })
    const item = name => menu.getByRole('menuitem', { name, exact: true })
    const layerButtons = preview.getByRole('button', { name: /^选择图层 / })
    const textInput = preview.getByRole('textbox', { name: '标注文字内容', exact: true })
    const rightClick = async (x = 1050, y = 560) => {
      const box = await canvas.boundingBox()
      assert(box && box.width > 0 && box.height > 0, 'The image must have visible bounds')
      await preview.mouse.click(box.x + box.width * x / 1200, box.y + box.height * y / 700, { button: 'right' })
      await expect(menu).toBeVisible()
    }
    const dismiss = async () => {
      await preview.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(canvas).toBeFocused()
    }
    const choose = async name => {
      await item(name).click()
      await expect(menu).toBeHidden()
    }

    await expect(canvas).toBeVisible()
    await expect(preview.getByRole('button', { name: '选择工具', exact: true })).toHaveCount(0)
    await rightClick()
    await expect(item('编辑图片')).toBeFocused()
    await expect(item('撤销')).toHaveCount(0)
    await dismiss()
    await rightClick()
    await choose('编辑图片')
    await expect(preview.getByRole('button', { name: '选择工具', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(layerButtons).toHaveCount(0)
    await expect(preview.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
    await expect(preview.getByRole('button', { name: '重做', exact: true })).toBeDisabled()

    // Context-click must never act like a drawing click, even for one-click text
    // and sequence tools. Esc must dismiss only the menu, leaving editing active.
    const drawingTools = ['文字', '序号', '箭头', '方框', '圆形', '马赛克']
    for (const tool of drawingTools) {
      await preview.getByRole('button', { name: `${tool}工具`, exact: true }).click()
      await rightClick()
      await expect(layerButtons).toHaveCount(0)
      await expect(item('撤销')).toBeDisabled()
      await expect(item('重做')).toBeDisabled()
      await expect(menu.getByRole('menuitem', { name: /^删除选中标注/ })).toBeDisabled()
      await dismiss()
      await expect(preview.getByRole('button', { name: `${tool}工具`, exact: true })).toHaveAttribute('aria-pressed', 'true')
    }

    await preview.getByRole('button', { name: '文字工具', exact: true }).click()
    let box = await canvas.boundingBox()
    await preview.mouse.click(box.x + box.width * 160 / 1200, box.y + box.height * 230 / 700)
    await textInput.fill('右键标注')
    await expect(layerButtons).toHaveCount(1)
    await expect(preview.getByRole('button', { name: '选择图层 右键标注', exact: true })).toHaveClass(/selected/)

    // Right-clicking blank pixels clears the hit target; Delete must not remove
    // whichever annotation happened to be selected before opening this menu.
    await rightClick()
    await expect(item('编辑图片')).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^删除选中标注/ })).toBeDisabled()
    await expect(preview.getByRole('button', { name: '选择图层 右键标注', exact: true })).not.toHaveClass(/selected/)
    await dismiss()
    await preview.keyboard.press('Delete')
    await expect(layerButtons).toHaveCount(1)

    // The annotation is hit in image coordinates, including after editing
    // changes the window size/fit scale.
    await rightClick(172, 242)
    await expect(item('编辑选中标注')).toBeFocused()
    await choose('编辑选中标注')
    await expect(textInput).toBeFocused()
    await textInput.fill('右键修改成功')
    await expect(preview.getByRole('button', { name: '选择图层 右键修改成功', exact: true })).toHaveClass(/selected/)

    await rightClick(172, 242)
    await choose('完成编辑')
    await expect(preview.getByRole('button', { name: '选择工具', exact: true })).toHaveCount(0)
    await rightClick(172, 242)
    await choose('编辑选中标注')
    await expect(textInput).toBeFocused()
    await expect(textInput).toHaveValue('右键修改成功')
    await expect(layerButtons).toHaveCount(1)

    await rightClick(172, 242)
    await menu.getByRole('menuitem', { name: /^删除选中标注/ }).click()
    await expect(menu).toBeHidden()
    await expect(layerButtons).toHaveCount(0)
    await expect(canvas).toBeFocused()
    await rightClick()
    await expect(item('撤销')).toBeEnabled()
    await expect(item('重做')).toBeDisabled()
    await choose('撤销')
    await expect(preview.getByRole('button', { name: '选择图层 右键修改成功', exact: true })).toBeVisible()
    await rightClick()
    await expect(item('重做')).toBeEnabled()
    await choose('重做')
    await expect(layerButtons).toHaveCount(0)
    await rightClick()
    await choose('撤销')
    await expect(layerButtons).toHaveCount(1)

    // Keyboard navigation stays within enabled menu actions, then Esc returns
    // focus to the image without toggling out of edit mode.
    await rightClick()
    await expect(item('编辑图片')).toBeFocused()
    await preview.keyboard.press('ArrowDown')
    await expect(item('完成编辑')).toBeFocused()
    await preview.keyboard.press('End')
    await expect(item('重做')).toBeFocused()
    await preview.keyboard.press('Home')
    await expect(item('编辑图片')).toBeFocused()
    await dismiss()
    await expect(preview.getByRole('button', { name: '选择工具', exact: true })).toBeVisible()
    await preview.screenshot({ path: `artifacts/context-menu-editing-${mode}.png`, animations: 'disabled' })

    // Use the minimum preview size to force repositioning at both viewport
    // edges. Verify the actual menu rectangle, not the CSS positioning formula.
    await rightClick()
    await choose('完成编辑')
    const compactLayouts = []
    for (const width of [420, 360]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=preview'))
        win.setMinimumSize(360, 240); win.setBounds({ width, height: 300 })
      }, width)
      await expect.poll(() => preview.evaluate(() => innerWidth)).toBe(width)
      await preview.getByRole('button', { name: '适应窗口', exact: true }).click()
      await rightClick(1190, 690)
      const layout = await menu.evaluate(node => {
        const bounds = node.getBoundingClientRect()
        return { viewportWidth: innerWidth, viewportHeight: innerHeight, x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom }
      })
      assert(layout.x >= 0 && layout.y >= 0 && layout.right <= layout.viewportWidth && layout.bottom <= layout.viewportHeight, 'Context menu must remain entirely inside the compact preview')
      compactLayouts.push(layout)
      await preview.screenshot({ path: `artifacts/context-menu-compact-${width}-${mode}.png`, animations: 'disabled' })
      await dismiss()
    }

    assert.deepEqual(errors, [])
    const report = {
      mode, previewContextEdit: true, annotationContextEdit: true, previewAnnotationSelectionPreserved: true,
      initialHistoryEmpty: true, rightClickDoesNotDraw: drawingTools, blankContextCannotDeletePreviousSelection: true,
      contextDeleteUndoRedo: true, keyboardNavigation: true, escapeRestoresCanvasFocus: true, compactLayouts, pageErrors: errors,
    }
    await fs.writeFile(`artifacts/context-menu-regression-${mode}.json`, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    const preview = app.windows().find(page => page.url().includes('view=preview'))
    if (preview) {
      await preview.screenshot({ path: `artifacts/context-menu-failure-${mode}.png` }).catch(() => {})
      await fs.writeFile(`artifacts/context-menu-failure-${mode}.txt`, await preview.locator('body').innerText().catch(() => String(error)))
    }
    throw error
  } finally { await app.close().catch(() => {}) }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
