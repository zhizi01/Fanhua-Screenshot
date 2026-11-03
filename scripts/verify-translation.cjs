'use strict'

// Run after `npm run build`, or pass the absolute packaged executable as argv[2].
// Uses real OCR, real local models and an isolated application profile.
const { _electron: electron, expect } = require('@playwright/test')
const electronPath = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function findWindow(app, view, except) {
  await expect.poll(() => app.windows().some(page => page !== except && page.url().includes(`view=${view}`)), { timeout: 20000 }).toBe(true)
  return app.windows().find(page => page !== except && page.url().includes(`view=${view}`))
}

async function run() {
  await fs.mkdir('artifacts', { recursive: true })
  const packaged = process.argv[2] || process.env.FANHUA_PACKAGED_EXE
  const mode = packaged ? 'packaged' : 'source'
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const application = await electron.launch({
    executablePath: packaged || electronPath,
    args: [...(packaged ? [] : ['.']), `--user-data-dir=${path.resolve('artifacts/translation-regression-profile')}`, '--show-window'],
    env, timeout: 30000,
  })
  const errors = []
  const qualityChecks = []
  const checkMeaning = (source, actual, pattern) => qualityChecks.push({ source, actual, expected: pattern.source, passed: pattern.test(actual) })
  application.on('window', page => page.on('pageerror', error => errors.push(error.message)))
  const started = Date.now()
  try {
    const settings = await findWindow(application, 'settings')
    const rejected = await settings.evaluate(async () => {
      const failures = []
      for (const operation of [
        () => window.fanhua.getTranslationCapabilities(),
        () => window.fanhua.translateParagraphs({ requestId: crypto.randomUUID(), direction: 'en-zh', paragraphs: [{ id: 'a', text: 'Hello.' }] }),
        () => window.fanhua.cancelTranslation(crypto.randomUUID()),
      ]) { try { await operation(); failures.push(false) } catch { failures.push(true) } }
      return failures
    })
    assert.deepEqual(rejected, [true, true, true], 'Translation IPC must reject a non-preview renderer')

    const fixture = await settings.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 600
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#111'; ctx.font = '50px Arial'
      ctx.fillText('Open the image.', 70, 120)
      ctx.fillText('Please save the image.', 70, 370)
      return canvas.toDataURL()
    })
    const fixturePath = path.resolve('artifacts/translation-source.png')
    await fs.writeFile(fixturePath, Buffer.from(fixture.split(',')[1], 'base64'))
    await application.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, fixturePath)
    await settings.evaluate(() => window.fanhua.openImage())
    const preview = await findWindow(application, 'preview')
    preview.setDefaultTimeout(20000)
    await expect(preview.getByTestId('editor-canvas')).toBeVisible()
    const original = await preview.evaluate(() => window.fanhua.getPreview())
    const capabilities = await preview.evaluate(() => window.fanhua.getTranslationCapabilities())
    assert.equal(capabilities.available, true, capabilities.reason)
    assert.deepEqual([...capabilities.directions].sort(), ['en-zh', 'zh-en'])

    await preview.getByRole('button', { name: '中英翻译', exact: true }).click()
    await expect(preview.getByTestId('translation-controls')).toBeVisible()
    const paragraphs = preview.getByTestId('ocr-paragraph-list').getByRole('listitem')
    await expect(paragraphs).toHaveCount(2, { timeout: 120000 })
    await expect(paragraphs.nth(0)).toContainText(/Open the image/i)
    await expect(paragraphs.nth(1)).toContainText(/Please save the image/i)
    const textAt = index => preview.getByLabel(`第 ${index + 1} 段译文`, { exact: true })
    const overlays = preview.getByTestId('translation-overlay')
    const regions = preview.getByTestId('ocr-region')
    await expect(overlays).toHaveCount(0)
    async function overlayGeometry() {
      return preview.evaluate(async () => {
        // ResizeObserver and the component's text fitting frame must both settle.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const canvas = document.querySelector('[data-testid="editor-canvas"]')
        const image = canvas.getBoundingClientRect()
        return {
          imageWidth: image.width,
          regions: [...document.querySelectorAll('[data-testid="ocr-region"]')].map(region => {
            const bounds = region.getBoundingClientRect()
            const overlay = region.querySelector('[data-testid="translation-overlay"]')
            const mask = overlay?.getBoundingClientRect()
            const copy = overlay?.querySelector('[data-testid="translation-overlay-text"]')
            return {
              id: region.dataset.paragraphId,
              position: [(bounds.x - image.x) / image.width, (bounds.y - image.y) / image.height, bounds.width / image.width, bounds.height / image.height],
              inset: mask ? [mask.left - bounds.left, mask.top - bounds.top, bounds.right - mask.right, bounds.bottom - mask.bottom] : null,
              text: copy?.textContent, fontSize: copy && Number.parseFloat(getComputedStyle(copy).fontSize),
              pointerEvents: overlay && getComputedStyle(overlay).pointerEvents,
            }
          }),
        }
      })
    }
    function assertOverlayGeometry(actual, baseline) {
      assert.equal(actual.regions.length, 2)
      actual.regions.forEach((region, index) => {
        assert(region.inset && region.inset.every(value => value >= -.2 && value <= 1.5), 'Translation mask must stay inside its original OCR rectangle')
        assert(region.fontSize >= 11 && region.fontSize <= 48, 'Translation text must remain readable')
        assert.equal(region.pointerEvents, 'none', 'Translation mask must not intercept image editing or selection')
        if (baseline) {
          assert.equal(region.id, baseline.regions[index].id)
          region.position.forEach((value, coordinate) => assert(Math.abs(value - baseline.regions[index].position[coordinate]) < .003, 'Translation mask must track original image coordinates through zoom and scroll'))
        }
      })
    }
    async function waitForTranslation(index, pattern) {
      await preview.waitForFunction(label => document.querySelector(`[aria-label="${label}"]`)?.textContent?.trim()
        || document.querySelector('[data-testid="translation-controls"] [role="alert"]')?.textContent,
      `第 ${index + 1} 段译文`, { timeout: 180000 })
      await expect(preview.getByTestId('translation-controls').getByRole('alert')).toHaveCount(0)
      await expect(textAt(index)).toContainText(pattern, { timeout: 180000 })
      await expect(preview.getByRole('button', { name: '取消翻译', exact: true })).toHaveCount(0, { timeout: 180000 })
      await expect(preview.getByTestId('translation-controls').getByRole('alert')).toHaveCount(0)
      return textAt(index).innerText()
    }
    async function editParagraph(index, value) {
      await preview.getByRole('button', { name: `定位第 ${index + 1} 段文字`, exact: true }).click()
      await preview.getByRole('textbox', { name: `编辑第 ${index + 1} 段文字`, exact: true }).fill(value)
    }
    const englishStarted = Date.now()
    await preview.getByRole('button', { name: '翻译全部段落', exact: true }).click()
    const englishToChinese = [await waitForTranslation(0, /[\u3400-\u9fff]/), await textAt(1).innerText()]
    checkMeaning('Open the image.', englishToChinese[0], /打开|開啟|开启|打開/)
    checkMeaning('Open the image.', englishToChinese[0], /图|圖|影像/)
    checkMeaning('Please save the image.', englishToChinese[1], /保存|储存|存储|存檔/)
    const englishDurationMs = Date.now() - englishStarted
    await expect(overlays).toHaveCount(2)
    const initialOverlayGeometry = await overlayGeometry()
    assertOverlayGeometry(initialOverlayGeometry)
    assert.deepEqual(initialOverlayGeometry.regions.map(region => region.text), englishToChinese, 'Image overlays must show the same complete translation as the sidebar')
    const firstRegion = await regions.nth(0).boundingBox()
    const firstCenter = { x: firstRegion.x + firstRegion.width / 2, y: firstRegion.y + firstRegion.height / 2 }
    assert.equal(await preview.evaluate(point => document.elementFromPoint(point.x, point.y)?.dataset.testid, firstCenter), 'editor-canvas', 'Translated image remains pointer-accessible')
    await preview.mouse.move(firstCenter.x, firstCenter.y)
    await expect(preview.getByTestId('editor-canvas')).toHaveAttribute('title', englishToChinese[0])
    await preview.mouse.click(firstCenter.x, firstCenter.y)
    await expect(paragraphs.nth(0)).toHaveAttribute('aria-current', 'true')
    await preview.keyboard.down('Control')
    try { await preview.mouse.wheel(0, -120) } finally { await preview.keyboard.up('Control') }
    await expect.poll(async () => (await preview.getByTestId('editor-canvas').boundingBox()).width).toBeGreaterThan(initialOverlayGeometry.imageWidth * 1.1)
    const zoomedOverlayGeometry = await overlayGeometry()
    assertOverlayGeometry(zoomedOverlayGeometry, initialOverlayGeometry)
    // Use a guaranteed overflowing image before checking both horizontal and
    // vertical scrolling; OCR masks stay tied to the image, not the viewport.
    await preview.getByRole('button', { name: '原始大小', exact: true }).click()
    await preview.getByRole('button', { name: '放大图片', exact: true }).click()
    const scroll = await preview.getByTestId('image-stage').evaluate(stage => {
      stage.scrollLeft = stage.scrollWidth; stage.scrollTop = stage.scrollHeight
      return { x: stage.scrollLeft, y: stage.scrollTop }
    })
    assert(scroll.x > 0 || scroll.y > 0, 'The scroll alignment regression must actually scroll the image')
    assertOverlayGeometry(await overlayGeometry(), initialOverlayGeometry)
    await preview.getByRole('button', { name: '适应窗口', exact: true }).click()
    await preview.screenshot({ path: `artifacts/translation-overlay-${mode}.png`, animations: 'disabled' })
    await preview.getByRole('button', { name: '翻译', exact: true }).click()
    await expect(overlays).toHaveCount(0)
    await expect(regions).toHaveCount(2)
    await expect(regions.nth(0)).not.toHaveClass(/translated/)
    await preview.getByRole('button', { name: '翻译', exact: true }).click()
    await expect(overlays).toHaveCount(2)
    assert.deepEqual((await overlayGeometry()).regions.map(region => region.text), englishToChinese, 'Reopening translation must restore valid masks without rerunning the model')
    await preview.getByRole('button', { name: '翻译第 1 段', exact: true }).click()
    await waitForTranslation(0, /[\u3400-\u9fff]/)

    await editParagraph(0, 'Close the window.')
    await expect(textAt(0)).toHaveCount(0)
    await expect(overlays).toHaveCount(1)
    await expect(regions.nth(0)).not.toHaveClass(/translated/)
    await expect(regions.nth(1).getByTestId('translation-overlay-text')).toHaveText(englishToChinese[1])
    assert.equal(await textAt(1).innerText(), englishToChinese[1], 'Editing one original must preserve other translations')
    await preview.getByRole('button', { name: '翻译第 1 段', exact: true }).click()
    const revisedChinese = await waitForTranslation(0, /[\u3400-\u9fff]/)
    checkMeaning('Close the window.', revisedChinese, /关闭|關閉|关上/)
    await preview.getByRole('button', { name: '复制第 1 段译文', exact: true }).click()
    await expect.poll(() => application.evaluate(async ({ clipboard }) => clipboard.readText())).toBe(revisedChinese)
    await preview.getByRole('button', { name: '关闭文字识别', exact: true }).click()
    await expect(preview.getByTestId('ocr-sidebar')).toHaveCount(0)
    await expect(overlays).toHaveCount(0)
    await preview.getByRole('button', { name: '识别文字', exact: true }).click()
    await expect(textAt(0)).toHaveText(revisedChinese)
    await expect(overlays).toHaveCount(2)
    await expect(regions.nth(0).getByTestId('translation-overlay-text')).toHaveText(revisedChinese)

    await preview.getByLabel('翻译方向', { exact: true }).click()
    await preview.getByText('中文 → 英文', { exact: true }).click()
    await expect(textAt(0)).toHaveCount(0)
    await expect(textAt(1)).toHaveCount(0)
    await expect(overlays).toHaveCount(0)
    await expect(regions).toHaveCount(2)
    await editParagraph(0, '请打开图片。')
    await editParagraph(1, '请保存图片。')
    const chineseStarted = Date.now()
    await preview.getByRole('button', { name: '翻译全部段落', exact: true }).click()
    const chineseToEnglish = [await waitForTranslation(0, /[a-z]/i), await textAt(1).innerText()]
    checkMeaning('请打开图片。', chineseToEnglish[0], /open/i)
    checkMeaning('请打开图片。', chineseToEnglish[0], /image|picture|photo/i)
    checkMeaning('请保存图片。', chineseToEnglish[1], /save/i)
    checkMeaning('请保存图片。', chineseToEnglish[1], /image|picture|photo/i)
    const chineseDurationMs = Date.now() - chineseStarted
    await expect(overlays).toHaveCount(2)
    assert.deepEqual((await overlayGeometry()).regions.map(region => region.text), chineseToEnglish)
    await preview.getByRole('button', { name: '复制全部译文', exact: true }).click()
    await expect.poll(() => application.evaluate(async ({ clipboard }) => clipboard.readText())).toBe(chineseToEnglish.join('\n\n'))

    const exportedPath = path.resolve(`artifacts/translation-export-${mode}.png`)
    await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, exportedPath)
    await preview.getByRole('button', { name: '保存图片', exact: true }).click()
    await preview.getByRole('button', { name: '确认保存', exact: true }).click()
    await expect(preview.getByRole('dialog')).toHaveCount(0)
    const exported = (await fs.readFile(exportedPath)).toString('base64')
    const exportMatchesOriginal = await application.evaluate(({ nativeImage }, input) => {
      const saved = nativeImage.createFromBuffer(Buffer.from(input.exported, 'base64'))
      const original = nativeImage.createFromBuffer(Buffer.from(input.original.split(',')[1], 'base64'))
      return saved.toBitmap().equals(original.toBitmap())
    }, { exported, original: original.dataUrl })
    assert.equal(exportMatchesOriginal, true, 'OCR text edits, virtual boxes and translations must not enter image export')

    await editParagraph(0, '请在关闭窗口之前保存当前图片。'.repeat(80))
    await expect(overlays).toHaveCount(1)
    await preview.getByRole('button', { name: '翻译第 1 段', exact: true }).click()
    await preview.getByRole('button', { name: '取消翻译', exact: true }).click()
    await expect(preview.getByRole('button', { name: '取消翻译', exact: true })).toHaveCount(0, { timeout: 30000 })
    await expect(overlays).toHaveCount(1)
    await expect(regions.nth(0)).not.toHaveClass(/translated/)
    await editParagraph(0, '请关闭窗口。')
    await preview.getByRole('button', { name: '翻译第 1 段', exact: true }).click()
    const afterCancel = await waitForTranslation(0, /[a-z]/i)
    checkMeaning('请关闭窗口。', afterCancel, /close/i)
    await expect(regions.nth(0).getByTestId('translation-overlay-text')).toHaveText(afterCancel)
    await preview.getByRole('button', { name: '重新识别', exact: true }).click()
    await expect(overlays).toHaveCount(0)
    await expect(paragraphs.nth(0)).toContainText(/Open the image/i, { timeout: 120000 })
    await expect(preview.getByRole('button', { name: '重新识别', exact: true })).toBeEnabled()
    await expect(overlays).toHaveCount(0)
    await expect(regions).toHaveCount(2)
    await fs.writeFile(`artifacts/translation-ui-checkpoint-${mode}.json`, JSON.stringify({
      englishToChinese, revisedChinese, chineseToEnglish, afterCancel, qualityChecks,
      englishDurationMs, chineseDurationMs, exportMatchesOriginal, canceledAndRetried: true,
      overlayMatchesSidebar: true, overlayPointerPassthrough: true, overlayParagraphSelection: true,
      overlayZoomAlignment: true, overlayScrollAlignment: true, overlayCloseRestore: true, overlayOcrReset: true,
    }, null, 2) + '\n')
    console.log('OCR, bidirectional translation, image overlays, zoom/scroll alignment, invalidation, clipboard, export isolation and UI cancel/retry completed.')

    await settings.evaluate(() => window.fanhua.openImage())
    const other = await findWindow(application, 'preview', preview)
    await expect(other.getByTestId('editor-canvas')).toBeVisible()
    const requestId = await preview.evaluate(() => {
      const requestId = crypto.randomUUID()
      const probe = window.__translationProbe = { requestId, events: [], settled: false, error: '', completed: false }
      probe.unsubscribe = window.fanhua.onTranslationProgress(event => { if (event.requestId === requestId) probe.events.push(event.status) })
      void window.fanhua.translateParagraphs({ requestId, direction: 'en-zh', paragraphs: Array.from({ length: 30 }, (_, index) => ({ id: `probe-${index}`, text: 'Please save this picture on your computer before you close the window. '.repeat(8) })) })
        .then(() => { probe.completed = true }).catch(error => { probe.error = String(error) }).finally(() => { probe.settled = true })
      return requestId
    })
    await expect.poll(() => preview.evaluate(() => window.__translationProbe.events.length), { timeout: 30000 }).toBeGreaterThan(0)
    const foreignCancel = await other.evaluate(id => window.fanhua.cancelTranslation(id), requestId)
    assert.equal(foreignCancel, false, 'Another preview cannot cancel the owning preview task')
    const concurrentRejected = await other.evaluate(async () => {
      try { await window.fanhua.translateParagraphs({ requestId: crypto.randomUUID(), direction: 'zh-en', paragraphs: [{ id: 'other', text: '你好。' }] }); return false }
      catch (error) { return /翻译|忙/.test(String(error)) }
    })
    assert.equal(concurrentRejected, true, 'Concurrent translation must be rejected with a useful error')
    assert.equal(await preview.evaluate(() => window.__translationProbe.settled), false)
    const captureStarted = Date.now()
    await preview.evaluate(() => window.fanhua.startCapture())
    const capture = await findWindow(application, 'capture')
    const sessionId = await capture.evaluate(async () => (await window.fanhua.getCaptureContext())?.sessionId)
    assert(sessionId, 'A capture session must start during translation')
    await capture.evaluate(id => window.fanhua.cancelCapture(id), sessionId)
    const captureDurationMs = Date.now() - captureStarted
    const stillTranslatingAfterCapture = await preview.evaluate(() => !window.__translationProbe.settled)
    assert.equal(stillTranslatingAfterCapture, true, 'Capture must remain usable before the translation task finishes')
    assert.equal(await preview.evaluate(id => window.fanhua.cancelTranslation(id), requestId), true)
    await expect.poll(() => preview.evaluate(() => window.__translationProbe.settled), { timeout: 30000 }).toBe(true)
    const canceledProbe = await preview.evaluate(() => {
      const { completed, error } = window.__translationProbe
      window.__translationProbe.unsubscribe()
      return { completed, error }
    })
    assert.equal(canceledProbe.completed, false)
    assert.match(canceledProbe.error, /取消|cancel/i)
    const recoveredAfterCancel = await preview.evaluate(() => window.fanhua.translateParagraphs({
      requestId: crypto.randomUUID(), direction: 'en-zh', paragraphs: [{ id: 'recover', text: 'Please save the image.' }],
    }))
    checkMeaning('Please save the image. [after long-task cancellation]', recoveredAfterCancel.paragraphs[0].text, /保存|储存|存储|存檔/)

    await other.evaluate(() => {
      const requestId = crypto.randomUUID()
      const probe = window.__closeOwnerProbe = { translating: false, settled: false }
      window.fanhua.onTranslationProgress(event => { if (event.requestId === requestId && event.status === 'translating') probe.translating = true })
      void window.fanhua.translateParagraphs({ requestId, direction: 'en-zh', paragraphs: Array.from({ length: 30 }, (_, index) => ({ id: `close-${index}`, text: 'Please save this picture on your computer before you close the window. '.repeat(8) })) })
        .catch(() => {}).finally(() => { probe.settled = true })
    })
    await expect.poll(() => other.evaluate(() => window.__closeOwnerProbe.translating), { timeout: 30000 }).toBe(true)
    assert.equal(await other.evaluate(() => window.__closeOwnerProbe.settled), false)
    const otherWindow = await application.browserWindow(other)
    await otherWindow.evaluate(win => win.close())
    const recoveredAfterOwnerClose = await preview.evaluate(() => window.fanhua.translateParagraphs({
      requestId: crypto.randomUUID(), direction: 'en-zh', paragraphs: [{ id: 'recover-owner', text: 'Open the image.' }],
    }))
    checkMeaning('Open the image. [after owner close]', recoveredAfterOwnerClose.paragraphs[0].text, /打开|開啟|开启|打開/)

    await preview.evaluate(() => {
      const requestId = crypto.randomUUID()
      const probe = window.__processExitProbe = { translating: false, settled: false, error: '', completed: false }
      probe.unsubscribe = window.fanhua.onTranslationProgress(event => { if (event.requestId === requestId && event.status === 'translating') probe.translating = true })
      void window.fanhua.translateParagraphs({ requestId, direction: 'en-zh', paragraphs: Array.from({ length: 30 }, (_, index) => ({ id: `exit-${index}`, text: 'Please save this picture on your computer before you close the window. '.repeat(8) })) })
        .then(() => { probe.completed = true }).catch(error => { probe.error = String(error) }).finally(() => { probe.settled = true })
    })
    await expect.poll(() => preview.evaluate(() => window.__processExitProbe.translating), { timeout: 30000 }).toBe(true)
    const terminatedPid = await application.evaluate(({ app }) => {
      // getAppMetrics is scoped to this isolated test application's own child
      // processes. Never scan or terminate another running application.
      const matches = app.getAppMetrics().filter(item => item.type === 'Utility'
        && (item.name === '繁花有图本地翻译' || item.serviceName === '繁花有图本地翻译'))
      if (matches.length !== 1 || !matches[0].pid || matches[0].pid === process.pid) throw new Error('Cannot uniquely identify this test app translation child')
      process.kill(matches[0].pid)
      return matches[0].pid
    })
    await expect.poll(() => preview.evaluate(() => window.__processExitProbe.settled), { timeout: 30000 }).toBe(true)
    const failedProbe = await preview.evaluate(() => {
      const { completed, error } = window.__processExitProbe
      window.__processExitProbe.unsubscribe()
      return { completed, error }
    })
    assert.equal(failedProbe.completed, false)
    assert.match(failedProbe.error, /意外结束|退出|重试/)
    const recoveredAfterProcessExit = await preview.evaluate(() => window.fanhua.translateParagraphs({
      requestId: crypto.randomUUID(), direction: 'zh-en', paragraphs: [{ id: 'recover-exit', text: '请保存图片。' }],
    }))
    checkMeaning('请保存图片。 [after child process exit]', recoveredAfterProcessExit.paragraphs[0].text, /save/i)

    await preview.screenshot({ path: `artifacts/translation-regression-${mode}.png`, animations: 'disabled' })
    assert.deepEqual(errors, [])
    const result = {
      mode, capabilities, englishToChinese, revisedChinese, chineseToEnglish,
      englishDurationMs, chineseDurationMs, totalDurationMs: Date.now() - started,
      nonPreviewIpcRejected: true, editInvalidation: true, closeReopenPreserved: true,
      realTextClipboard: true, exportMatchesOriginal, canceledAndRetried: true,
      overlayMatchesSidebar: true, overlayPointerPassthrough: true, overlayParagraphSelection: true,
      overlayZoomAlignment: true, overlayScrollAlignment: true, overlayCloseRestore: true, overlayOcrReset: true,
      initialOverlayGeometry, zoomedOverlayGeometry,
      foreignCancelRejected: true, concurrentRejected, captureDuringTranslation: true, longCancelRecovery: true, ownerCloseRecovery: true,
      childProcessExitRecovery: true, terminatedTestChildPid: terminatedPid,
      captureDurationMs, qualityChecks, pageErrors: errors,
    }
    await fs.writeFile(`artifacts/translation-regression-${mode}.json`, JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result, null, 2))
    assert(qualityChecks.every(item => item.passed), 'Translation UI completed, but semantic smoke checks failed; see qualityChecks in the JSON report')
  } catch (error) {
    const preview = application.windows().find(page => page.url().includes('view=preview'))
    if (preview) {
      await preview.screenshot({ path: `artifacts/translation-failure-${mode}.png` }).catch(() => {})
      await fs.writeFile(`artifacts/translation-failure-${mode}.txt`, await preview.locator('body').innerText().catch(() => String(error)))
    }
    throw error
  } finally { await application.close().catch(() => {}) }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
