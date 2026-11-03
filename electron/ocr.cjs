'use strict'
const { spawn } = require('node:child_process')
const { Worker } = require('node:worker_threads')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const unpacked = file => file.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)

function runNativeOcr(mode, imagePath, language, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('文字识别已取消'))
    const script = unpacked(path.join(__dirname, 'native', 'ocr.ps1'))
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode]
    if (imagePath) args.push('-ImagePath', imagePath)
    if (language) args.push('-Language', language)
    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; let settled = false; let stopped
    // Wait for process exit before deleting its input file on Windows.
    const stop = error => { stopped = error; child.kill() }
    const abort = () => stop(new Error('文字识别已取消'))
    const settle = (error, value) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      error ? reject(error) : resolve(value)
    }
    const timer = setTimeout(() => stop(new Error('Windows 文字识别超时')), mode === 'capabilities' ? 15000 : 90000)
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      output += chunk
      if (output.length > 16 * 1024 * 1024) stop(new Error('识别结果过大'))
    })
    child.stderr.resume()
    child.on('error', () => settle(new Error('无法启动 Windows 本地文字识别服务')))
    child.on('close', code => {
      if (stopped) return settle(stopped)
      try {
        const result = JSON.parse(output.trim().replace(/^\uFEFF/, ''))
        if (code !== 0 || result.error) throw new Error(result.error || 'OCR_FAILED')
        settle(null, result)
      } catch (error) {
        const reason = error.message.includes('OCR_LANGUAGE_UNAVAILABLE') ? '当前系统没有所选 OCR 语言' : 'Windows 本地文字识别失败'
        settle(new Error(reason))
      }
    })
  })
}

function normalizeText(text) {
  // Windows OCR inserts spaces between CJK characters; preserve English spaces.
  return text.trim().replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
}
function deduplicateLines(lines) {
  const result = []
  for (const input of lines) {
    if (typeof input.text !== 'string' || !input.text.trim() || !input.bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(input.bounds[key])) || input.bounds.width <= 0 || input.bounds.height <= 0) continue
    const line = { text: normalizeText(input.text), bounds: { ...input.bounds } }
    const normalized = line.text.replace(/\s+/g, '')
    const duplicate = result.find(existing => {
      const a = existing.bounds, b = line.bounds
      const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
      const overlap = intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height))
      const previous = existing.text.replace(/\s+/g, '')
      return overlap > .65 && (previous.includes(normalized) || normalized.includes(previous))
    })
    if (!duplicate) result.push(line)
    else if (line.text.length > duplicate.text.length) Object.assign(duplicate, line)
  }
  return result.sort((a, b) => Math.abs(a.bounds.y - b.bounds.y) < Math.min(a.bounds.height, b.bounds.height) * .45 ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y)
}

function runOfflineOcr(buffer, language, langPath, gzip, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('文字识别已取消'))
    const worker = new Worker(unpacked(path.join(__dirname, 'ocr-worker.cjs')), {
      workerData: { buffer, language, langPath, gzip, modulePath: unpacked(require.resolve('tesseract.js')) },
    })
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort)
      worker.terminate().catch(() => {})
      error ? reject(error) : resolve(value)
    }
    const abort = () => finish(new Error('文字识别已取消'))
    const timer = setTimeout(() => finish(new Error('离线文字识别超时，请缩小图片后重试')), 120000)
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', result => result.error ? finish(new Error('离线文字识别失败，请检查安装文件是否完整')) : finish(null, result))
    worker.once('error', () => finish(new Error('无法启动离线文字识别引擎，请重新安装软件')))
    worker.once('exit', () => { if (!settled) finish(new Error('离线文字识别进程意外结束')) })
  })
}

function validatePngBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.length > 96 * 1024 * 1024 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('识别图片数据无效')
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20)
  if (!width || !height || width > 32768 || height > 32768 || width * height > 100000000) throw new Error('识别图片尺寸超出支持范围')
  return { width, height }
}

function createOcrService({ app, nativeRunner = runNativeOcr, preferNative = true, modelPath } = {}) {
  let capabilitiesPromise
  let nativeCapabilities = { available: false, languages: [] }
  let offlineAvailable = false, gzip = true, busy = false, disposed = false
  const controllers = new Set()
  const langPath = modelPath || (app?.isPackaged ? path.join(process.resourcesPath, 'ocr') : path.join(__dirname, '../resources/ocr'))
  async function checkModels(extension) {
    try { await Promise.all(['eng', 'chi_sim'].map(async name => { const stat = await fs.stat(path.join(langPath, name + extension)); if (stat.size < 100000) throw new Error('MODEL_INVALID') })); return true } catch { return false }
  }
  const service = {
    async capabilities() {
      if (disposed) throw new Error('文字识别服务已关闭')
      if (!capabilitiesPromise) capabilitiesPromise = (async () => {
        const controller = new AbortController(); controllers.add(controller)
        try {
          const [native, compressed] = await Promise.all([
            preferNative && process.platform === 'win32' ? nativeRunner('capabilities', undefined, undefined, controller.signal).catch(() => ({ available: false, languages: [] })) : Promise.resolve({ available: false, languages: [] }),
            checkModels('.traineddata.gz'),
          ])
          nativeCapabilities = native
          gzip = compressed
          offlineAvailable = compressed || await checkModels('.traineddata')
          const languages = native.available ? [...native.languages] : []
          if (offlineAvailable) for (const item of [{ tag: 'zh-Hans-CN', name: '简体中文 + 英文' }, { tag: 'en-US', name: '英语' }]) {
            if (!languages.some(existing => existing.tag === item.tag)) languages.push(item)
          }
          if (languages.length) languages.unshift({ tag: 'auto', name: '自动（中文 / 英文优先）' })
          return { available: languages.length > 0, languages, ...(!native.available ? { reason: offlineAvailable ? '使用内置离线识别引擎，无需联网' : '未找到本地文字识别引擎，请重新安装软件' } : {}) }
        } finally { controllers.delete(controller) }
      })()
      return capabilitiesPromise
    },
    async recognize(buffer, language = 'auto') {
      if (disposed) throw new Error('文字识别服务已关闭')
      if (busy) throw new Error('已有文字识别任务正在进行，请稍候')
      if (typeof language !== 'string' || !/^[A-Za-z0-9-]{2,40}$/.test(language)) throw new Error('识别语言无效')
      const size = validatePngBuffer(buffer)
      busy = true
      const controller = new AbortController(); controllers.add(controller)
      let directory
      try {
        const available = await service.capabilities()
        if (controller.signal.aborted) throw new Error('文字识别已取消')
        if (!available.available) throw new Error(available.reason)
        if (!available.languages.some(item => item.tag === language)) throw new Error('不支持所选识别语言')
        const nativeLanguage = language === 'auto' ? (nativeCapabilities.languages.find(item => item.tag === 'zh-Hans-CN')?.tag || (!offlineAvailable ? nativeCapabilities.languages[0]?.tag : undefined)) : language
        let result
        if (nativeCapabilities.available && nativeCapabilities.languages.some(item => item.tag === nativeLanguage)) {
          directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fanhua-ocr-'))
          const input = path.join(directory, 'input.png')
          await fs.writeFile(input, buffer)
          try { result = await nativeRunner('recognize', input, nativeLanguage, controller.signal) }
          catch (error) { if (controller.signal.aborted || !offlineAvailable || !['auto', 'zh-Hans-CN', 'en-US'].includes(language)) throw error }
        }
        if (!result) {
          if (!offlineAvailable) throw new Error('未找到所选语言的本地识别引擎')
          result = await runOfflineOcr(buffer, language, langPath, gzip, controller.signal)
        }
        const lines = deduplicateLines(result.lines || [])
        return { text: lines.map(line => line.text).join('\n'), lines, language: result.language, ...size }
      } finally {
        busy = false; controllers.delete(controller)
        if (directory) {
          await fs.unlink(path.join(directory, 'input.png')).catch(() => {})
          await fs.rmdir(directory).catch(() => {})
        }
      }
    },
    dispose() { disposed = true; for (const controller of controllers) controller.abort(); controllers.clear() },
  }
  return service
}

module.exports = { createOcrService, deduplicateLines, normalizeText, runNativeOcr, validatePngBuffer }
