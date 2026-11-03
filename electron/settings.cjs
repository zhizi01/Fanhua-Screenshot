'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const DEFAULT_SETTINGS = Object.freeze({
  startupNotification: true, contextMenuEnabled: false, captureOpenEditor: false,
  ocrLanguage: 'auto', translationDirection: 'en-zh', imageFormat: 'png', imageQuality: 92, pdfScope: 'all',
  editor: Object.freeze({ font: 'Microsoft YaHei UI', size: 28, color: '#ef5c68', markerStyle: 'number', markerHeadSize: 50, arrowLineWidth: 4, arrowHeadSize: 22, shapeLineWidth: 3, shapeBorderStyle: 'solid', mosaicStrength: 18 }),
})
const MAX_SETTINGS_BYTES = 64 * 1024
const clone = value => JSON.parse(JSON.stringify(value))
const record = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const numeric = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
const editorValidators = {
  font: value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value),
  size: value => numeric(value, 8, 200), color: value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value),
  markerStyle: value => ['number', 'letter', 'chinese'].includes(value), markerHeadSize: value => numeric(value, 16, 240),
  arrowLineWidth: value => numeric(value, 1, 40), arrowHeadSize: value => numeric(value, 6, 160), shapeLineWidth: value => numeric(value, 1, 40),
  shapeBorderStyle: value => ['solid', 'dashed', 'dotted'].includes(value), mosaicStrength: value => numeric(value, 4, 64),
}
const validators = {
  startupNotification: value => typeof value === 'boolean', contextMenuEnabled: value => typeof value === 'boolean', captureOpenEditor: value => typeof value === 'boolean',
  ocrLanguage: value => typeof value === 'string' && /^[A-Za-z0-9-]{2,40}$/.test(value),
  translationDirection: value => ['en-zh', 'zh-en'].includes(value), imageFormat: value => ['png', 'jpeg', 'webp', 'bmp', 'pdf'].includes(value),
  imageQuality: value => numeric(value, 10, 100), pdfScope: value => ['all', 'current'].includes(value),
}

function validatePatch(patch) {
  if (!record(patch)) throw new Error('设置内容无效')
  for (const key of Object.keys(patch)) {
    if (key === 'editor') {
      if (!record(patch.editor)) throw new Error('标注默认值无效')
      for (const field of Object.keys(patch.editor)) {
        if (!Object.hasOwn(editorValidators, field) || !editorValidators[field](patch.editor[field])) throw new Error(`标注设置 ${field} 超出支持范围`)
      }
    } else if (!Object.hasOwn(validators, key) || !validators[key](patch[key])) throw new Error(`设置 ${key} 无效或超出支持范围`)
  }
  return clone(patch)
}

function merge(current, patch) { return { ...current, ...patch, editor: { ...current.editor, ...patch.editor } } }

function createSettingsStore({ directory, contextMenu, fileSystem = fs, onChanged = () => {} }) {
  const file = path.join(directory, 'settings.json')
  let value = clone(DEFAULT_SETTINGS), ready, tail = Promise.resolve(), loadError = '', stopping = false

  async function initialize() {
    if (ready) return ready
    ready = (async () => {
      let handle
      try {
        handle = await fileSystem.open(file, 'r')
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) throw new Error('设置文件无效或过大')
        const buffer = Buffer.alloc(MAX_SETTINGS_BYTES + 1)
        let length = 0
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
          if (!bytesRead) break
          length += bytesRead
        }
        if (length > MAX_SETTINGS_BYTES) throw new Error('设置文件过大')
        const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))
        const data = JSON.parse(content)
        if (!record(data) || data.version !== 1 || !record(data.settings)) throw new Error('设置文件版本或格式无效')
        value = merge(DEFAULT_SETTINGS, validatePatch(data.settings))
      } catch (error) {
        if (error.code !== 'ENOENT') loadError = '无法读取已保存的设置，当前使用默认值；请检查设置目录权限或重新保存设置'
      } finally { await handle?.close().catch(() => {}) }
      return clone(value)
    })()
    return ready
  }

  async function persist(next) {
    await fileSystem.mkdir(directory, { recursive: true })
    const temp = path.join(directory, `.settings-${randomUUID()}.tmp`)
    let handle, created = false
    try {
      handle = await fileSystem.open(temp, 'wx', 0o600); created = true
      await handle.writeFile(JSON.stringify({ version: 1, settings: next }, null, 2) + '\n', 'utf8')
      await handle.sync()
      await handle.close(); handle = null
      await fileSystem.rename(temp, file)
      created = false
    } finally {
      await handle?.close().catch(() => {})
      if (created) await fileSystem.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  }

  function update(patch) {
    let clean
    try { clean = validatePatch(patch) } catch (error) { return Promise.reject(error) }
    if (stopping) return Promise.reject(new Error('应用正在退出，无法修改设置'))
    const result = tail.then(async () => {
      await initialize()
      if (stopping) throw new Error('应用正在退出，无法修改设置')
      const next = merge(value, clean)
      let transaction
      try {
        if (Object.hasOwn(clean, 'contextMenuEnabled')) transaction = await contextMenu.beginChange(clean.contextMenuEnabled)
        await persist(next)
      } catch (error) {
        let rollbackError
        if (transaction) { try { await transaction.rollback() } catch (failure) { rollbackError = failure } }
        if (rollbackError) {
          loadError = '设置未保存，且右键菜单未能完全恢复；请查看右键菜单实际状态后重试'
          throw new Error(loadError)
        }
        if (transaction) throw new Error('设置保存失败，右键菜单已恢复；请检查设置目录权限和磁盘空间')
        if (Object.hasOwn(clean, 'contextMenuEnabled')) throw error
        throw new Error('设置保存失败，请检查设置目录权限和磁盘空间')
      }
      value = next; loadError = ''
      const snapshot = clone(value)
      // Persistence succeeded even if a renderer disappeared during broadcast.
      try { onChanged(clone(snapshot)) } catch { /* Delivery is best-effort. */ }
      return snapshot
    })
    tail = result.catch(() => {})
    return result
  }

  return {
    initialize, update,
    // A slow system integration write must not block opening a new screenshot.
    // Readers receive the last fully committed snapshot while updates serialize.
    async get() { await initialize(); return clone(value) },
    snapshot: () => clone(value),
    getError: () => loadError,
    async dispose() { stopping = true; await tail },
  }
}

module.exports = { createSettingsStore, DEFAULT_SETTINGS, validatePatch }
