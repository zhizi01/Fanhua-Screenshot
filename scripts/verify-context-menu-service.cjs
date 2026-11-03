'use strict'

// The actual PowerShell transaction runs against an in-memory registry facade.
// No installer, real registry write, notification, or Explorer refresh occurs.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { EXTENSIONS, REGISTRY_SCRIPT, createContextMenuService, canonicalTree, equalTree, ownedTree } = require('../electron/context-menu.cjs')
const run = promisify(execFile)
const project = path.resolve(__dirname, '..')
const executable = 'C:\\测试 & 测试 $() ` ()\\繁花有图.exe'
const command = `"${executable}" --edit-image "%1"`
const desired = ownedTree(command, `"${executable}",0`)
const clone = value => JSON.parse(JSON.stringify(value))
const empty = () => EXTENSIONS.map(extension => ({ extension, user: null, machine: null }))

function memoryAdapter(initial = empty()) {
  let rows = clone(initial), failAt = -1
  const calls = []
  const adapter = async request => {
    calls.push(clone(request))
    if (request.action === 'read') return clone(rows)
    for (const change of request.changes) {
      const row = rows.find(item => item.extension === change.extension)
      if (!equalTree(row.user, change.before) || !equalTree(row.machine, change.machine)) throw new Error('右键菜单已被其他程序更改')
    }
    const old = clone(rows)
    try {
      request.changes.forEach((change, index) => {
        rows.find(item => item.extension === change.extension).user = clone(change.after)
        if (index === failAt) throw new Error('模拟注册表拒绝访问')
      })
    } catch (error) { rows = old; throw error }
    return clone(rows)
  }
  return { adapter, calls, rows: () => clone(rows), replace: next => { rows = clone(next) }, fail: index => { failAt = index } }
}

const MEMORY_REGISTRY = String.raw`
using System;
using System.Collections.Generic;
using Microsoft.Win32;
public sealed class MemoryKey : IDisposable {
  sealed class Node {
    public Dictionary<string, Node> Children = new Dictionary<string, Node>(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> Values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
  }
  Node node;
  public static int FailAt = -1;
  static int writes;
  public static void Arm(int fail) { FailAt = fail; writes = 0; }
  static void Write() { if (++writes == FailAt) { FailAt = -1; throw new UnauthorizedAccessException("模拟拒绝访问"); } }
  public MemoryKey() { node = new Node(); }
  MemoryKey(Node n) { node = n; }
  public MemoryKey OpenSubKey(string path, bool writable) {
    var current = node;
    foreach (var part in path.Split('\\')) {
      Node next; if (!current.Children.TryGetValue(part, out next)) return null;
      current = next;
    }
    return new MemoryKey(current);
  }
  public MemoryKey CreateSubKey(string path, bool writable) {
    Write(); var current = node;
    foreach (var part in path.Split('\\')) {
      Node next; if (!current.Children.TryGetValue(part, out next)) { next = new Node(); current.Children[part] = next; }
      current = next;
    }
    return new MemoryKey(current);
  }
  public void DeleteSubKeyTree(string path, bool throwOnMissing) {
    Write(); var parts = path.Split('\\'); var current = node;
    for (int i = 0; i < parts.Length - 1; i++) {
      Node next; if (!current.Children.TryGetValue(parts[i], out next)) return;
      current = next;
    }
    current.Children.Remove(parts[parts.Length - 1]);
  }
  public string[] GetValueNames() { var result = new string[node.Values.Count]; node.Values.Keys.CopyTo(result, 0); return result; }
  public string[] GetSubKeyNames() { var result = new string[node.Children.Count]; node.Children.Keys.CopyTo(result, 0); return result; }
  public RegistryValueKind GetValueKind(string name) { return RegistryValueKind.String; }
  public object GetValue(string name, object fallback, RegistryValueOptions options) { string value; return node.Values.TryGetValue(name, out value) ? value : fallback; }
  public void SetValue(string name, string value, RegistryValueKind kind) { Write(); node.Values[name] = value; }
  public void Dispose() { }
}
`

async function powershellTransaction(request, rows, failAt = -1) {
  let script = REGISTRY_SCRIPT
    .replace(/\$userRoot = \[Microsoft\.Win32\.RegistryKey\][^\n]+/, '$userRoot = New-Object MemoryKey')
    .replace(/\$machineRoot = \[Microsoft\.Win32\.RegistryKey\][^\n]+/, '$machineRoot = New-Object MemoryKey')
    .replace(/function Refresh-Shell \{[\s\S]*?\n\}\ntry \{/, 'function Refresh-Shell { }\ntry {')
  assert(!script.includes('OpenBaseKey'), 'Harness must never open a real registry hive')
  assert(!script.includes('SHChangeNotify'), 'Harness must never refresh the real Explorer shell')
  const seed = String.raw`
$seed = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FANHUA_CONTEXT_SEED)) | ConvertFrom-Json
foreach ($row in $seed) {
  foreach ($scope in @('user','machine')) {
    $tree = $row.$scope
    if ($null -ne $tree) {
      $root = if ($scope -eq 'user') { $userRoot } else { $machineRoot }
      $key = $root.CreateSubKey((Key-Path $row.extension), $true)
      Write-Tree $key $tree
    }
  }
}
[MemoryKey]::Arm([int]$env:FANHUA_CONTEXT_FAIL)
`
  script = script.replace('\ntry {\n  if ($request.action', `${seed}\ntry {\n  if ($request.action`)
  script = `$ProgressPreference = 'SilentlyContinue'\nAdd-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FANHUA_CONTEXT_MEMORY)))\n${script}\nConvertTo-Json -InputObject @{ final = (Read-State) } -Depth 16 -Compress`
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const { stdout, stderr } = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    env: { ...process.env,
      FANHUA_CONTEXT_MEMORY: Buffer.from(MEMORY_REGISTRY).toString('base64'),
      FANHUA_CONTEXT_REQUEST: Buffer.from(JSON.stringify(request)).toString('base64'),
      FANHUA_CONTEXT_SEED: Buffer.from(JSON.stringify(rows)).toString('base64'),
      FANHUA_CONTEXT_FAIL: String(failAt),
    },
  })
  assert.equal(stderr.trim(), '', stderr)
  const outputs = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line.replace(/^\uFEFF/, '')))
  assert.equal(outputs.length, 2, stdout)
  return { result: outputs[0], rows: outputs[1].final.map(row => ({ extension: row.extension, user: canonicalTree(row.user), machine: canonicalTree(row.machine) })) }
}

async function main() {
  const memory = memoryAdapter()
  const options = { app: { isPackaged: true }, platform: 'win32', executable, adapter: memory.adapter }
  const service = createContextMenuService(options)
  assert.deepEqual(await service.getState(), { available: true, enabled: false, registered: 0, total: 6, legacyMachine: false, conflict: false })
  assert(memory.calls.every(call => call.action === 'read'), 'Reading startup state must never register a verb')
  const change = await service.beginChange(true)
  assert.equal(change.state.enabled, true)
  assert(memory.rows().every(row => equalTree(row.user, desired) && !row.machine))
  assert.equal(memory.rows()[0].user.children[0].tree.values[0].value, command, 'Shell metacharacters and Chinese paths remain literal data')
  await change.rollback()
  assert.deepEqual(memory.rows(), empty())
  await change.rollback()
  assert.deepEqual(memory.rows(), empty(), 'Rollback is idempotent')
  await service.setEnabled(true)
  const count = memory.calls.length
  await service.setEnabled(true)
  assert.equal(memory.calls.length, count + 1, 'An unchanged desired state performs no writes')
  await service.setEnabled(false)
  assert.deepEqual(memory.rows(), empty())

  const partial = empty(); partial[0].user = clone(desired)
  partial[0].user.values = partial[0].user.values.filter(value => value.name !== 'FanhuaOptIn')
  memory.replace(partial)
  assert.equal((await service.getState()).registered, 1)
  const repaired = await service.beginChange(true)
  assert.equal(repaired.state.enabled, true)
  await repaired.rollback()
  assert.deepEqual(memory.rows(), partial, 'Persistence failure restores the exact partial legacy snapshot')

  memory.fail(2)
  await assert.rejects(service.beginChange(true), /拒绝访问/)
  assert.deepEqual(memory.rows(), partial)
  memory.fail(-1)

  for (const foreign of [ownedTree('"C:\\other\\繁花有图.exe" --edit-image "%1"', 'other'), { ...clone(desired), values: [...desired.values, { name: 'Unexpected', kind: 'String', value: 'keep' }] }]) {
    const occupied = empty(); occupied[0].user = foreign; memory.replace(occupied)
    assert.equal((await service.getState()).conflict, true)
    for (const enabled of [true, false]) await assert.rejects(service.beginChange(enabled), /其他安装|未知内容/)
    assert.deepEqual(memory.rows(), occupied)
  }
  const machine = empty(); machine[0].machine = clone(desired); memory.replace(machine)
  assert.equal((await service.getState()).legacyMachine, true)
  await assert.rejects(service.setEnabled(false), /系统级右键菜单/)
  assert.deepEqual(memory.rows(), machine, 'A normal user must not claim to have disabled machine-level registration')

  memory.replace(empty())
  const rollbackRace = await service.beginChange(true)
  const newer = memory.rows(); newer[0].user = ownedTree('"C:\\new\\繁花有图.exe" --edit-image "%1"', 'new')
  memory.replace(newer)
  await assert.rejects(rollbackRace.rollback(), /其他程序更改/)
  assert.deepEqual(memory.rows(), newer, 'Conditional rollback preserves a newer installation')

  const deniedAdapter = async () => { throw Error('must not access registry') }
  for (const patch of [{ app: { isPackaged: false } }, { executable: 'C:\\dev\\electron.exe' }, { executable: 'relative.exe' }, { executable: 'C:\\bad"path\\app.exe' }, { platform: 'darwin' }]) {
    const unavailable = createContextMenuService({ ...options, ...patch, adapter: deniedAdapter })
    assert.equal((await unavailable.getState()).available, false)
    await assert.rejects(unavailable.setEnabled(true), /安装后的 Windows/)
  }
  await assert.rejects(service.beginChange('true'), /设置值无效/)
  await assert.rejects(createContextMenuService({ ...options, adapter: async () => [] }).getState(), /不完整/)

  for (const invalidResult of [[], empty()]) {
    const invalidMemory = memoryAdapter()
    let applied = false
    const invalidService = createContextMenuService({ ...options, adapter: async request => {
      const result = await invalidMemory.adapter(request)
      if (request.action === 'apply' && !applied) { applied = true; return invalidResult }
      return result
    } })
    await assert.rejects(invalidService.beginChange(true), /不完整|未完成/)
    assert.deepEqual(invalidMemory.rows(), empty(), 'Post-apply result validation must restore the previous registry')
  }

  const installer = await fs.readFile(path.join(project, 'build/installer.nsh'), 'utf8')
  assert(!/\bWriteReg|\bFanhuaRegister|UserChoice/.test(installer), 'Installation must never register a verb or change defaults')
  assert(installer.includes('"FanhuaOptIn"') && installer.includes('${If} $R1 != "1"'), 'An explicit opt-in must survive newer installers')
  assert(installer.includes('!insertmacro FanhuaCleanLegacyScope SHCTX'))
  assert(installer.includes('!insertmacro FanhuaUnregisterScope HKCU'))
  assert(installer.includes('${If} ${isUpdated}'), 'Updating must preserve explicit user opt-in')
  assert(installer.includes('${If} $R0 == \'"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" --edit-image "%1"\''))
  for (const extension of EXTENSIONS) {
    assert(installer.includes(`!insertmacro FanhuaRemoveLegacyImageVerb \${ROOT} "${extension}"`))
    assert(installer.includes(`!insertmacro FanhuaUnregisterImageVerb \${ROOT} "${extension}"`))
  }

  const changes = empty().map(row => ({ extension: row.extension, before: null, after: desired, machine: null }))
  const nativeEnabled = await powershellTransaction({ action: 'apply', changes }, empty())
  assert.equal(nativeEnabled.result.ok, true, JSON.stringify(nativeEnabled.result))
  assert(nativeEnabled.rows.every(row => equalTree(row.user, desired) && !row.machine))
  const nativeDisabled = await powershellTransaction({ action: 'apply', changes: changes.map(change => ({ ...change, before: desired, after: null })) }, nativeEnabled.rows)
  assert.equal(nativeDisabled.result.ok, true, JSON.stringify(nativeDisabled.result))
  assert.deepEqual(nativeDisabled.rows, empty())
  const nativePartialFailure = await powershellTransaction({ action: 'apply', changes }, empty(), 12)
  assert.equal(nativePartialFailure.result.ok, false)
  assert.deepEqual(nativePartialFailure.rows, empty(), 'Actual PowerShell must roll back a mid-key failure')
  const nativeRestorePartial = await powershellTransaction({ action: 'apply', changes: partial.map(row => ({ extension: row.extension, before: row.user, after: desired, machine: null })) }, partial, 12)
  assert.equal(nativeRestorePartial.result.ok, false)
  assert.deepEqual(nativeRestorePartial.rows, partial, 'Actual PowerShell must restore an existing legacy tree exactly')
  const nativeStale = await powershellTransaction({ action: 'apply', changes }, partial)
  assert.equal(nativeStale.result.ok, false)
  assert.deepEqual(nativeStale.rows, partial, 'Stale snapshots must fail before any write')
  const nativeMachineRace = await powershellTransaction({ action: 'apply', changes }, machine)
  assert.equal(nativeMachineRace.result.ok, false)
  assert.deepEqual(nativeMachineRace.rows, machine)
  const invalid = clone(changes); invalid[0].extension = 'png\\..\\other'
  const nativeInvalid = await powershellTransaction({ action: 'apply', changes: invalid }, empty())
  assert.equal(nativeInvalid.result.ok, false)
  assert.deepEqual(nativeInvalid.rows, empty(), 'The fixed native script rejects registry-path injection')

  const report = { passed: true, defaultReadOnly: true, sixFormats: EXTENSIONS, quotedLiteralExecutable: true, exactRollback: true, conditionalRollback: true, partialRepair: true, machineLegacyExplained: true, foreignInstallationPreserved: true, devRegistrationRejected: true, installerOptInOnly: true, nativePowershellTransactionInMemory: true, nativeMidWriteFailureRolledBack: true, nativeStaleSnapshotRejected: true, nativePathInjectionRejected: true, realRegistryModified: false }
  await fs.mkdir(path.join(project, 'artifacts'), { recursive: true })
  await fs.writeFile(path.join(project, 'artifacts/context-menu-service.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify(report))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
