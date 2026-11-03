'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { decodePngDataUrl } = require('./geometry.cjs')

const MAX_PAGES = 200
const MAX_PAGE_PIXELS = 16000000
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_PAGE_POINTS = 14400
const nextTurn = () => new Promise(resolve => setImmediate(resolve))

function checkOptions(options) {
  if (!options || !Number.isInteger(options.pageCount) || options.pageCount < 1 || options.pageCount > MAX_PAGES) throw new Error('PDF 每次可保存 1 至 200 页')
  if (options.name !== undefined && (typeof options.name !== 'string' || options.name.length > 256)) throw new Error('PDF 文件名无效')
  return options.pageCount
}

function defaultName(name) {
  const stem = (name || '繁花有图').replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120)
  return `${stem && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem) ? stem : '繁花有图'}.pdf`
}

function checkPage(page) {
  if (!page || !['widthPoints', 'heightPoints'].every(key => Number.isFinite(page[key]) && page[key] > 0 && page[key] <= MAX_PAGE_POINTS)) throw new Error('PDF 页面尺寸无效，每边应在 0 至 14400 点之间')
  const bytes = decodePngDataUrl(page.dataUrl)
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (width * height > MAX_PAGE_PIXELS) throw new Error('PDF 单页图片最多支持 1600 万像素，请降低导出分辨率')
  let imageData = false, complete = false
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('latin1', offset + 4, offset + 8)
    const end = offset + length + 12
    if (end > bytes.length) throw new Error('PDF 页面 PNG 数据不完整')
    if (type === 'IHDR' && (offset !== 8 || length !== 13)) throw new Error('PDF 页面 PNG 图片头无效')
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('PDF 页面必须是静态 PNG，不能使用动画图片')
    if (type === 'IDAT' && length > 0) imageData = true
    if (type === 'IEND') { complete = length === 0 && imageData; break }
    offset = end
  }
  if (!complete) throw new Error('PDF 页面 PNG 数据不完整')
  return { bytes, width, height, widthPoints: page.widthPoints, heightPoints: page.heightPoints }
}

function createPdfService({ app, dialog, fileSystem = fs, loadPdfLib = () => require('pdf-lib') }) {
  const jobs = new Map(), owners = new Map(), active = new Set(), destinations = new Map()
  let disposed = false

  function ownerId(win) {
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) throw new Error('图片窗口已关闭，PDF 保存已取消')
    return win.webContents.id
  }
  function ownedJob(win, id, optional = false) {
    const owner = ownerId(win)
    if (typeof id !== 'string' || id.length > 64) throw new Error('PDF 保存任务无效')
    const job = jobs.get(id)
    if (!job) { if (optional) return null; throw new Error('PDF 保存任务已结束，请重新保存') }
    if (job.owner !== owner) throw new Error('不允许操作其他窗口的 PDF 保存任务')
    return job
  }
  function assertActive(job) {
    if (disposed || job.canceled || job.win.isDestroyed() || job.win.webContents.isDestroyed()) throw new Error(job.error || 'PDF 保存已取消')
  }
  function release(job) {
    jobs.delete(job.id)
    if (owners.get(job.owner) === job) owners.delete(job.owner)
    if (job.destination && destinations.get(job.destination) === job) destinations.delete(job.destination)
    job.document = null
  }
  async function cleanTemporary(job) {
    if (!job.tempPath) return
    try { await fileSystem.unlink(job.tempPath) }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('无法清理 PDF 临时文件，请检查保存目录权限') }
    job.tempPath = null
  }
  function markCanceled(job) {
    // Atomic rename is the commit point. Once issued it cannot safely be
    // undone; cancellation waits for that completed save instead.
    if (job.state === 'committing' || job.state === 'complete') return
    job.cancellationRequested = true
    job.canceled = true
    release(job)
  }
  async function cancelJob(job) {
    markCanceled(job)
    await job.queue
    await cleanTemporary(job)
    active.delete(job)
  }
  async function cancelAll(selected) {
    const results = await Promise.allSettled(selected.map(cancelJob))
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
  }
  function fail(job, error) {
    job.error = error instanceof Error ? error.message : 'PDF 保存失败'
    job.canceled = true
    release(job)
  }
  function enqueue(job, operation) {
    const result = job.queue.then(async () => {
      await nextTurn()
      assertActive(job)
      return operation()
    }).catch(async error => {
      fail(job, error)
      await cleanTemporary(job)
      active.delete(job)
      throw error
    })
    // Keep an observed tail for cancellation, while callers receive the actual
    // rejection. A failed append invalidates every later operation in the job.
    job.queue = result.catch(() => {})
    return result
  }

  async function begin(win, options) {
    const owner = ownerId(win), pageCount = checkOptions(options)
    if (disposed) throw new Error('应用正在退出，无法保存 PDF')
    if (owners.has(owner)) throw new Error('请先完成或取消当前 PDF 保存任务')
    const job = { id: randomUUID(), owner, win, pageCount, acceptedPages: 0, completedPages: 0, totalBytes: 0, normalizedBytes: 0, state: 'choosing', canceled: false, queue: Promise.resolve(), document: null, tempPath: null }
    jobs.set(job.id, job); owners.set(owner, job); active.add(job)
    try {
      let result
      try {
        result = await dialog.showSaveDialog(win, {
          title: '保存 PDF · 繁花有图',
          defaultPath: path.join(app.getPath('documents'), defaultName(options.name)),
          filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
        })
      } catch { throw new Error('无法打开 PDF 保存对话框，请重试') }
      if (job.canceled || disposed || win.isDestroyed() || win.webContents.isDestroyed() || result.canceled || !result.filePath) {
        markCanceled(job); active.delete(job); return { canceled: true }
      }
      if (!path.isAbsolute(result.filePath) || path.extname(result.filePath).toLowerCase() !== '.pdf') throw new Error('请在保存对话框中选择 .pdf 后缀的文件名')
      job.filePath = path.normalize(result.filePath)
      job.destination = job.filePath.toLowerCase()
      if (destinations.has(job.destination)) throw new Error('另一窗口正在保存到此 PDF，请选择其他文件名')
      destinations.set(job.destination, job)
      try { job.document = await loadPdfLib().PDFDocument.create() }
      catch { throw new Error('无法创建 PDF，请重新尝试保存') }
      if (job.canceled || disposed || win.isDestroyed() || win.webContents.isDestroyed()) { markCanceled(job); active.delete(job); return { canceled: true } }
      job.document.setCreator('繁花有图')
      job.state = 'ready'
      return { canceled: false, jobId: job.id }
    } catch (error) {
      fail(job, error); active.delete(job)
      throw error
    }
  }

  async function append(win, id, page) {
    const job = ownedJob(win, id)
    if (job.state !== 'ready') throw new Error('PDF 正在完成保存，不能再添加页面')
    let input
    try {
      if (job.acceptedPages >= job.pageCount) throw new Error('PDF 页面数量超过本次保存范围')
      input = checkPage(page)
      if (job.totalBytes + input.bytes.length > MAX_TOTAL_BYTES) throw new Error('PDF 页面图片合计超过 128 MB，请减少页数或降低分辨率')
      job.totalBytes += input.bytes.length
      job.acceptedPages++
    } catch (error) { fail(job, error); await job.queue; active.delete(job); throw error }
    return enqueue(job, async () => {
      const document = job.document
      let image, normalized
      try {
        // pdf-lib's PNG decoder handles APNG frames and metadata itself. Give
        // it a bounded, static PNG decoded by libvips first, so malformed IDAT
        // data never reaches its unbounded JavaScript inflater.
        const sharp = require('sharp')
        normalized = await sharp(input.bytes, { limitInputPixels: MAX_PAGE_PIXELS, animated: false, failOn: 'warning' }).toColourspace('srgb').png({ progressive: false }).toBuffer()
        input.bytes = null
      }
      catch { throw new Error('PDF 页面 PNG 解码失败，请重新导出此页') }
      assertActive(job)
      if (job.normalizedBytes + normalized.length > MAX_TOTAL_BYTES) throw new Error('PDF 页面图片合计超过 128 MB，请减少页数或降低分辨率')
      job.normalizedBytes += normalized.length
      try { image = await document.embedPng(normalized) }
      catch { throw new Error('PDF 页面 PNG 解码失败，请重新导出此页') }
      normalized = null
      if (image.width !== input.width || image.height !== input.height) throw new Error('PDF 页面图片尺寸与内容不一致')
      await nextTurn(); assertActive(job)
      const target = document.addPage([input.widthPoints, input.heightPoints])
      target.drawImage(image, { x: 0, y: 0, width: input.widthPoints, height: input.heightPoints })
      // Explicit embedding releases pdf-lib's raw RGB/alpha PNG buffers per
      // page, instead of retaining all decoded pages until document.save().
      try { await image.embed() }
      catch { throw new Error('PDF 页面写入失败，请重新导出此页') }
      input = null
      assertActive(job)
      job.completedPages++
    })
  }

  async function finish(win, id) {
    const job = ownedJob(win, id)
    if (job.state !== 'ready') throw new Error('PDF 已在保存，请勿重复操作')
    if (job.acceptedPages !== job.pageCount) {
      const error = new Error('PDF 页面尚未全部添加，请重新保存')
      fail(job, error); await job.queue; active.delete(job); throw error
    }
    job.state = 'finishing'
    return enqueue(job, async () => {
      if (job.completedPages !== job.pageCount) throw new Error('PDF 页面尚未完成，请重新保存')
      let output
      try { output = await job.document.save({ addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 20 }) }
      catch { throw new Error('PDF 合成失败，请减少页数后重试') }
      assertActive(job)
      if (output.length > MAX_TOTAL_BYTES + 16 * 1024 * 1024) throw new Error('生成的 PDF 过大，请减少页数或降低分辨率')
      const tempPath = path.join(path.dirname(job.filePath), `.fanhua-${job.id}.pdf.tmp`)
      let handle
      try {
        handle = await fileSystem.open(tempPath, 'wx', 0o600)
        // Only remove a temporary file that this job actually created.
        job.tempPath = tempPath
        assertActive(job)
        await handle.writeFile(output)
        await handle.sync()
        await handle.close(); handle = null
        assertActive(job)
        job.state = 'committing'
        await fileSystem.rename(job.tempPath, job.filePath)
        job.tempPath = null
      } catch (error) {
        if (job.canceled || disposed) throw new Error('PDF 保存已取消')
        if (error.message === 'PDF 保存已取消') throw error
        throw new Error('PDF 保存失败，请检查目录权限、磁盘空间或文件是否被占用')
      } finally { await handle?.close().catch(() => {}) }
      job.state = 'complete'
      release(job); active.delete(job)
      return { canceled: false, filePath: job.filePath }
    }).catch(error => {
      if (job.cancellationRequested) return { canceled: true }
      throw error
    })
  }

  return {
    begin, append, finish,
    async cancel(win, id) { const job = ownedJob(win, id, true); if (job) await cancelJob(job) },
    async cancelOwner(owner) { await cancelAll([...active].filter(job => job.owner === owner)) },
    async dispose() { disposed = true; await cancelAll([...active]) },
  }
}

module.exports = { createPdfService, MAX_PAGES, MAX_PAGE_PIXELS, MAX_TOTAL_BYTES, MAX_PAGE_POINTS }
