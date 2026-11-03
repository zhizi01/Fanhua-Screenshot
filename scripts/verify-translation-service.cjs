'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { createTranslationService } = require('../electron/translation.cjs')
const { validateTranslationRequest, splitTextByTokens } = require('../electron/translation-text.cjs')

const projectRoot = path.resolve(__dirname, '..')

async function main() {
  const services = []
  try {
  const { AutoTokenizer, env } = require('@huggingface/transformers')
  env.localModelPath = path.join(projectRoot, 'resources', 'translation') + path.sep
  env.allowRemoteModels = false
  const tokenizer = await AutoTokenizer.from_pretrained('Xenova/opus-mt-en-zh', { local_files_only: true })
  const count = text => tokenizer(`>>cmn_Hans<< ${text}`, { truncation: false, padding: false }).input_ids.dims[1]
  const long = 'Please save the screenshot before you close this window. '.repeat(90) + '非常长且没有空格的文字🙂'.repeat(150)
  const chunks = splitTextByTokens(long, count)
  assert(chunks.length > 3)
  assert(chunks.every(chunk => count(chunk) <= 192))
  assert.equal(chunks.join('').replace(/\s/gu, ''), long.replace(/\s/gu, ''))
  assert(!chunks.some(chunk => /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(chunk)))

  const fixture = path.join(projectRoot, 'artifacts', 'translation-service-model-fixture')
  const files = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']
  for (const direction of ['en-zh', 'zh-en']) for (const file of files) {
    const target = path.join(fixture, 'Xenova', `opus-mt-${direction}`, file)
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, 'fixture')
  }
  const instances = []
  class FakeWorker extends EventEmitter {
    constructor() { super(); this.terminated = false; this.pid = 99999; instances.push(this); queueMicrotask(() => this.emit('spawn')) }
    postMessage(request) {
      if (request.type === 'init') return
      this.request = request
      this.timer = setTimeout(() => this.emit('message', { type: 'result', requestId: request.requestId, result: { requestId: request.requestId, direction: request.direction, paragraphs: request.paragraphs.map(p => ({ id: p.id, sourceText: p.text, text: 'fixture translated' })) } }), 80)
    }
    kill() { clearTimeout(this.timer); this.terminated = true; this.pid = undefined; this.emit('exit', 0); return true }
  }
  const service = createTranslationService({ modelRoot: fixture, idleMs: 30, forkProcess: () => new FakeWorker() })
  services.push(service)
  const request = id => ({ requestId: id, direction: 'en-zh', paragraphs: [{ id: 'p1', text: ' original whitespace ' }] })
  await assert.rejects(service.translate({ ...request('bad'), direction: 'fr-en' }), /仅支持/)
  assert.throws(() => validateTranslationRequest({ ...request('duplicate'), paragraphs: [{ id: 'a', text: 'a' }, { id: 'a', text: 'b' }] }), /重复/)
  const first = service.translate(request('cancel-before-ready'), { ownerId: 1 })
  assert.equal(service.cancel('cancel-before-ready', 2), false)
  assert.equal(service.cancelOwner(1), true)
  await assert.rejects(first, /取消/)
  const next = service.translate(request('cancel-running'), { ownerId: 1 })
  await assert.rejects(service.translate(request('busy'), { ownerId: 2 }), /其他翻译任务/)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(service.cancel('cancel-running', 1), true)
  await assert.rejects(next, /取消/)
  const result = await service.translate(request('retry'), { ownerId: 2 })
  assert.equal(result.paragraphs[0].sourceText, ' original whitespace ')
  await new Promise(resolve => setTimeout(resolve, 60))
  assert(instances.every(instance => instance.terminated))
  const pending = service.translate(request('shutdown'), { ownerId: 2 })
  const rejected = assert.rejects(pending, /已关闭/)
  await service.dispose(); await rejected
  assert.equal((await service.getCapabilities()).available, false)
  const missing = createTranslationService({ modelRoot: path.join(projectRoot, 'artifacts', 'nonexistent-translation-models') })
  services.push(missing)
  assert.equal((await missing.getCapabilities()).available, false)
  await assert.rejects(missing.translate(request('missing')), /模型缺失/)
  await missing.dispose()
  console.log(JSON.stringify({ valid: true, longTextCharacters: long.length, chunks: chunks.length, maxInputTokens: Math.max(...chunks.map(count)), sourcePreserved: true, ownerIsolation: true, cancelBeforeReady: true, busyAndRetry: true, idleRelease: true, missingModel: true }))
  } finally { await Promise.all(services.map(service => service.dispose())) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
