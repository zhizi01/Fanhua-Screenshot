import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const executablePath = path.resolve('release/win-unpacked/繁花有图.exe')
if (!existsSync(executablePath)) {
  console.error('请先执行 npm run pack 或 npm run dist。')
  process.exit(1)
}
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--project=electron'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, FANHUA_PACKAGED_EXE: executablePath },
})
child.once('exit', code => process.exit(code ?? 1))
