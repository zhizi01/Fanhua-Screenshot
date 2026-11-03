'use strict'

const DEFAULT_SHORTCUT = 'Alt+A'
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super']
const MODIFIER_ALIASES = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Super', win: 'Super' }
const KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`), 'Space', 'Tab', 'Enter', 'Backspace', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'PrintScreen']
const KEY_ALIASES = Object.fromEntries(KEYS.map(key => [key.toLowerCase(), key]))
KEY_ALIASES.return = 'Enter'
KEY_ALIASES['空格'] = 'Space'

function normalizeShortcut(value) {
  if (typeof value !== 'string' || value.length > 128 || !value.trim()) throw new Error('请选择有效的截图快捷键')
  const tokens = value.split('+').map(part => part.trim().toLowerCase())
  if (tokens.some(token => !token)) throw new Error('快捷键必须包含一个主键，不能重复加号')
  const modifiers = new Set()
  let main
  for (const token of tokens) {
    if (Object.hasOwn(MODIFIER_ALIASES, token)) {
      const modifier = MODIFIER_ALIASES[token]
      if (modifiers.has(modifier)) throw new Error('快捷键不能重复使用同一个修饰键')
      modifiers.add(modifier)
    } else {
      if (!Object.hasOwn(KEY_ALIASES, token)) throw new Error('不支持此快捷键主键；Escape 保留用于取消截图')
      if (main) throw new Error('快捷键只能包含一个主键')
      main = KEY_ALIASES[token]
    }
  }
  if (!main) throw new Error('快捷键必须包含一个主键')
  if (!/^F(?:[1-9]|1\d|2[0-4])$/.test(main) && main !== 'PrintScreen' && !['Ctrl', 'Alt', 'Super'].some(modifier => modifiers.has(modifier))) throw new Error('字符和导航键需要同时选择 Ctrl、Alt 或 Win，避免影响日常输入')
  return [...MODIFIERS.filter(modifier => modifiers.has(modifier)), main].join('+')
}

function formatShortcut(value) { return normalizeShortcut(value).split('+').map(part => part === 'Super' ? 'Win' : part).join(' + ') }

function createShortcutService({ globalShortcut, onCapture, onChanged = () => {} }) {
  const owned = new Map()
  let shortcut = DEFAULT_SHORTCUT, active = null, pending = null, initialized = false, disposed = false, reason = '', recoveryFailure = ''
  function ensureAvailable() {
    if (disposed) throw new Error('应用正在退出，无法修改截图快捷键')
    if (recoveryFailure) throw new Error(recoveryFailure)
  }
  function registered(binding) { return !!binding && owned.get(binding.key) === binding && globalShortcut.isRegistered(binding.key) }
  function getState() {
    let isRegistered = false, failure = reason
    if (!disposed) {
      try { isRegistered = registered(active) }
      catch { failure = '无法读取系统快捷键状态，请稍后重试' }
    }
    return { shortcut, shortcutRegistered: isRegistered, ...(recoveryFailure || !isRegistered ? { shortcutReason: recoveryFailure || failure || (disposed ? '应用正在退出' : '快捷键暂时无法启用，请解除冲突后重试') } : {}) }
  }
  function changed() { try { onChanged(getState()) } catch { /* Tray refresh cannot undo a completed binding. */ } }
  function remove(binding) {
    if (!binding || owned.get(binding.key) !== binding) return
    if (globalShortcut.isRegistered(binding.key)) globalShortcut.unregister(binding.key)
    if (globalShortcut.isRegistered(binding.key)) throw new Error(`无法释放 ${formatShortcut(binding.key)}，请重试或重新启动应用`)
    binding.live = false
    owned.delete(binding.key)
  }
  function reserve(key) {
    ensureAvailable()
    const binding = { key, live: false }
    try {
      const abandoned = owned.get(key)
      if (abandoned && abandoned !== active && !abandoned.live) remove(abandoned)
      if (globalShortcut.isRegistered(key)) throw new Error(`${formatShortcut(key)} 已被本程序其他功能使用`)
      if (!globalShortcut.register(key, () => {
        if (!disposed && active === binding && binding.live) onCapture()
      })) throw new Error(`${formatShortcut(key)} 暂时无法注册，可能被其他应用或系统占用；原快捷键保持不变`)
      owned.set(key, binding)
      if (!globalShortcut.isRegistered(key)) throw new Error(`${formatShortcut(key)} 未能完成系统注册；原快捷键保持不变`)
      ensureAvailable()
      return binding
    } catch (error) {
      if (owned.get(key) === binding) {
        try { remove(binding) } catch { /* Keep ownership so dispose can retry. */ }
      }
      if (error instanceof Error && /快捷键|占用|使用|注册|退出/.test(error.message)) throw error
      throw new Error(`系统未能注册 ${formatShortcut(key)}，原快捷键保持不变，请重试`)
    }
  }

  function beginChange(value) {
    ensureAvailable()
    if (!initialized) throw new Error('快捷键服务尚未准备完成')
    if (pending) throw new Error('正在保存快捷键设置，请稍后重试')
    const next = normalizeShortcut(value)
    let previousRegistered
    try { previousRegistered = registered(active) }
    catch { throw new Error('无法读取原快捷键状态，未修改设置，请稍后重试') }
    const previous = { shortcut, binding: active, registered: previousRegistered, reason }
    const candidate = next === shortcut && previous.registered ? active : reserve(next)
    const transaction = { state: 'pending' }
    pending = transaction
    return {
      commit() {
        ensureAvailable()
        if (transaction.state === 'committed') return getState()
        if (transaction.state !== 'pending' || pending !== transaction) throw new Error('快捷键修改已取消，请重新设置')
        if (!registered(candidate)) throw new Error('候选快捷键已失效，原设置未改变，请重试')
        if (previous.binding !== candidate && previous.binding?.key !== candidate.key) remove(previous.binding)
        if (previous.binding && previous.binding !== candidate) previous.binding.live = false
        active = candidate; candidate.live = true; shortcut = next; reason = ''
        transaction.state = 'committed'; pending = null
        changed()
        return getState()
      },
      rollback() {
        if (transaction.state === 'rolledBack') return
        if (transaction.state === 'failed') throw new Error(recoveryFailure)
        try {
          let restored = previous.binding
          if (!disposed && previous.registered && !registered(restored)) restored = reserve(previous.shortcut)
          if (!disposed) {
            active = restored
            if (active) active.live = previous.registered
            shortcut = previous.shortcut; reason = previous.reason
          }
          if (candidate !== restored && owned.get(candidate.key) === candidate) {
            candidate.live = false
            remove(candidate)
          }
          transaction.state = 'rolledBack'
        } catch {
          transaction.state = 'failed'
          recoveryFailure = '上次快捷键恢复失败，请完全退出应用后重试'
          reason = recoveryFailure
          throw new Error(recoveryFailure)
        } finally {
          // A failed native release must not strand the UI in a permanent saving state.
          // Keep ownership of unreleased bindings so dispose can retry their cleanup.
          if (pending === transaction) pending = null
          changed()
        }
      },
    }
  }
  function retry() {
    ensureAvailable()
    if (!initialized) throw new Error('快捷键服务尚未准备完成')
    if (pending) throw new Error('正在保存快捷键设置，请稍后重试')
    let transaction
    try { transaction = beginChange(shortcut); transaction.commit() }
    catch (error) {
      let rollbackFailed = false
      try { transaction?.rollback() } catch { rollbackFailed = true }
      reason = rollbackFailed ? '快捷键恢复失败，请完全退出应用后重试' : error.message || '快捷键暂时无法启用，请重试'
      changed()
    }
    return getState()
  }
  function initialize(value) {
    ensureAvailable()
    if (initialized) throw new Error('快捷键服务已初始化')
    shortcut = normalizeShortcut(value)
    initialized = true
    return retry()
  }
  function dispose() {
    disposed = true
    if (active) active.live = false
    active = null; pending = null
    const errors = []
    for (const binding of [...owned.values()]) { try { remove(binding) } catch (error) { errors.push(error) } }
    changed()
    if (errors.length) throw new Error('部分截图快捷键未能释放，请完全退出应用')
  }
  return { initialize, getState, beginChange, retry, dispose }
}

module.exports = { DEFAULT_SHORTCUT, normalizeShortcut, formatShortcut, createShortcutService }
