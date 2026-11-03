'use strict'

// Exercises real Windows global shortcuts in an isolated Electron profile.
// Only this test instance's registered keys are injected. Screen pixels are a
// generated fixture; notifications, registry/login settings and user apps are untouched.
const { _electron: electron, expect } = require('@playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { DEFAULT_SETTINGS } = require('../electron/settings.cjs')
const runFile = promisify(execFile)
const project = path.resolve(__dirname, '..')
const artifacts = path.join(project, 'artifacts')

async function findWindow(app, view) {
  await expect.poll(() => app.windows().some(page => page.url().includes(`view=${view}`)), { timeout: 20000 }).toBe(true)
  return app.windows().find(page => page.url().includes(`view=${view}`))
}
function displayKey(key) { return key.replace(/\+/g, ' + ') }
async function editKey(page, key) {
  const parts = key.split('+')
  for (const modifier of ['Ctrl', 'Alt', 'Shift', 'Win']) {
    await page.getByRole('checkbox', { name: modifier, exact: true }).setChecked(parts.includes(modifier))
  }
  const select = page.locator('[aria-label="截图快捷键主键"]')
  await select.locator('.ant-select-selector').click()
  await select.locator('input').fill(parts.at(-1))
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: new RegExp(`^${parts.at(-1)}$`) }).click()
}
async function sendRegisteredKey(app, key) {
  assert(await app.evaluate(({ globalShortcut }, value) => globalShortcut.isRegistered(value), key), 'Never inject a key that this test instance does not own')
  const parts = key.split('+'), main = parts.pop()
  assert(/^F(?:[1-9]|1[01])$/.test(main), 'Injection is restricted to the test function-key candidates')
  const codes = parts.map(part => ({ Ctrl: 0x11, Alt: 0x12, Shift: 0x10, Win: 0x5b })[part])
  assert(codes.every(Number.isInteger)); codes.push(0x70 + Number(main.slice(1)) - 1)
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FanhuaTestInput {
  [StructLayout(LayoutKind.Explicit, Size=40)] public struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public ushort vk;
    [FieldOffset(12)] public uint flags;
  }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] input, int size);
  public static void Send(int[] keys) {
    var input = new INPUT[keys.Length * 2];
    for (int i=0; i<keys.Length; i++) {
      input[i] = new INPUT { type=1, vk=(ushort)keys[i], flags=0 };
      input[keys.Length+i] = new INPUT { type=1, vk=(ushort)keys[keys.Length-i-1], flags=2 };
    }
    if (SendInput((uint)input.Length, input, 40) != input.Length) {
      int error = Marshal.GetLastWin32Error();
      var release = new INPUT[keys.Length]; Array.Copy(input, keys.Length, release, 0, keys.Length);
      SendInput((uint)release.Length, release, 40);
      throw new Exception("SendInput failed: " + error);
    }
  }
}
'@
[FanhuaTestInput]::Send([int[]](ConvertFrom-Json $env:FANHUA_TEST_KEYS))
`
  await runFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 15000, env: { ...process.env, FANHUA_TEST_KEYS: JSON.stringify(codes) },
  })
}

async function run() {
  await fs.mkdir(artifacts, { recursive: true })
  const executable = process.argv.find((value, index) => index > 1 && !value.startsWith('--')) || process.env.FANHUA_PACKAGED_EXE
  const mode = executable ? 'packaged' : 'source'
  const profile = await fs.mkdtemp(path.join(artifacts, `shortcut-${mode}-profile-`))
  const settingsPath = path.join(profile, 'settings.json')
  await fs.writeFile(settingsPath, JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, startupNotification: false } }))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const errors = []
  const launch = async (show = true) => {
    const instance = await electron.launch({ executablePath: executable || require('electron'), args: [...(executable ? [] : ['.']), `--user-data-dir=${profile}`, ...(show ? ['--show-settings'] : [])], cwd: project, env, timeout: 30000 })
    instance.on('window', page => page.on('pageerror', error => errors.push(error.message)))
    return instance
  }
  let app = await launch(), page
  const report = { mode, profile, pageErrors: errors }
  try {
    page = await findWindow(app, 'settings'); page.setDefaultTimeout(15000)
    await expect(page.getByTestId('settings-window')).toBeVisible()
    const initial = await page.evaluate(() => window.fanhua.getAppState())
    assert.equal((await page.evaluate(() => window.fanhua.getSettings())).captureShortcut, 'Alt+A')
    const keys = await app.evaluate(({ app, globalShortcut, Tray }) => {
      const harness = app.__shortcutTest = { tooltips: [], menus: [], conflictHits: 0 }
      const tooltip = Tray.prototype.setToolTip, context = Tray.prototype.setContextMenu
      Tray.prototype.setToolTip = function (value) { harness.tooltips.push(value); return tooltip.call(this, value) }
      Tray.prototype.setContextMenu = function (menu) { harness.menus.push(menu.items.map(item => ({ label: item.label, accelerator: item.accelerator, enabled: item.enabled }))); return context.call(this, menu) }
      const free = []
      for (const key of ['Ctrl+Alt+F10', 'Ctrl+Alt+F11', 'Ctrl+Alt+F9', 'Ctrl+Shift+F10', 'Ctrl+Shift+F11', 'Alt+Shift+F10']) {
        if (!globalShortcut.isRegistered(key) && globalShortcut.register(key, () => { harness.conflictHits++ })) { free.push(key); globalShortcut.unregister(key) }
        if (free.length === 3) break
      }
      if (free.length < 3 || !globalShortcut.register(free[1], () => { harness.conflictHits++ })) throw Error('没有足够的空闲测试快捷键')
      return free
    })
    const [active, occupied, candidate] = keys
    const preferences = () => page.evaluate(() => window.fanhua.getSettings())
    const state = () => page.evaluate(() => window.fanhua.getAppState())
    const apply = page.getByRole('button', { name: '应用快捷键', exact: true })
    await editKey(page, active); await apply.click()
    await expect.poll(async () => (await state()).shortcut).toBe(active)
    assert.equal((await state()).shortcutRegistered, true)
    assert.equal((await preferences()).captureShortcut, active)
    assert.equal(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), initial.shortcut), false)
    assert.equal(JSON.parse(await fs.readFile(settingsPath, 'utf8')).settings.captureShortcut, active)
    await page.evaluate(key => window.fanhua.updateSettings({ captureShortcut: key }), active)
    assert.equal((await state()).shortcutRegistered, true, 'Reapplying the current key must preserve its callback')
    const tray = await app.evaluate(({ app }) => app.__shortcutTest)
    assert(tray.tooltips.at(-1).includes(displayKey(active)))
    assert(tray.menus.at(-1).some(item => item.label === '开始截图' && item.accelerator === active))
    assert(tray.menus.at(-1).some(item => item.label.includes(displayKey(active))))
    Object.assign(report, { initialShortcut: initial.shortcut, initialRegistered: initial.shortcutRegistered, activeShortcut: active, realRegistrationAndOldRelease: true, sameShortcutIdempotent: true, trayUpdated: true })

    const fixture = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600
      const context = canvas.getContext('2d'); context.fillStyle = '#faf4ff'; context.fillRect(0, 0, 900, 600); context.fillStyle = '#573b76'; context.font = '35px Arial'; context.fillText('SHORTCUT FIXTURE', 40, 100)
      return canvas.toDataURL()
    })
    await app.evaluate(({ desktopCapturer, nativeImage, screen }, image) => {
      desktopCapturer.getSources = async () => screen.getAllDisplays().map(display => ({ id: `screen:${display.id}:0`, display_id: String(display.id), name: '测试画面', thumbnail: nativeImage.createFromDataURL(image) }))
    }, fixture)
    await sendRegisteredKey(app, active)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible() && win.webContents.getURL().includes('view=capture'))), { timeout: 15000 }).toBe(true)
    const capture = await findWindow(app, 'capture')
    const context = await capture.evaluate(() => window.fanhua.getCaptureContext())
    assert(await app.evaluate(({ nativeImage }, input) => nativeImage.createFromDataURL(input.actual).toBitmap().equals(nativeImage.createFromDataURL(input.expected).toBitmap()), { actual: context.dataUrl, expected: fixture }))
    await capture.evaluate(sessionId => window.fanhua.cancelCapture(sessionId), context.sessionId)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible() && win.webContents.getURL().includes('view=capture')))).toBe(false)
    report.osKeyTriggeredGeneratedCapture = true

    const beforeConflict = await fs.readFile(settingsPath, 'utf8')
    await editKey(page, occupied); await apply.click()
    await expect(page.getByRole('alert')).toContainText(/占用|注册|快捷键|已被本程序其他功能使用/)
    assert.equal((await state()).shortcut, active); assert.equal((await preferences()).captureShortcut, active)
    assert.equal(await fs.readFile(settingsPath, 'utf8'), beforeConflict)
    assert(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), active))
    await sendRegisteredKey(app, occupied)
    await expect.poll(() => app.evaluate(({ app }) => app.__shortcutTest.conflictHits)).toBe(1)
    report.conflictPreservesOldKeyAndForeignCallback = true

    // Turn only this test profile's settings path into an empty directory so
    // the actual atomic rename fails; restore the original bytes in finally.
    const backup = path.join(profile, 'settings.before-failure.json')
    assert.equal(path.dirname(profile), artifacts); assert(path.basename(profile).startsWith(`shortcut-${mode}-profile-`))
    await fs.rename(settingsPath, backup)
    let createdDirectory = false
    try {
      await fs.mkdir(settingsPath); createdDirectory = true
      await editKey(page, candidate); await apply.click()
      await expect(page.getByRole('alert')).toContainText(/保存失败|恢复|磁盘/)
      assert.equal((await state()).shortcut, active); assert.equal((await preferences()).captureShortcut, active)
      assert(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), active))
      assert.equal(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), candidate), false)
    } finally { if (createdDirectory) await fs.rmdir(settingsPath); await fs.rename(backup, settingsPath) }
    assert.equal(await fs.readFile(settingsPath, 'utf8'), beforeConflict)
    report.realDiskFailureRestoresRegistration = true

    const invalid = await page.evaluate(async () => { try { await window.fanhua.updateSettings({ captureShortcut: 'A' }); return '' } catch (error) { return String(error) } })
    assert(invalid); assert.equal((await state()).shortcut, active)
    const fixturePath = path.join(profile, 'shortcut-fixture.png')
    await fs.writeFile(fixturePath, Buffer.from(fixture.split(',')[1], 'base64'))
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, fixturePath)
    await page.evaluate(() => window.fanhua.openImage())
    const preview = await findWindow(app, 'preview')
    await expect(preview.getByTestId('editor-canvas')).toBeVisible()
    const denied = await preview.evaluate(async key => {
      const values = []
      for (const action of [() => window.fanhua.updateSettings({ captureShortcut: key }), () => window.fanhua.retryShortcut()]) {
        try { await action(); values.push(false) } catch (error) { values.push(/不允许/.test(String(error))) }
      }
      return values
    }, candidate)
    assert.deepEqual(denied, [true, true]); report.settingsOnlyMutation = true
    await preview.getByRole('button', { name: '关闭窗口不保存', exact: true }).click()
    await expect.poll(() => preview.isClosed()).toBe(true); await page.bringToFront()

    // Do not steal Alt+A from another user process; both a successful restore
    // and an honest conflict are valid. Keep the known-free custom key for restart.
    await page.getByRole('button', { name: '恢复Alt + A', exact: true }).click()
    await expect.poll(async () => {
      if ((await state()).shortcut === 'Alt+A') return 'restored'
      const alerts = await page.getByRole('alert').allTextContents()
      return alerts.some(text => /Alt \+ A/.test(text) && /注册|占用/.test(text)) ? 'blocked' : 'pending'
    }).not.toBe('pending')
    await expect(page.getByRole('checkbox', { name: 'Ctrl', exact: true })).toBeEnabled()
    const restored = await state()
    assert(['Alt+A', active].includes(restored.shortcut))
    if (restored.shortcut === 'Alt+A') assert(restored.shortcutRegistered)
    else await expect(page.getByRole('alert')).toContainText(/占用|注册|快捷键/)
    report.restoreDefault = restored.shortcut === 'Alt+A' ? 'registered' : 'occupied-preserved-current'
    await editKey(page, active)
    if (restored.shortcut !== active) await apply.click()
    await expect(page.getByTestId('capture-shortcut-current')).toHaveText(displayKey(active))
    await page.screenshot({ path: path.join(artifacts, `shortcut-settings-${mode}.png`), animations: 'disabled' })
    await app.close(); app = await launch(false)
    await expect.poll(() => app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), active), { timeout: 20000 }).toBe(true)
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.isVisible()).map(win => win.webContents.getURL())), [])
    await app.evaluate(({ app }) => app.emit('activate'))
    page = await findWindow(app, 'settings'); await expect(page.getByTestId('settings-window')).toBeVisible()
    assert.equal((await state()).shortcut, active); assert.equal((await preferences()).captureShortcut, active)
    await page.getByText('查看通知内容', { exact: true }).click()
    await expect(page.locator('.notification-preview')).toContainText(displayKey(active))
    assert.equal((await preferences()).startupNotification, false)
    Object.assign(report, { persistedKeyRegisteredOnRestart: true, normalRestartStaysInTray: true, notificationPreviewUsesCurrentKey: true, noRealScreenCaptured: true })
    assert.deepEqual(errors, [])
    await fs.writeFile(path.join(artifacts, `shortcut-ui-regression-${mode}.json`), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    await page?.screenshot({ path: path.join(artifacts, `shortcut-failure-${mode}.png`) }).catch(() => {})
    throw error
  } finally { await app.close().catch(() => {}) }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
