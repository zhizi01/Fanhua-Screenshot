import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { NativeHelper } = require('../../electron/native-helper.cjs')
const { watchCaptureWindow } = require('../../electron/capture-lifecycle.cjs')

class HelperProcess extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  killed = false
  kill() { this.killed = true; return true }
}

describe('原生窗口服务异常恢复', () => {
  it('stdin EPIPE 拒绝待处理请求，不泄漏未处理错误，且允许重新启动', async () => {
    const first = new HelperProcess()
    const second = new HelperProcess()
    const children = [first, second]
    const helper = new NativeHelper({ platform: 'win32', spawnProcess: () => children.shift() })
    const startup = helper.start()
    first.stdout.write('{"ready":true}\n')
    await startup

    const request = helper.request('windows')
    const rejected = expect(request).rejects.toThrow('EPIPE')
    await Promise.resolve()
    first.stdin.emit('error', new Error('EPIPE'))
    await rejected
    expect(first.killed).toBe(true)
    expect(helper.pending.size).toBe(0)
    expect(helper.child).toBeNull()

    const restart = helper.start()
    second.stdout.write('{"ready":true}\n')
    await restart
    const nextRequest = helper.request('fonts')
    await Promise.resolve()
    // The previous child's late exit must not reject the new child's request.
    first.emit('exit', 1)
    second.stdout.write('{"id":2,"data":["Arial"]}\n')
    await expect(nextRequest).resolves.toEqual(['Arial'])
    helper.stop()
  })
})

describe('截图渲染进程异常恢复', () => {
  it.each(['render-process-gone', 'unresponsive'])('展示期间的 %s 恢复所属会话', eventName => {
    const win = Object.assign(new EventEmitter(), { webContents: new EventEmitter() })
    const active = { finishing: false }
    const recovered: unknown[] = []
    watchCaptureWindow(win, () => ({ session: active }), () => active, (session: unknown) => {
      recovered.push(session)
      active.finishing = true
    })
    if (eventName === 'render-process-gone') win.webContents.emit(eventName, {}, { reason: 'crashed' })
    else win.emit(eventName)
    expect(recovered).toEqual([active])
    win.emit('unresponsive')
    expect(recovered).toHaveLength(1)
  })

  it('已关闭或旧会话遮罩的迟到事件不取消新截图', () => {
    const win = Object.assign(new EventEmitter(), { webContents: new EventEmitter() })
    const previous = { finishing: false }
    const current = { finishing: false }
    let capture: { session: typeof previous } | undefined = { session: previous }
    let recoveries = 0
    watchCaptureWindow(win, () => capture, () => current, () => recoveries++)
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    capture = undefined
    win.emit('unresponsive')
    expect(recoveries).toBe(0)
  })
})

describe.skipIf(process.platform !== 'win32')('Windows 无标题窗口与透明遮罩筛选', () => {
  it('保留无标题菜单/工具窗，过滤可穿透透明遮罩并提供标题回退', () => {
    const source = readFileSync(new URL('../../electron/native/windows.ps1', import.meta.url), 'utf8')
    const csharp = source.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@/)?.[1]
    expect(csharp).toBeTruthy()
    const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\nAdd-Type -TypeDefinition @'\n${csharp}\n'@\n@([FanhuaNative]::IsPassiveOverlay(0), [FanhuaNative]::IsPassiveOverlay(128), [FanhuaNative]::IsPassiveOverlay(524320), [FanhuaNative]::IsPassiveOverlay(134217760), [FanhuaNative]::DisplayTitle('', '#32768'), [FanhuaNative]::DisplayTitle('', '')) | ConvertTo-Json -Compress`
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual([false, false, true, true, '#32768', '未命名窗口'])
  }, 20000)
})
