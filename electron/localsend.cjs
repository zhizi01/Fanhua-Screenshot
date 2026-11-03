'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { decodePngDataUrl } = require('./geometry.cjs')

const runFile = promisify(execFile)
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const OWN_FILE = /^繁花有图-\d{14}-[a-f0-9-]{36}\.png$/
const EXECUTABLE_NAME = /^(?:localsend_app|localsend)\.exe$/i

// Fixed script only. File paths are returned as JSON, never executed as shell text.
const DISCOVERY_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$candidates = New-Object System.Collections.Generic.List[string]
Get-Process -Name localsend_app,localsend | ForEach-Object { if ($_.Path) { $candidates.Add($_.Path) } }
foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths')) {
  foreach ($name in @('localsend_app.exe','localsend.exe')) {
    $value = (Get-Item -LiteralPath "$root\$name").GetValue('')
    if ($value) { $candidates.Add([string]$value) }
  }
}
Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -like '*LocalSend*' } | ForEach-Object {
  if ($_.InstallLocation) { $candidates.Add((Join-Path $_.InstallLocation 'localsend_app.exe')) }
  if ($_.DisplayIcon) { $candidates.Add(([string]$_.DisplayIcon -replace ',\s*-?\d+$','').Trim('"')) }
}
foreach ($root in @('HKCU:\Software\Classes\*\shell\LocalSend\command','HKLM:\Software\Classes\*\shell\LocalSend\command')) {
  $value = (Get-Item -LiteralPath $root).GetValue('')
  if ($value -match '^"([^"\r\n]+\.exe)"') { $candidates.Add($Matches[1]) }
}
ConvertTo-Json -InputObject @($candidates | Select-Object -Unique) -Compress
`

async function validExecutable(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.length > 32760 || !EXECUTABLE_NAME.test(path.basename(file))) return false
  let handle
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size < 64) return false
    handle = await fs.open(file, 'r')
    const header = Buffer.alloc(2)
    await handle.read(header, 0, 2, 0)
    return header.toString('ascii') === 'MZ'
  } catch { return false }
  finally { await handle?.close().catch(() => {}) }
}

async function discoverLocalSend(env = process.env) {
  const candidates = []
  try {
    const { stdout } = await runFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(DISCOVERY_SCRIPT, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 7000, maxBuffer: 128 * 1024, encoding: 'utf8',
    })
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
    if (Array.isArray(result)) candidates.push(...result)
  } catch { /* Portable installations remain selectable through the file dialog. */ }
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.LOCALAPPDATA]) {
    if (root) candidates.push(path.join(root, 'LocalSend', 'localsend_app.exe'))
  }
  for (const file of [...new Set(candidates)]) if (await validExecutable(file)) return path.resolve(file)
  return null
}

function launchLocalSend(executable, imagePath, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let child, settled = false, timer
    const finish = error => {
      if (settled) return
      settled = true; clearTimeout(timer)
      child?.unref()
      error ? reject(error) : resolve()
    }
    try {
      child = spawnProcess(executable, [imagePath], {
        cwd: path.dirname(executable), shell: false, windowsHide: true, detached: true, stdio: 'ignore',
      })
      child.once('error', () => finish(new Error('无法启动 LocalSend，请检查主程序位置或重新安装 LocalSend')))
      child.once('spawn', () => { timer = setTimeout(() => finish(), 750) })
      child.once('exit', (code, signal) => {
        // A second LocalSend instance exits successfully after forwarding the
        // argument to the existing GUI. Do not treat that normal path as failure.
        finish(code === 0 && !signal ? undefined : new Error('LocalSend 启动失败，请确认它可以正常打开'))
      })
    } catch { finish(new Error('无法启动 LocalSend，请重新选择主程序')) }
  })
}

function createLocalSendService({ app, dialog, nativeImage, platform = process.platform, discover = discoverLocalSend, spawnProcess = spawn }) {
  const directory = path.resolve(app.getPath('temp'), 'fanhua-localsend')
  const settings = path.resolve(app.getPath('userData'), 'localsend.json')
  let busy = false

  async function initialize() {
    await fs.mkdir(directory, { recursive: true })
    const directoryStat = await fs.lstat(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('LocalSend 临时共享目录不可用')
    const now = Date.now()
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !OWN_FILE.test(entry.name)) continue
      const file = path.resolve(directory, entry.name)
      if (path.dirname(file) !== directory) continue
      const stat = await fs.lstat(file).catch(() => null)
      if (stat?.isFile() && !stat.isSymbolicLink() && now - stat.mtimeMs > MAX_AGE) await fs.unlink(file).catch(() => {})
    }
  }

  async function storedExecutable() {
    try {
      if ((await fs.stat(settings)).size > 16 * 1024) return null
      const value = JSON.parse(await fs.readFile(settings, 'utf8'))
      if (value.version === 1 && await validExecutable(value.executable)) return value.executable
    } catch { /* An invalid old setting must not block selecting the program. */ }
    return null
  }

  async function rememberExecutable(executable) {
    const temporary = `${settings}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(path.dirname(settings), { recursive: true })
      await fs.writeFile(temporary, JSON.stringify({ version: 1, executable }) + '\n', { flag: 'wx', encoding: 'utf8' })
      await fs.rename(temporary, settings)
    } catch { /* Sharing still works if remembering the optional path fails. */ }
    finally { await fs.unlink(temporary).catch(() => {}) }
  }

  async function executableFor(win) {
    const known = await storedExecutable() || await discover()
    if (known && await validExecutable(known)) return known
    const selected = await dialog.showOpenDialog(win, {
      title: '未找到 LocalSend，请选择已安装的 localsend_app.exe（取消可返回）',
      buttonLabel: '使用 LocalSend', properties: ['openFile'],
      filters: [{ name: 'LocalSend 主程序', extensions: ['exe'] }],
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    const file = path.resolve(selected.filePaths[0])
    if (!await validExecutable(file)) throw new Error('请选择 LocalSend 主程序 localsend_app.exe，而不是安装包或卸载程序')
    await rememberExecutable(file)
    return file
  }

  async function share(win, dataUrl) {
    if (platform !== 'win32') throw new Error('通过 LocalSend 共享目前仅支持 Windows 桌面版')
    if (busy) throw new Error('正在准备 LocalSend 共享，请稍后重试')
    busy = true
    let file
    try {
      // Accept only an already-composed PNG; never arbitrary paths from IPC.
      const bytes = decodePngDataUrl(dataUrl)
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) throw new Error('共享图片解码失败')
      const executable = await executableFor(win)
      if (!executable) return { canceled: true }
      if (win?.isDestroyed?.()) return { canceled: true }
      await initialize()
      const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
      const fileName = `繁花有图-${timestamp}-${randomUUID()}.png`
      file = path.join(directory, fileName)
      await fs.writeFile(file, bytes, { flag: 'wx' })
      await launchLocalSend(executable, file, spawnProcess)
      return { canceled: false, fileName }
    } catch (error) {
      if (file) await fs.unlink(file).catch(() => {})
      throw error
    } finally { busy = false }
  }

  return { initialize, share }
}

module.exports = { createLocalSendService, discoverLocalSend, validExecutable, launchLocalSend }
