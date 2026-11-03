'use strict'

// The application relies on Windows desktop APIs and ships x64 native models.
function assertWindowsHost(platform = process.platform, architecture = process.arch) {
  if (platform !== 'win32') throw new Error('繁花有图仅支持在 Windows 上构建。')
  if (architecture !== 'x64') throw new Error('当前发布目标为 Windows x64，请使用 x64 Node.js 与 Electron。')
}

function assertWindowsTarget(context) {
  assertWindowsHost()
  const { Arch } = require('builder-util')
  if (context.electronPlatformName !== 'win32' || context.arch !== Arch.x64) {
    throw new Error('繁花有图仅生成 Windows x64 程序，不支持 macOS、Linux 或其他架构目标。')
  }
}

module.exports = assertWindowsTarget
module.exports.assertWindowsHost = assertWindowsHost

if (require.main === module) {
  try { assertWindowsHost() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
