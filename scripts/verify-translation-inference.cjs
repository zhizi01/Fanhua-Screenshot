'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { fork } = require('node:child_process')
const { createTranslationService } = require('../electron/translation.cjs')

const projectRoot = path.resolve(__dirname, '..')

async function main() {
  await fs.mkdir(path.join(projectRoot, 'artifacts'), { recursive: true })
  const guardPath = path.join(projectRoot, 'artifacts', 'translation-deny-network.cjs')
  await fs.writeFile(guardPath, `
const deny = () => { throw new Error('Translation verification forbids network access') };
globalThis.fetch = async () => deny();
for (const name of ['node:http', 'node:https']) { const api = require(name); api.request = deny; api.get = deny; }
const net = require('node:net'); net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny;
require('node:tls').connect = deny;
`)
  const children = []
  const service = createTranslationService({
    modelRoot: path.join(projectRoot, 'resources', 'translation'),
    forkProcess: file => {
      const child = fork(file, [], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: ['--require', guardPath] })
      children.push(child)
      return child
    },
  })
  const report = { networkAccessBlockedInWorker: true, cpuThreads: 2, runs: [] }
  try {
    report.capabilities = await service.getCapabilities()
    assert.equal(report.capabilities.available, true)
    assert.deepEqual(report.capabilities.directions, ['en-zh', 'zh-en'])
    for (const [direction, texts] of [
      ['en-zh', ['Please save the screenshot before closing this window.', 'Hello, world!']],
      ['zh-en', ['请先保存截图，然后关闭窗口。', '这是一张图片。']],
      ['en-zh', ['The translation runs on your computer without uploading your pictures.']],
    ]) {
      const requestId = `inference_${report.runs.length}`
      const started = performance.now()
      const progress = []
      const result = await service.translate({ requestId, direction, paragraphs: texts.map((text, i) => ({ id: `p${i}`, text })) }, { ownerId: 123, onProgress: event => progress.push({ completed: event.completed, status: event.status }) })
      assert.equal(result.paragraphs.length, texts.length)
      for (const [i, paragraph] of result.paragraphs.entries()) {
        assert.equal(paragraph.sourceText, texts[i])
        assert(paragraph.text.trim())
        assert(direction === 'en-zh' ? /\p{Script=Han}/u.test(paragraph.text) : /[A-Za-z]/.test(paragraph.text))
      }
      report.runs.push({ direction, elapsedMs: Math.round(performance.now() - started), result, progress })
      console.log(JSON.stringify(report.runs.at(-1)))
    }
    report.interruptions = []
    for (const kind of ['cancel', 'cancel', 'owner-close', 'unexpected-exit']) {
      const requestId = `interrupt_${report.interruptions.length}`
      let interrupted = false, timer
      try {
        await assert.rejects(service.translate({ requestId, direction: 'en-zh', paragraphs: [{ id: 'long', text: 'Please save the screenshot before closing this window. '.repeat(100) }] }, {
          ownerId: 456,
          onProgress: event => {
            if (event.status !== 'translating' || interrupted) return
            interrupted = true
            timer = setTimeout(() => {
              if (kind === 'unexpected-exit') children.at(-1).kill()
              else if (kind === 'owner-close') service.cancelOwner(456)
              else service.cancel(requestId, 456)
            }, 30)
          },
        }), kind === 'unexpected-exit' ? /意外结束/ : /取消/)
        assert.equal(interrupted, true)
        report.interruptions.push({ kind, rejectedCleanly: true })
      } finally { clearTimeout(timer) }
    }
    const recovered = await service.translate({ requestId: 'after_interruptions', direction: 'en-zh', paragraphs: [{ id: 'last', text: 'Please save the image.' }] }, { ownerId: 789 })
    assert.match(recovered.paragraphs[0].text, /保存/)
    report.recoveredAfterInterruptions = true
    console.log(JSON.stringify({ interruptions: report.interruptions, recoveredAfterInterruptions: true }))
  } finally { await service.dispose() }
  assert(children.every(child => child.exitCode !== null || child.signalCode !== null), 'Every translation process must have exited before verification ends')
  await fs.mkdir(path.join(projectRoot, 'artifacts'), { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'artifacts', 'translation-inference.json'), JSON.stringify(report, null, 2) + '\n')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
