import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electron from 'electron'

const server = await createServer()
await server.listen()
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.', '--show-settings'], { stdio: 'inherit', env, windowsHide: true })
let closing = false
async function close(code = 0) {
  if (closing) return
  closing = true
  child.kill()
  await server.close()
  process.exit(code)
}
child.once('exit', code => close(code || 0))
process.once('SIGINT', () => close())
process.once('SIGTERM', () => close())
