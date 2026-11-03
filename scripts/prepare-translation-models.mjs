import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Build-time download only. Runtime translation is strictly local.
const root = fileURLToPath(new URL('../resources/translation/', import.meta.url))
const allowed = new Set([
  'config.json', 'generation_config.json', 'tokenizer.json',
  'tokenizer_config.json', 'special_tokens_map.json',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
])
const verifyOnly = process.argv.includes('--check')
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('用法：node scripts/prepare-translation-models.mjs [--check]')

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.models) || manifest.models.length !== 2) throw new Error('翻译模型清单格式错误')
  const directions = new Set()
  return manifest.models.flatMap(model => {
    if (!['en-zh', 'zh-en'].includes(model.direction) || directions.has(model.direction)
      || model.id !== `Xenova/opus-mt-${model.direction}` || !/^[a-f0-9]{40}$/.test(model.revision)
      || !Array.isArray(model.files) || model.files.length !== allowed.size) throw new Error('翻译模型来源或版本不合法')
    directions.add(model.direction)
    const paths = new Set()
    return model.files.map(file => {
      if (!allowed.has(file.path) || paths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)
        || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 100_000_000) throw new Error('翻译模型文件清单不合法')
      paths.add(file.path)
      const target = path.resolve(root, model.id, file.path)
      if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('翻译模型路径越界')
      return { ...file, target, label: `${model.direction}/${file.path}`, url: `https://huggingface.co/${model.id}/resolve/${model.revision}/${file.path}?download=true` }
    })
  })
}

async function validFile(file) {
  try {
    const info = await stat(file.target)
    if (!info.isFile() || info.size !== file.bytes) return false
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file.target)) hash.update(chunk)
    return hash.digest('hex') === file.sha256
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function fetchHttps(url, signal, headers = {}) {
  // Check every redirect before sending a request, including signed CDN URLs.
  for (let redirects = 0; redirects < 8; redirects++) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('模型下载只允许 HTTPS')
    const response = await fetch(parsed, { redirect: 'manual', signal, headers })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('模型下载重定向缺少位置')
      url = new URL(location, parsed).href
      continue
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`模型下载失败：HTTP ${response.status}`) }
    return response
  }
  throw new Error('模型下载重定向次数过多')
}

async function downloadRanges(file, temporary) {
  const handle = await open(temporary, 'wx')
  const block = 4 * 1024 * 1024
  const queue = Array.from({ length: Math.ceil(file.bytes / block) }, (_, index) => ({ start: index * block, end: Math.min(file.bytes - 1, (index + 1) * block - 1) }))
  const controller = new AbortController()
  let complete = 0
  try {
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length && !controller.signal.aborted) {
        const { start, end } = queue.shift()
        let data
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)])
            const response = await fetchHttps(`${file.url}&part=${start}`, signal, { Range: `bytes=${start}-${end}` })
            if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${file.bytes}`) {
              await response.body?.cancel()
              throw new Error('模型服务器未返回请求的字节范围')
            }
            const chunks = []
            let length = 0
            for await (const chunk of response.body) {
              length += chunk.length
              if (length > end - start + 1) throw new Error('模型分块超过请求大小')
              chunks.push(chunk)
            }
            if (length !== end - start + 1) throw new Error('模型分块不完整')
            data = Buffer.concat(chunks, length)
            break
          } catch (error) {
            if (attempt === 3 || controller.signal.aborted) throw error
            await new Promise(resolve => setTimeout(resolve, attempt * 1000))
          }
        }
        let written = 0
        while (written < data.length) {
          const result = await handle.write(data, written, data.length - written, start + written)
          if (!result.bytesWritten) throw new Error('模型写入没有进展')
          written += result.bytesWritten
        }
        complete += data.length
        console.log(`${file.label} ${Math.floor(complete / file.bytes * 100)}%`)
      }
    }).map(promise => promise.catch(error => { controller.abort(); throw error }))
    const results = await Promise.allSettled(workers)
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
  } finally { controller.abort(); await handle.close() }
  if (!await validFile({ ...file, target: temporary })) throw new Error('模型文件大小或 SHA-256 不匹配')
}

async function download(file) {
  await mkdir(path.dirname(file.target), { recursive: true })
  for (let attempt = 1; attempt <= 3; attempt++) {
    const temporary = `${file.target}.${randomUUID()}.partial`
    try {
      console.log(`下载 ${file.label}（${(file.bytes / 1e6).toFixed(1)} MB，第 ${attempt} 次）`)
      if (file.bytes > 8 * 1024 * 1024) {
        await downloadRanges(file, temporary)
        await rename(temporary, file.target)
        console.log(`已校验 ${file.label}`)
        return
      }
      const signal = AbortSignal.timeout(5 * 60_000)
      const response = await fetchHttps(file.url, signal)
      if (!response.body) throw new Error('模型下载没有响应内容')
      let bytes = 0
      let progress = 0
      const hash = createHash('sha256')
      const check = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length
        if (bytes > file.bytes) { callback(new Error('模型文件超过清单大小')); return }
        hash.update(chunk)
        if (bytes - progress >= 25_000_000) { progress = bytes; console.log(`${file.label} ${Math.floor(bytes / file.bytes * 100)}%`) }
        callback(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body), check, createWriteStream(temporary, { flags: 'wx' }), { signal })
      if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw new Error('模型文件大小或 SHA-256 不匹配')
      await rename(temporary, file.target)
      console.log(`已校验 ${file.label}`)
      return
    } catch (error) {
      await rm(temporary, { force: true })
      if (attempt === 3) throw new Error(`${file.label}：${error.message}`, { cause: error })
      console.warn(`${file.label}：${error.message}，即将重试。`)
      await new Promise(resolve => setTimeout(resolve, attempt * 2000))
    }
  }
}

async function main() {
  const files = validateManifest(JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')))
  const pending = [...files]
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (pending.length) {
      const file = pending.shift()
      if (await validFile(file)) { console.log(`已校验 ${file.label}`); continue }
      if (verifyOnly) throw new Error(`模型缺失或校验失败：${file.label}。请先运行 npm run models:prepare。`)
      await download(file)
    }
  }))
  console.log(`中英离线模型校验通过：${files.length} 个文件，共 ${files.reduce((sum, file) => sum + file.bytes, 0).toLocaleString('en-US')} 字节。`)
}

await main()
