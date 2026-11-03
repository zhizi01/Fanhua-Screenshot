'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { fork } = require('node:child_process')
const { DIRECTIONS, validateTranslationRequest } = require('./translation-text.cjs')
const unpacked = file => file.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
const REQUIRED_FILES = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']

function createTranslationService({ modelRoot, idleMs = 60000, forkProcess = (file, options) => fork(file, [], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: options.execArgv }) } = {}) {
  let worker, active, idleTimer, disposed = false
  let stopping = Promise.resolve()
  const states = new WeakMap()
  const postMessage = (child, message) => child.postMessage ? child.postMessage(message) : child.send(message)

  async function getCapabilities() {
    if (disposed) return { available: false, directions: [], reason: '翻译服务已关闭' }
    try { require.resolve('@huggingface/transformers') }
    catch { return { available: false, directions: [], reason: '本地翻译引擎缺失，请重新安装软件' } }
    if (!modelRoot || !path.isAbsolute(modelRoot)) return { available: false, directions: [], reason: '本地翻译模型目录无效' }
    const directions = (await Promise.all(DIRECTIONS.map(async direction => {
      try {
        await Promise.all(REQUIRED_FILES.map(async file => {
          const stat = await fs.stat(path.join(modelRoot, 'Xenova', `opus-mt-${direction}`, file))
          if (!stat.isFile() || stat.size <= 0) throw new Error('MODEL_MISSING')
        }))
        return direction
      } catch { return null }
    }))).filter(Boolean)
    return { available: directions.length > 0, directions, ...(directions.length ? {} : { reason: '中英翻译模型缺失，请重新安装完整版本' }) }
  }

  function stopWorker() {
    clearTimeout(idleTimer)
    const previous = worker
    worker = undefined
    if (previous) {
      const state = states.get(previous)
      const terminated = new Promise(resolve => {
        if (state.exited) return resolve()
        let timer
        const done = () => { clearTimeout(timer); state.resolveStop = undefined; resolve() }
        const kill = () => {
          if (state.exited) return done()
          try {
            if (previous.kill() === false && state.spawned) done()
          } catch { done() }
        }
        state.resolveStop = done
        // A UtilityProcess has no pid until its spawn event. Killing too early
        // must not leave a newly spawned, unowned ONNX process running.
        if (state.spawned || previous.pid) kill()
        else previous.once('spawn', kill)
        timer = setTimeout(() => { kill(); done() }, 5000)
        timer.unref?.()
      })
      stopping = Promise.allSettled([stopping, terminated]).then(() => {})
    }
    return stopping
  }

  function finish(error, result) {
    const current = active
    if (!current) return
    active = undefined
    clearTimeout(current.timeout); clearTimeout(current.deadline)
    if (error) { void stopWorker(); current.reject(error) }
    else {
      idleTimer = setTimeout(() => { if (!active) void stopWorker() }, idleMs)
      idleTimer.unref?.()
      current.resolve(result)
    }
  }

  function touchTimeout() {
    if (!active) return
    clearTimeout(active.timeout)
    active.timeout = setTimeout(() => finish(new Error('本地翻译等待超时，请缩短段落后重试')), 120000)
    active.timeout.unref?.()
  }

  async function startWorker() {
    await stopping
    if (disposed || !active) throw new Error('TRANSLATION_CANCELED')
    if (worker) return worker
    const instance = forkProcess(unpacked(path.join(__dirname, 'translation-worker.cjs')), {
      serviceName: '繁花有图本地翻译', stdio: 'inherit', execArgv: [],
    })
    const state = { exited: false, spawned: false, resolveStop: undefined }
    states.set(instance, state)
    worker = instance
    instance.on('spawn', () => { state.spawned = true })
    instance.on('message', message => {
      if (worker !== instance || !active || message?.requestId !== active.request.requestId) return
      if (message.type === 'progress') {
        touchTimeout()
        try { active.onProgress?.(message.event) } catch { /* A closed renderer cannot break inference cleanup. */ }
      } else if (message.type === 'result') finish(null, message.result)
      else if (message.type === 'error') finish(new Error(message.error || '本地翻译失败，请重试'))
    })
    instance.on('error', () => {
      if (!instance.pid) { state.exited = true; state.resolveStop?.() }
      if (worker !== instance) return
      if (active) finish(new Error('本地翻译引擎启动失败，请检查安装文件后重试'))
      else void stopWorker()
    })
    instance.on('exit', () => {
      state.exited = true; state.resolveStop?.()
      if (worker !== instance) return
      if (active) finish(new Error('本地翻译进程意外结束，请重试'))
      else void stopWorker()
    })
    postMessage(instance, { type: 'init', config: { modelRoot, modulePath: unpacked(require.resolve('@huggingface/transformers')), threads: 2 } })
    return instance
  }

  async function translate(input, { ownerId, onProgress } = {}) {
    const request = validateTranslationRequest(input)
    if (disposed) throw new Error('翻译服务已关闭')
    if (active) throw new Error('正在处理其他翻译任务，请稍后重试')
    clearTimeout(idleTimer)
    return new Promise((resolve, reject) => {
      const current = { request, ownerId, onProgress, resolve, reject }
      active = current
      touchTimeout()
      current.deadline = setTimeout(() => { if (active === current) finish(new Error('本次翻译耗时过长，请分批翻译')) }, 10 * 60 * 1000)
      current.deadline.unref?.()
      ;(async () => {
        const capabilities = await getCapabilities()
        if (active !== current) return
        if (!capabilities.directions.includes(request.direction)) throw new Error(capabilities.reason || '所选方向的翻译模型缺失，请重新安装完整版本')
        const instance = await startWorker()
        if (active === current) postMessage(instance, request)
        else if (!active) void stopWorker()
      })().catch(error => { if (active === current) finish(error instanceof Error ? error : new Error('本地翻译引擎不可用，请检查安装文件后重试')) })
    })
  }

  function cancel(requestId, ownerId) {
    if (!active || active.ownerId !== ownerId || active.request.requestId !== requestId) return false
    finish(new Error('翻译已取消'))
    return true
  }
  function cancelOwner(ownerId) {
    if (active?.ownerId !== ownerId) return false
    return active ? cancel(active.request.requestId, ownerId) : false
  }
  async function dispose() {
    disposed = true
    if (active) finish(new Error('翻译服务已关闭'))
    await stopWorker()
  }
  return { getCapabilities, translate, cancel, cancelOwner, dispose }
}

module.exports = { createTranslationService }
