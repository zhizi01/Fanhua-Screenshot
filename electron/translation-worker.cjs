'use strict'
const path = require('node:path')
const { LIMITS, splitTextByTokens } = require('./translation-text.cjs')
const postMessage = message => process.parentPort ? process.parentPort.postMessage(message) : process.send(message)

let engine, loadedDirection, transformers, workerData
let running = false

function progress(request, completed, status, paragraph) {
  postMessage({ type: 'progress', requestId: request.requestId, event: {
    requestId: request.requestId, direction: request.direction, completed, total: request.paragraphs.length, status,
    ...(paragraph ? { paragraph } : {}),
  } })
}

async function loadEngine(direction) {
  if (engine && loadedDirection === direction) return engine
  if (engine) { await engine.dispose(); engine = undefined; loadedDirection = undefined }
  if (!transformers) {
    transformers = require(workerData.modulePath)
    transformers.env.localModelPath = path.resolve(workerData.modelRoot) + path.sep
    transformers.env.allowLocalModels = true
    transformers.env.allowRemoteModels = false
    transformers.env.useFSCache = false
    transformers.env.useBrowserCache = false
  }
  engine = await transformers.pipeline('translation', `Xenova/opus-mt-${direction}`, {
    device: 'cpu', dtype: 'q8', local_files_only: true,
    session_options: { intraOpNumThreads: workerData.threads, interOpNumThreads: 1, executionMode: 'sequential' },
  })
  loadedDirection = direction
  return engine
}

async function translateParagraph(text, direction, translator, pulse) {
  const inputText = content => direction === 'en-zh' ? `>>cmn_Hans<< ${content}` : content
  const tokenize = content => translator.tokenizer(inputText(content), { truncation: false, padding: false })
  const countTokens = content => tokenize(content).input_ids.dims[1]
  const lines = []
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.trim()) { lines.push(''); continue }
    if (!/\p{L}/u.test(line)) { lines.push(line); continue }
    const chunks = splitTextByTokens(line, countTokens, LIMITS.inputTokens, direction === 'en-zh' ? 'en' : 'zh')
    const translations = []
    for (const chunk of chunks) {
      pulse()
      const inputs = tokenize(chunk)
      if (inputs.input_ids.dims[1] > LIMITS.inputTokens) throw new Error('翻译段落分段失败，请缩短该段后重试')
      // Use token output directly so a length-limited result cannot silently
      // masquerade as a complete translation (the pipeline returns only text).
      const output = await translator.model.generate({
        ...inputs, max_new_tokens: LIMITS.outputTokens, num_beams: 1, do_sample: false,
        return_dict_in_generate: false,
      })
      const ids = output.tolist()[0]
      const eos = translator.model.generation_config?.eos_token_id ?? translator.model.config.eos_token_id
      const eosIds = (Array.isArray(eos) ? eos : [eos]).filter(id => id !== undefined && id !== null).map(Number)
      if (ids.length >= LIMITS.outputTokens + 1 || !eosIds.includes(Number(ids.at(-1)))) throw new Error('该段译文超出长度限制，请拆分段落后重试；未返回截断译文')
      let translated = translator.tokenizer.batch_decode(output, { skip_special_tokens: true })[0]?.trim()
      if (!translated) throw new Error('该段未生成有效译文，请修正识别文字后重试')
      if (direction === 'en-zh') translated = translated.replace(/[ \t]+([，。！？；：、])/gu, '$1').replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, '$1')
      translations.push(translated)
    }
    lines.push(translations.join(direction === 'zh-en' ? ' ' : ''))
  }
  return lines.join('\n')
}

async function receive(request) {
  if (request?.type === 'init') { if (!workerData) workerData = request.config; return }
  if (running) return
  running = true
  try {
    progress(request, 0, 'loading')
    const translator = await loadEngine(request.direction)
    const paragraphs = []
    for (const paragraph of request.paragraphs) {
      progress(request, paragraphs.length, 'translating')
      const text = await translateParagraph(paragraph.text, request.direction, translator, () => progress(request, paragraphs.length, 'translating'))
      const translated = { id: paragraph.id, sourceText: paragraph.text, text }
      paragraphs.push(translated)
      progress(request, paragraphs.length, 'translating', translated)
    }
    progress(request, paragraphs.length, 'done')
    postMessage({ type: 'result', requestId: request.requestId, result: { requestId: request.requestId, direction: request.direction, paragraphs } })
  } catch (error) {
    const known = /^(该段|翻译段落|段落包含)/.test(error?.message || '')
    if (!known) console.error('本地翻译引擎错误：', error)
    postMessage({ type: 'error', requestId: request.requestId, error: known ? error.message : '本地翻译失败，请检查模型与运行库是否完整后重试' })
  } finally { running = false }
}
if (process.parentPort) process.parentPort.on('message', event => void receive(event.data))
else {
  process.on('message', request => void receive(request))
  process.on('disconnect', () => process.exit(0))
}
