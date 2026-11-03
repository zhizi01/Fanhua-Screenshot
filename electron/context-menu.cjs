'use strict'

const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'pdf'])
const VERB = 'FanhuaScreenshot.Edit'
const runFile = promisify(execFile)

// The script is fixed. Requests cross the process boundary as base64 JSON in
// the environment, never as interpolated PowerShell source or shell arguments.
const REGISTRY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FANHUA_CONTEXT_REQUEST)) | ConvertFrom-Json
$extensions = @('png','jpg','jpeg','webp','bmp','pdf')
$userRoot = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
$machineRoot = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
function Key-Path([string] $extension) {
  if ($extensions -cnotcontains $extension) { throw '不支持的文件类型' }
  return 'Software\Classes\SystemFileAssociations\.' + $extension + '\shell\FanhuaScreenshot.Edit'
}
function Read-Tree($key, [int] $depth) {
  if (!$key) { return $null }
  $names = @($key.GetValueNames() | Sort-Object)
  $children = @($key.GetSubKeyNames() | Sort-Object)
  if ($depth -gt 2 -or $names.Count -gt 16 -or $children.Count -gt 4) { return @{ truncated = $true } }
  $values = @()
  foreach ($name in $names) {
    $kind = [string]$key.GetValueKind($name)
    $value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($kind -ne 'String' -or $name.Length -gt 128 -or ([string]$value).Length -gt 32768) { return @{ truncated = $true } }
    $values += [ordered]@{ name = $name; kind = $kind; value = [string]$value }
  }
  $subtrees = @()
  foreach ($name in $children) {
    $child = $key.OpenSubKey($name, $false)
    try { $subtrees += [ordered]@{ name = $name; tree = (Read-Tree $child ($depth + 1)) } }
    finally { if ($child) { $child.Dispose() } }
  }
  return [ordered]@{ values = $values; children = $subtrees }
}
function Read-Key($root, [string] $extension) {
  $key = $root.OpenSubKey((Key-Path $extension), $false)
  try { return Read-Tree $key 0 } finally { if ($key) { $key.Dispose() } }
}
function Read-State {
  $rows = @()
  foreach ($extension in $extensions) { $rows += @{ extension = $extension; user = (Read-Key $userRoot $extension); machine = (Read-Key $machineRoot $extension) } }
  return ,$rows
}
function Tree-Json($tree) { return ConvertTo-Json -InputObject $tree -Compress -Depth 16 }
function Assert-Tree($tree, [int] $depth) {
  if ($null -eq $tree) { return }
  if ($tree.truncated -or $depth -gt 1 -or @($tree.values).Count -gt 4 -or @($tree.children).Count -gt 1) { throw '右键菜单包含无法安全修改的内容' }
  foreach ($value in $tree.values) {
    if ($value.kind -cne 'String' -or $value.value -isnot [string] -or $value.value.Length -gt 32768) { throw '右键菜单数据无效' }
    if (($depth -eq 0 -and @('','Icon','MultiSelectModel','FanhuaOptIn') -cnotcontains $value.name) -or ($depth -eq 1 -and $value.name -cne '')) { throw '右键菜单包含未知内容' }
  }
  foreach ($child in $tree.children) {
    if ($depth -ne 0 -or $child.name -cne 'command') { throw '右键菜单包含未知命令' }
    Assert-Tree $child.tree ($depth + 1)
  }
}
function Is-PartialTree($current, $target) {
  # A failed create may leave only a prefix of our known values. A different
  # executable, extra value, or unknown child belongs to a concurrent writer.
  if ($null -eq $current) { return $true }
  if ($null -eq $target -or $current.truncated) { return $false }
  foreach ($value in $current.values) {
    $match = @($target.values | Where-Object { $_.name -ceq $value.name -and $_.kind -ceq $value.kind -and $_.value -ceq $value.value })
    if ($match.Count -ne 1) { return $false }
  }
  foreach ($child in $current.children) {
    $match = @($target.children | Where-Object { $_.name -ceq $child.name })
    if ($match.Count -ne 1 -or !(Is-PartialTree $child.tree $match[0].tree)) { return $false }
  }
  return $true
}
function Write-Tree($key, $tree) {
  foreach ($value in $tree.values) { $key.SetValue([string]$value.name, [string]$value.value, [Microsoft.Win32.RegistryValueKind]::String) }
  foreach ($child in $tree.children) {
    $childKey = $key.CreateSubKey([string]$child.name, $true)
    try { Write-Tree $childKey $child.tree } finally { $childKey.Dispose() }
  }
}
function Replace-Key([string] $extension, $tree) {
  $keyPath = Key-Path $extension
  $userRoot.DeleteSubKeyTree($keyPath, $false)
  if ($null -ne $tree) {
    $key = $userRoot.CreateSubKey($keyPath, $true)
    try { Write-Tree $key $tree } finally { $key.Dispose() }
  }
}
function Refresh-Shell {
  try {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FanhuaShell { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b); }'
    [FanhuaShell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
  } catch { } # Registration remains authoritative even if Shell refresh is unavailable.
}
try {
  if ($request.action -ceq 'read') { $result = Read-State }
  elseif ($request.action -ceq 'apply') {
    if (@($request.changes).Count -gt 6) { throw '右键菜单修改数量无效' }
    $seen = @{}
    # Check every expected snapshot before making the first write. Another
    # installation must never be replaced between the UI read and the commit.
    foreach ($change in $request.changes) {
      $null = Key-Path $change.extension
      if ($seen.ContainsKey($change.extension)) { throw '重复的右键菜单修改' }
      $seen[$change.extension] = $true
      Assert-Tree $change.before 0
      Assert-Tree $change.after 0
      if ((Tree-Json (Read-Key $userRoot $change.extension)) -cne (Tree-Json $change.before)) { throw '右键菜单已被其他程序更改，请刷新设置后重试' }
      if ((Tree-Json (Read-Key $machineRoot $change.extension)) -cne (Tree-Json $change.machine)) { throw '系统右键菜单已变化，请刷新设置后重试' }
    }
    $applied = @()
    try {
      foreach ($change in $request.changes) {
        # Include a partially written key in rollback when a registry write fails.
        $applied += $change
        Replace-Key $change.extension $change.after
      }
      $result = Read-State
    } catch {
      $originalError = $_
      $rollbackFailed = $false
      [array]::Reverse($applied)
      foreach ($change in $applied) {
        try {
          $now = Read-Key $userRoot $change.extension
          if (!(Is-PartialTree $now $change.after) -and (Tree-Json $now) -cne (Tree-Json $change.before)) { throw '右键菜单已被其他安装更改' }
          Replace-Key $change.extension $change.before
        } catch { $rollbackFailed = $true }
      }
      Refresh-Shell
      if ($rollbackFailed) { throw '右键菜单修改失败，部分项目未能恢复，请重新打开设置检查状态' }
      throw $originalError
    }
    Refresh-Shell
  } else { throw '无效的右键菜单操作' }
  ConvertTo-Json -InputObject @{ ok = $true; rows = $result } -Depth 16 -Compress
} catch { ConvertTo-Json -InputObject @{ ok = $false; error = $_.Exception.Message } -Compress }
finally { $userRoot.Dispose(); $machineRoot.Dispose() }
`

function canonicalTree(tree) {
  if (!tree) return null
  if (tree.truncated) return { truncated: true }
  return {
    values: (tree.values || []).map(value => ({ name: value.name, kind: value.kind, value: value.value })).sort((a, b) => a.name.localeCompare(b.name, 'en')),
    children: (tree.children || []).map(child => ({ name: child.name, tree: canonicalTree(child.tree) })).sort((a, b) => a.name.localeCompare(b.name, 'en')),
  }
}
function equalTree(a, b) { return JSON.stringify(canonicalTree(a)) === JSON.stringify(canonicalTree(b)) }
function commandOf(tree) { return tree?.children?.find(child => child.name === 'command')?.tree?.values?.find(value => value.name === '' && value.kind === 'String')?.value || '' }
function safeTree(tree, depth = 0) {
  if (!tree) return true
  if (tree.truncated || depth > 1 || !Array.isArray(tree.values) || !Array.isArray(tree.children)) return false
  const names = depth === 0 ? ['', 'Icon', 'MultiSelectModel', 'FanhuaOptIn'] : ['']
  return tree.values.length <= names.length && new Set(tree.values.map(value => value.name)).size === tree.values.length
    && tree.values.every(value => names.includes(value.name) && value.kind === 'String' && typeof value.value === 'string' && value.value.length <= 32768)
    && tree.children.length <= (depth === 0 ? 1 : 0)
    && tree.children.every(child => child.name === 'command' && safeTree(child.tree, depth + 1))
}
function ownedTree(command, icon) {
  return canonicalTree({ values: [
    { name: '', kind: 'String', value: '使用繁花有图编辑' },
    { name: 'Icon', kind: 'String', value: icon },
    { name: 'MultiSelectModel', kind: 'String', value: 'Single' },
    { name: 'FanhuaOptIn', kind: 'String', value: '1' },
  ], children: [{ name: 'command', tree: { values: [{ name: '', kind: 'String', value: command }], children: [] } }] })
}

async function runRegistry(request) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const { stdout } = await runFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(REGISTRY_SCRIPT, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    env: { ...process.env, FANHUA_CONTEXT_REQUEST: Buffer.from(JSON.stringify(request), 'utf8').toString('base64') },
  })
  let result
  try { result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) }
  catch { throw new Error('无法读取 Windows 右键菜单状态，请稍后重试') }
  if (!result.ok) throw new Error(result.error || '无法修改 Windows 右键菜单')
  return result.rows
}

function createContextMenuService({ app, platform = process.platform, executable = process.execPath, adapter = runRegistry }) {
  const available = platform === 'win32' && !!app.isPackaged
  const validExecutable = typeof executable === 'string' && path.win32.isAbsolute(executable) && /^[a-z]:\\/i.test(executable)
    && !/["\r\n\0]/.test(executable) && /\.exe$/i.test(executable) && !/^electron\.exe$/i.test(path.win32.basename(executable))
  const command = `"${executable}" --edit-image "%1"`
  const desired = ownedTree(command, `"${executable}",0`)
  let queue = Promise.resolve()
  const serialize = operation => { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending }

  function validateRows(rows) {
    if (!Array.isArray(rows) || rows.length !== EXTENSIONS.length || EXTENSIONS.some(extension => rows.filter(row => row?.extension === extension).length !== 1)) throw new Error('Windows 右键菜单状态不完整，请重试')
    return rows.map(row => ({ extension: row.extension, user: canonicalTree(row.user), machine: canonicalTree(row.machine) }))
  }
  function stateFrom(rows) {
    const registered = rows.filter(row => (commandOf(row.user) || commandOf(row.machine)).toLowerCase() === command.toLowerCase()).length
    const legacyMachine = rows.some(row => !!row.machine)
    const conflict = rows.some(row => (row.user && (!safeTree(row.user) || commandOf(row.user).toLowerCase() !== command.toLowerCase()))
      || (row.machine && (!safeTree(row.machine) || commandOf(row.machine).toLowerCase() !== command.toLowerCase())))
    let reason
    if (legacyMachine) reason = '检测到旧版安装器添加的系统级右键菜单，请重新运行新版安装程序以清理旧注册；设置只修改当前用户。'
    else if (conflict) reason = '右键菜单属于其他安装或包含未知内容，已保留原有注册。'
    else if (registered > 0 && registered < EXTENSIONS.length) reason = `右键菜单仅注册了 ${registered} / ${EXTENSIONS.length} 种格式，可重新启用以修复。`
    return { available, enabled: registered === EXTENSIONS.length, registered, total: EXTENSIONS.length, legacyMachine, conflict, ...(reason ? { reason } : {}) }
  }
  async function getState() {
    if (!available || !validExecutable) return { available: false, enabled: false, registered: 0, total: EXTENSIONS.length, legacyMachine: false, conflict: false, reason: '资源管理器右键菜单请在安装后的 Windows 应用中设置。' }
    return stateFrom(validateRows(await adapter({ action: 'read' })))
  }
  function beginChange(enabled) {
    return serialize(async () => {
      if (typeof enabled !== 'boolean') throw new Error('右键菜单设置值无效')
      if (!available || !validExecutable) throw new Error('资源管理器右键菜单请在安装后的 Windows 应用中设置')
      const before = validateRows(await adapter({ action: 'read' }))
      const current = stateFrom(before)
      if (current.legacyMachine || current.conflict) throw new Error(current.reason)
      const changes = before.filter(row => !equalTree(row.user, enabled ? desired : null)).map(row => ({ extension: row.extension, before: row.user, after: enabled ? desired : null, machine: row.machine }))
      const reverse = () => changes.map(change => ({ ...change, before: change.after, after: change.before }))
      const result = changes.length ? await adapter({ action: 'apply', changes }) : before
      let after
      try {
        after = validateRows(result)
        if (stateFrom(after).registered !== (enabled ? EXTENSIONS.length : 0)) throw new Error('Windows 未完成右键菜单修改，请刷新设置检查实际状态')
      } catch (error) {
        if (changes.length) {
          try { await adapter({ action: 'apply', changes: reverse() }) }
          catch { throw new Error('无法确认右键菜单修改结果，且未能完整恢复，请重新打开设置检查实际状态') }
        }
        throw error
      }
      let restored = false
      return { state: stateFrom(after), rollback: () => serialize(async () => {
        if (restored) return
        if (changes.length) await adapter({ action: 'apply', changes: reverse() })
        restored = true
      }) }
    })
  }
  async function setEnabled(enabled) { return (await beginChange(enabled)).state }
  return { getState, beginChange, setEnabled }
}

module.exports = { EXTENSIONS, VERB, REGISTRY_SCRIPT, createContextMenuService, canonicalTree, equalTree, ownedTree }
