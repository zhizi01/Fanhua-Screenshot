'use strict'

// Real settings IPC and disk persistence. Registry/login operations are replaced
// only inside this test process, so this regression never changes Windows setup.
const { _electron: electron, expect } = require('@playwright/test')
const electronPath = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { DEFAULT_SETTINGS } = require('../electron/settings.cjs')

async function findWindow(app, view, excluded = []) {
  await expect.poll(() => app.windows().some(page => !excluded.includes(page) && page.url().includes(`view=${view}`)), { timeout: 20000 }).toBe(true)
  return app.windows().find(page => !excluded.includes(page) && page.url().includes(`view=${view}`))
}
async function select(page, label, option) {
  const control = page.locator(`[aria-label="${label}"]`)
  await expect(control).not.toHaveClass(/ant-select-disabled/)
  await control.locator('.ant-select-selector').click()
  if (label === '默认标注字体') await control.locator('input').fill(option)
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: option === 'Arial' ? /^Arial$/ : option }).click()
}
async function run() {
  await fs.mkdir('artifacts', { recursive: true })
  const packaged = process.argv[2] || process.env.FANHUA_PACKAGED_EXE
  const mode = packaged ? 'packaged' : 'source'
  const profile = path.resolve(await fs.mkdtemp(path.join('artifacts', `settings-profile-${mode}-`)))
  // No startup toast during automated regression. Notification behavior has its
  // own service tests; all remaining defaults are the real application defaults.
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, startupNotification: false } }))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const errors = []
  const launch = async () => {
    const app = await electron.launch({ executablePath: packaged || electronPath, args: [...(packaged ? [] : ['.']), `--user-data-dir=${profile}`, '--show-settings'], env, timeout: 30000 })
    app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
    return app
  }
  let app = await launch()
  let expected
  try {
    let settings = await findWindow(app, 'settings')
    settings.setDefaultTimeout(15000)
    await expect(settings.getByTestId('settings-window')).toBeVisible()
    await expect(settings.getByRole('switch', { name: '启动时显示通知', exact: true })).toHaveAttribute('aria-checked', 'false')
    await expect(settings.getByRole('button', { name: '开始截图', exact: true })).toHaveCount(0)
    await expect(settings.getByRole('button', { name: /打开图片/ })).toHaveCount(0)
    assert(app.windows().every(page => !page.url().includes('view=dashboard')))
    if (!packaged) await expect(settings.getByRole('switch', { name: '启用资源管理器右键菜单', exact: true })).toBeDisabled()
    await settings.evaluate(() => window.fanhua.openSettings())
    assert.equal(app.windows().filter(page => page.url().includes('view=settings')).length, 1, 'Settings must reuse its existing window')

    // Stub only OS effects and deterministic recognition. All ordinary
    // preference changes still use the real trusted handler and settings store.
    await app.evaluate(({ ipcMain }) => {
      const handlers = Reflect.get(ipcMain, '_invokeHandlers')
      const originalState = handlers.get('app:state'), originalGet = handlers.get('settings:get'), originalUpdate = handlers.get('settings:update')
      const mock = ipcMain.__settingsUi = { context: false, registered: 0, login: false, shortcut: false, failContext: false, failPreference: false, failLogin: false, localPath: null, localCancel: false, localFail: false, saves: [], ocr: [], localChooses: 0 }
      const state = async event => ({ ...await originalState(event), isPackaged: true, launchAtLogin: mock.login, shortcutRegistered: mock.shortcut, contextMenu: { available: true, enabled: mock.context, registered: mock.registered, total: 6, legacyMachine: false, conflict: false } })
      handlers.set('app:state', state)
      handlers.set('settings:get', async event => ({ ...await originalGet(event), contextMenuEnabled: mock.context }))
      handlers.set('settings:update', async (event, patch) => {
        if (Object.hasOwn(patch, 'contextMenuEnabled')) {
          if (!event.sender.getURL().includes('view=settings')) throw Error('不允许此窗口执行该操作')
          if (mock.failContext) throw Error('测试：右键菜单写入失败')
          mock.context = patch.contextMenuEnabled; mock.registered = mock.context ? 6 : 0
          return { ...await originalGet(event), contextMenuEnabled: mock.context }
        }
        if (mock.failPreference) throw Error('测试：设置保存失败')
        return { ...await originalUpdate(event, patch), contextMenuEnabled: mock.context }
      })
      handlers.set('app:launch-at-login', async (event, enabled) => {
        if (!event.sender.getURL().includes('view=settings')) throw Error('不允许此窗口执行该操作')
        if (mock.failLogin) throw Error('测试：开机启动写入失败')
        return (mock.login = enabled)
      })
      handlers.set('app:retry-shortcut', async event => { mock.shortcut = true; return state(event) })
      handlers.set('localsend:settings', async event => {
        if (!event.sender.getURL().includes('view=settings')) throw Error('不允许此窗口执行该操作')
        if (mock.localReadFail) throw Error('测试：LocalSend 存档损坏')
        return { executable: mock.localPath }
      })
      handlers.set('localsend:choose-executable', async event => {
        if (!event.sender.getURL().includes('view=settings')) throw Error('不允许此窗口执行该操作')
        mock.localChooses++
        if (mock.localFail) throw Error('测试：LocalSend 路径不可用')
        if (mock.localCancel) return null
        mock.localPath = 'C:\\便携工具\\LocalSend\\localsend.exe'; return { executable: mock.localPath }
      })
      handlers.set('localsend:reset-executable', async () => { mock.localReadFail = false; return { executable: (mock.localPath = null) } })
      handlers.set('ocr:capabilities', async () => ({ available: true, languages: [{ tag: 'auto', name: '自动（中文 / 英文优先）' }, { tag: 'en-US', name: '英语' }] }))
      handlers.set('ocr:recognize', async (_event, data, language) => { mock.ocr.push({ data, language }); return { paragraphs: [], lines: [], text: '', width: 900, height: 550, language } })
      handlers.set('translation:capabilities', async () => ({ available: true, directions: ['en-zh', 'zh-en'] }))
      handlers.set('image:save', async (_event, data, options) => { mock.saves.push({ data, options }); return { canceled: false, filePath: 'test-output.jpg' } })
    })
    await settings.reload()
    const getPreferences = () => settings.evaluate(() => window.fanhua.getSettings())
    const setMock = patch => app.evaluate(({ ipcMain }, patch) => Object.assign(ipcMain.__settingsUi, patch), patch)
    await expect(settings.getByRole('button', { name: '重试注册截图快捷键', exact: true })).toBeVisible()
    await settings.getByRole('button', { name: '重试注册截图快捷键', exact: true }).click()
    await expect(settings.getByText('快捷键已就绪。', { exact: true })).toBeVisible()

    const contextSwitch = settings.getByRole('switch', { name: '启用资源管理器右键菜单', exact: true })
    await setMock({ failContext: true }); await contextSwitch.click()
    await expect(settings.getByRole('alert')).toContainText('测试：右键菜单写入失败')
    await expect(contextSwitch).toHaveAttribute('aria-checked', 'false')
    await setMock({ failContext: false }); await contextSwitch.click()
    await expect.poll(async () => (await app.evaluate(({ ipcMain }) => ipcMain.__settingsUi.context))).toBe(true)
    await expect(settings.getByText('已注册 6 / 6 种文件格式', { exact: true })).toBeVisible()
    await contextSwitch.click(); await expect(contextSwitch).toHaveAttribute('aria-checked', 'false')
    await setMock({ registered: 2 }); await settings.reload()
    await settings.getByRole('button', { name: '清理残留右键菜单', exact: true }).click()
    await expect(settings.getByText('已注册 0 / 6 种文件格式', { exact: true })).toBeVisible()

    const login = settings.getByRole('switch', { name: '开机时自动启动', exact: true })
    await setMock({ failLogin: true }); await login.click()
    await expect(settings.getByRole('alert')).toContainText('测试：开机启动写入失败')
    await expect(login).toHaveAttribute('aria-checked', 'false')
    await setMock({ failLogin: false }); await login.click(); await expect(login).toHaveAttribute('aria-checked', 'true')
    await login.click(); await expect(login).toHaveAttribute('aria-checked', 'false')

    const editAfterCapture = settings.getByRole('switch', { name: '截图后直接进入编辑', exact: true })
    await setMock({ failPreference: true }); await editAfterCapture.click()
    await expect(settings.getByRole('alert')).toContainText('测试：设置保存失败')
    await expect(editAfterCapture).toHaveAttribute('aria-checked', 'false')
    await setMock({ failPreference: false }); await editAfterCapture.click()
    await expect.poll(async () => (await getPreferences()).captureOpenEditor).toBe(true)

    await settings.getByRole('tab', { name: '编辑默认', exact: true }).click()
    await select(settings, '默认标注字体', 'Arial')
    await expect.poll(async () => (await getPreferences()).editor.font).toBe('Arial')
    await settings.getByRole('spinbutton', { name: '默认标注字号', exact: true }).fill('36')
    await settings.getByRole('spinbutton', { name: '默认标注字号', exact: true }).press('Tab')
    await expect.poll(async () => (await getPreferences()).editor.size).toBe(36)
    await select(settings, '默认序号方式', '字母')
    await expect.poll(async () => (await getPreferences()).editor.markerStyle).toBe('letter')
    await select(settings, '默认边框类型', '虚线')
    await expect.poll(async () => (await getPreferences()).editor.shapeBorderStyle).toBe('dashed')
    await settings.screenshot({ path: `artifacts/settings-editor-${mode}.png`, animations: 'disabled' })

    await settings.getByRole('tab', { name: '保存与识别', exact: true }).click()
    await select(settings, '默认保存格式', 'JPEG')
    await expect.poll(async () => (await getPreferences()).imageFormat).toBe('jpeg')
    await settings.getByRole('slider', { name: '默认图片质量', exact: true }).press('Home')
    await expect.poll(async () => (await getPreferences()).imageQuality).toBe(10)
    await select(settings, '默认PDF保存范围', '当前页')
    await expect.poll(async () => (await getPreferences()).pdfScope).toBe('current')
    await select(settings, '默认OCR语言', '英语')
    await expect.poll(async () => (await getPreferences()).ocrLanguage).toBe('en-US')
    await select(settings, '默认翻译方向', '中文 → 英文')
    await expect.poll(async () => (await getPreferences()).translationDirection).toBe('zh-en')

    await settings.getByRole('tab', { name: '共享', exact: true }).click()
    const localPath = settings.getByTestId('localsend-executable')
    await settings.getByRole('button', { name: '选择LocalSend程序', exact: true }).click()
    await expect(localPath).toContainText('C:\\便携工具\\LocalSend\\localsend.exe')
    await setMock({ localCancel: true }); await settings.getByRole('button', { name: '选择LocalSend程序', exact: true }).click()
    await expect(localPath).toContainText('C:\\便携工具\\LocalSend\\localsend.exe')
    await setMock({ localFail: true }); await settings.getByRole('button', { name: '选择LocalSend程序', exact: true }).click()
    await expect(settings.getByRole('alert')).toContainText('测试：LocalSend 路径不可用')
    await setMock({ localFail: false, localCancel: false })
    await settings.getByRole('button', { name: '恢复自动查找LocalSend', exact: true }).click()
    await expect(localPath).toHaveText('自动查找 LocalSend')
    await setMock({ localReadFail: true }); await settings.reload()
    await settings.getByRole('tab', { name: '共享', exact: true }).click()
    await expect(localPath).toHaveText('位置读取失败')
    await settings.getByRole('button', { name: '恢复自动查找LocalSend', exact: true }).click()
    await expect(localPath).toHaveText('自动查找 LocalSend')

    // All tabs must remain reachable at the small supported window size.
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=settings')); win.setMinimumSize(480, 420); win.setBounds({ width: 480, height: 420 }) })
    await expect.poll(() => settings.evaluate(() => innerWidth)).toBe(480)
    for (const tab of ['常规', '编辑默认', '保存与识别', '共享']) {
      await settings.getByRole('tab', { name: tab, exact: true }).click()
      const overflow = await settings.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth)
      assert.equal(overflow, false, `Settings tab ${tab} must not overflow horizontally`)
    }
    await settings.screenshot({ path: `artifacts/settings-compact-${mode}.png`, animations: 'disabled' })
    expected = await getPreferences()
    const persisted = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'))
    assert.deepEqual(persisted.settings, expected, 'Preference UI must persist through the real settings service')

    const fixture = await settings.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 550
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 550); ctx.fillStyle = '#222'; ctx.font = '36px Arial'; ctx.fillText('SETTINGS DEFAULTS', 50, 90)
      return canvas.toDataURL()
    })
    const fixturePath = path.resolve('artifacts/settings-source.png')
    await fs.writeFile(fixturePath, Buffer.from(fixture.split(',')[1], 'base64'))
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, fixturePath)
    await settings.evaluate(() => window.fanhua.openImage())
    const preview = await findWindow(app, 'preview')
    await expect(preview.getByTestId('editor-canvas')).toBeVisible()
    const denied = await preview.evaluate(async () => {
      const results = []
      for (const action of [() => window.fanhua.updateSettings({ imageQuality: 50 }), () => window.fanhua.getLocalSendSettings(), () => window.fanhua.setLaunchAtLogin(true)]) {
        try { await action(); results.push(false) } catch (error) { results.push(/不允许/.test(String(error))) }
      }
      return results
    })
    assert.deepEqual(denied, [true, true, true], 'Preview must not mutate application preferences or system options')
    await preview.getByRole('button', { name: '进入编辑模式', exact: true }).click()
    await preview.getByRole('button', { name: '文字工具', exact: true }).click()
    const box = await preview.getByTestId('editor-canvas').boundingBox()
    await preview.mouse.click(box.x + box.width * .2, box.y + box.height * .3)
    await expect(preview.getByRole('spinbutton', { name: '标注字号', exact: true })).toHaveValue('36')
    await expect(preview.locator('[aria-label="标注字体"]')).toContainText('Arial')
    await preview.getByRole('textbox', { name: '标注文字内容', exact: true }).fill('保留旧窗口标注')
    await preview.getByRole('button', { name: '保存图片', exact: true }).click()
    await expect(preview.locator('[aria-label="保存格式"]')).toContainText('JPEG')
    await expect(preview.getByRole('slider', { name: '图片质量', exact: true })).toHaveAttribute('aria-valuenow', '10')
    await preview.getByRole('button', { name: '确认保存', exact: true }).click()
    await expect.poll(() => app.evaluate(({ ipcMain }) => ipcMain.__settingsUi.saves.length)).toBe(1)
    assert.deepEqual(await app.evaluate(({ ipcMain }) => ipcMain.__settingsUi.saves[0].options), { format: 'jpeg', quality: 10 })
    await preview.getByRole('button', { name: '中英翻译', exact: true }).click()
    await expect.poll(() => app.evaluate(({ ipcMain }) => ipcMain.__settingsUi.ocr.length)).toBe(1)
    assert.equal(await app.evaluate(({ ipcMain }) => ipcMain.__settingsUi.ocr[0].language), 'en-US')
    await expect(preview.locator('[aria-label="翻译方向"]')).toContainText('中文 → 英文')

    await settings.evaluate(() => window.fanhua.updateSettings({ editor: { size: 42 }, imageFormat: 'webp', imageQuality: 75, ocrLanguage: 'auto', translationDirection: 'en-zh' }))
    expected = await getPreferences()
    await expect(preview.getByRole('spinbutton', { name: '标注字号', exact: true })).toHaveValue('36')
    await expect(preview.getByRole('textbox', { name: '标注文字内容', exact: true })).toHaveValue('保留旧窗口标注')
    await preview.getByRole('button', { name: '保存图片', exact: true }).click()
    await expect(preview.locator('[aria-label="保存格式"]')).toContainText('JPEG')
    await preview.getByRole('button', { name: '取消', exact: true }).click()
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click()
    await expect.poll(() => settings.isClosed()).toBe(true)
    await preview.getByRole('button', { name: '打开设置', exact: true }).click()
    settings = await findWindow(app, 'settings')
    await expect(settings.getByTestId('settings-window')).toBeVisible()
    await preview.getByRole('button', { name: '打开设置', exact: true }).click()
    assert.equal(app.windows().filter(page => page.url().includes('view=settings')).length, 1)

    // Capture from a generated screen source, never the user's actual desktop.
    await app.evaluate(({ desktopCapturer, screen, nativeImage }, dataUrl) => {
      desktopCapturer.getSources = async () => screen.getAllDisplays().map(display => ({ id: `screen:${display.id}:0`, display_id: String(display.id), name: '设置测试画面', thumbnail: nativeImage.createFromDataURL(dataUrl) }))
    }, fixture)
    await settings.evaluate(() => window.fanhua.startCapture())
    const capture = await findWindow(app, 'capture')
    await expect(capture.getByAltText('当前屏幕的冻结画面', { exact: true })).toBeVisible()
    await capture.mouse.move(120, 140); await capture.mouse.down(); await capture.mouse.move(380, 300, { steps: 6 }); await capture.mouse.up()
    const captured = await findWindow(app, 'preview', [preview])
    await expect(captured.getByTestId('editor-canvas')).toBeVisible()
    await expect(captured.getByRole('button', { name: '选择工具', exact: true })).toBeVisible()
    assert.equal(await captured.evaluate(async () => (await window.fanhua.getPreview()).initialEditing), true)
    await captured.getByRole('button', { name: '关闭窗口不保存', exact: true }).click()
    await expect.poll(() => captured.isClosed()).toBe(true)

    const crashed = settings
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.getURL().includes('view=settings')).webContents.forcefullyCrashRenderer())
    await expect.poll(() => crashed.isClosed(), { timeout: 15000 }).toBe(true)
    await preview.getByRole('button', { name: '打开设置', exact: true }).click()
    settings = await findWindow(app, 'settings')
    await expect(settings.getByTestId('settings-window')).toBeVisible()

    await app.close(); app = await launch()
    settings = await findWindow(app, 'settings')
    await expect(settings.getByTestId('settings-window')).toBeVisible()
    assert.deepEqual(await settings.evaluate(() => window.fanhua.getSettings()), expected, 'All preferences must survive an actual application restart')
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, fixturePath)
    await settings.evaluate(() => window.fanhua.openImage())
    const newPreview = await findWindow(app, 'preview')
    await expect(newPreview.getByTestId('editor-canvas')).toBeVisible()
    await newPreview.getByRole('button', { name: '进入编辑模式', exact: true }).click()
    await newPreview.getByRole('button', { name: '文字工具', exact: true }).click()
    const newBox = await newPreview.getByTestId('editor-canvas').boundingBox()
    await newPreview.mouse.click(newBox.x + newBox.width * .2, newBox.y + newBox.height * .3)
    await expect(newPreview.getByRole('spinbutton', { name: '标注字号', exact: true })).toHaveValue('42')
    await newPreview.getByRole('button', { name: '保存图片', exact: true }).click()
    await expect(newPreview.locator('[aria-label="保存格式"]')).toContainText('WebP')
    await expect(newPreview.getByRole('slider', { name: '图片质量', exact: true })).toHaveAttribute('aria-valuenow', '75')
    await newPreview.getByRole('button', { name: '取消', exact: true }).click()
    assert.deepEqual(errors, [])
    const report = { mode, profile, realSettingsPersistence: true, applicationRestartVerified: true, defaultsReachNewPreview: true, existingPreviewUnchanged: true, sourceWindowIsolation: true, settingsWindowReuseAndDestruction: true, settingsCrashRecovery: true, captureOpensEditor: true, captureSourceGenerated: true, noDashboard: true, registryAndLoginStubbed: true, failedChangesRolledBack: true, partialContextMenuCleanup: true, localSendPathActionsStubbed: true, corruptedLocalSendPathRecovery: true, compactTabsFit: true, expected, pageErrors: errors }
    await fs.writeFile(`artifacts/settings-ui-regression-${mode}.json`, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    for (const page of app.windows().filter(page => /view=(settings|preview)/.test(page.url()))) {
      const view = page.url().includes('view=settings') ? 'settings' : 'preview'
      await page.screenshot({ path: `artifacts/settings-failure-${view}-${mode}.png` }).catch(() => {})
      await fs.writeFile(`artifacts/settings-failure-${view}-${mode}.txt`, await page.locator('body').innerText().catch(() => String(error)))
    }
    throw error
  } finally { await app.close().catch(() => {}) }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
