'use strict'

const DIRECTIONS = Object.freeze(['en-zh', 'zh-en'])
const LIMITS = Object.freeze({ paragraphs: 200, paragraphCharacters: 12000, totalCharacters: 60000, inputTokens: 192, outputTokens: 384 })

function validateTranslationRequest(input) {
  if (!input || typeof input !== 'object' || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(input.requestId)) throw new Error('翻译请求编号无效')
  if (!DIRECTIONS.includes(input.direction)) throw new Error('目前仅支持英文译中文、中文译英文')
  if (!Array.isArray(input.paragraphs) || !input.paragraphs.length || input.paragraphs.length > LIMITS.paragraphs) throw new Error(`一次最多翻译 ${LIMITS.paragraphs} 个段落`)
  let total = 0
  const ids = new Set()
  const paragraphs = input.paragraphs.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id.length || item.id.length > 128 || ids.has(item.id)) throw new Error('翻译段落编号无效或重复')
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > LIMITS.paragraphCharacters || item.text.includes('\0')) throw new Error(`翻译段落不能为空，且单段不超过 ${LIMITS.paragraphCharacters} 字符`)
    ids.add(item.id); total += item.text.length
    if (total > LIMITS.totalCharacters) throw new Error(`一次翻译总长度不超过 ${LIMITS.totalCharacters} 字符，请分批翻译`)
    return { id: item.id, text: item.text }
  })
  return { requestId: input.requestId, direction: input.direction, paragraphs }
}

// Measure actual tokenizer input, including target-language tokens and EOS.
// Preserve every non-whitespace character; never ask the tokenizer to truncate.
function splitTextByTokens(text, countTokens, maxTokens = LIMITS.inputTokens, locale = 'en') {
  const sentences = [...new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(text)].map(item => item.segment)
  const chunks = []
  let pending = ''
  const push = () => { if (pending.trim()) chunks.push(pending.trim()); pending = '' }
  for (const sentence of sentences) {
    if (countTokens(pending + sentence) <= maxTokens) { pending += sentence; continue }
    push()
    if (countTokens(sentence) <= maxTokens) { pending = sentence; continue }
    let characters = Array.from(sentence)
    while (characters.length) {
      if (countTokens(characters.join('')) <= maxTokens) { pending = characters.join(''); break }
      let low = 1, high = characters.length, length = 0
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        if (countTokens(characters.slice(0, middle).join('')) <= maxTokens) { length = middle; low = middle + 1 }
        else high = middle - 1
      }
      if (!length) throw new Error('段落包含无法分段的字符，请修正识别文字后重试')
      // Prefer a nearby word/punctuation boundary when a single sentence is huge.
      const minimum = Math.floor(length * .65)
      for (let position = length - 1; position >= minimum; position--) {
        if (/[\s,;，；、。！？!?]/u.test(characters[position])) { length = position + 1; break }
      }
      const part = characters.slice(0, length).join('').trim()
      if (part) chunks.push(part)
      characters = characters.slice(length)
    }
  }
  push()
  return chunks
}

module.exports = { DIRECTIONS, LIMITS, validateTranslationRequest, splitTextByTokens }
