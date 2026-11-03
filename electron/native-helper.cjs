'use strict'
const { spawn } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')

class NativeHelper {
  constructor({ spawnProcess = spawn, platform = process.platform } = {}) {
    this.spawnProcess = spawnProcess
    this.platform = platform
    this.child = null
    this.pending = new Map()
    this.nextId = 0
    this.ready = null
    this.failChild = null
  }

  start() {
    if (this.platform !== 'win32') return Promise.reject(new Error('当前系统不支持原生窗口识别'))
    if (this.ready) return this.ready
    this.ready = new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'native', 'windows.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
      const child = this.spawnProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      let ready = false
      let failed = false
      let stderr = ''
      const timeout = setTimeout(() => {
        fail(new Error('窗口识别服务启动超时'))
      }, 10000)
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4000) })
      const lines = readline.createInterface({ input: child.stdout })
      lines.on('line', line => {
        if (failed) return
        try {
          const message = JSON.parse(line.replace(/^\uFEFF/, ''))
          if (message.ready) {
            ready = true
            clearTimeout(timeout)
            resolve()
            return
          }
          const pending = this.pending.get(message.id)
          if (!pending) return
          this.pending.delete(message.id)
          clearTimeout(pending.timer)
          if (message.error) pending.reject(new Error(message.error))
          else pending.resolve(message.data)
        } catch { /* Only JSON protocol messages are handled. */ }
      })
      const fail = error => {
        if (failed) return
        failed = true
        clearTimeout(timeout)
        if (!ready) reject(error)
        for (const [id, pending] of this.pending) {
          if (pending.child !== child) continue
          clearTimeout(pending.timer)
          pending.reject(error)
          this.pending.delete(id)
        }
        if (this.child === child) { this.child = null; this.ready = null; this.failChild = null }
        lines.close()
        if (!child.killed && child.exitCode === null) child.kill()
      }
      this.failChild = fail
      // A pipe error is emitted independently of the write callback. Keep an
      // explicit listener so a helper exiting mid-request cannot crash Electron.
      child.stdin.on('error', fail)
      child.stdout.on('error', fail)
      child.stderr.on('error', fail)
      child.once('error', fail)
      child.once('exit', () => fail(new Error(stderr || '窗口识别服务已退出')))
    })
    return this.ready
  }

  async request(command, extra = {}) {
    await this.start()
    const child = this.child
    const fail = this.failChild
    if (!child || !fail || child.killed || child.stdin.destroyed || !child.stdin.writable) {
      throw new Error('窗口识别服务已断开')
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('窗口识别服务响应超时'))
      }, 5000)
      this.pending.set(id, { resolve, reject, timer, child })
      try {
        child.stdin.write(JSON.stringify({ id, command, ...extra }) + '\n', error => {
          if (error) fail(error)
        })
      } catch (error) { fail(error) }
    })
  }

  stop() {
    if (this.failChild) this.failChild(new Error('窗口识别服务已停止'))
  }
}

module.exports = { NativeHelper }
