'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const path = require('node:path')

// The outer worker allows cancellation during initialization as well as OCR.
// All language files and the WebAssembly core are bundled; no network is used.
async function recognize() {
  const { createWorker } = require(workerData.modulePath)
  const packageRoot = path.dirname(path.dirname(workerData.modulePath))
  const languages = workerData.language === 'en-US' ? 'eng' : 'eng+chi_sim'
  let worker
  try {
    worker = await createWorker(languages, 1, {
      workerPath: path.join(packageRoot, 'src/worker-script/node/index.js'),
      langPath: workerData.langPath, gzip: workerData.gzip, cacheMethod: 'none',
      logger() {}, errorHandler() {},
    })
    await worker.setParameters({ tessedit_pageseg_mode: '3', user_defined_dpi: '150' })
    const { data } = await worker.recognize(Buffer.from(workerData.buffer), {}, { text: true, blocks: true })
    const lines = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => ({
      text: line.text, bounds: { x: line.bbox.x0, y: line.bbox.y0, width: line.bbox.x1 - line.bbox.x0, height: line.bbox.y1 - line.bbox.y0 },
    }))))
    return { lines, language: workerData.language === 'en-US' ? 'en-US' : 'zh-Hans-CN' }
  } finally { if (worker) await worker.terminate() }
}
recognize().then(result => parentPort.postMessage(result)).catch(() => parentPort.postMessage({ error: true }))
