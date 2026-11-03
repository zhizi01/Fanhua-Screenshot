import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(project, 'node_modules', 'pdfjs-dist')
const destination = path.join(project, 'public', 'pdf-assets')
const { version } = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'))
const files = [{ from: 'build/pdf.worker.min.mjs', to: 'pdf.worker.mjs' }, { from: 'LICENSE', to: 'LICENSE' }]

for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const names = await readdir(path.join(source, directory), { withFileTypes: true })
  for (const entry of names) {
    // Only parsing and drawing are exposed by the app. Do not ship the PDF
    // scripting engine or its executable QuickJS sandbox assets.
    if (!entry.isFile() || /quickjs/i.test(entry.name)) continue
    files.push({ from: `${directory}/${entry.name}`, to: `${directory}/${entry.name}` })
  }
}

let bytes = 0
for (const file of files) {
  const target = path.join(destination, file.to)
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(path.join(source, file.from), target)
  bytes += (await stat(target)).size
}
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ package: 'pdfjs-dist', version, files: files.map(file => file.to).sort(), bytes }, null, 2) + '\n', 'utf8')
console.log(`PDF.js ${version} 离线资源已准备：${files.length} 个文件，${(bytes / 1024 / 1024).toFixed(1)} MB`)
