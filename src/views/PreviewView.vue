<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button as AButton, InputNumber as AInputNumber, Slider as ASlider, Select as ASelect, message } from 'ant-design-vue'
import { ArrowUpRight, Check, ChevronDown, Circle, Download, Flower2, Grip, Image as ImageIcon, Languages, Layers3, Maximize, Minus, MousePointer2, Pencil, Pin, PinOff, Plus, Redo2, RefreshCw, Scan, ScanText, Settings, Square, Stamp, Trash2, Type, Undo2, X } from 'lucide-vue-next'
import type { AppSettings, ExportOptions, ImageFormat, OcrCapabilities, OcrParagraph, Screenshot, WatermarkConfig } from '../shared'
import { arrowEndpointAt, DocumentHistory, hitTest, imagePoint, markerDiameter, moveLayer, normalizeRect, resizeShape, sequenceLabel, shapeHandleAt, shapeRect, visualLayers, type ArrowLayer, type BorderStyle, type EditorDocument, type Layer, type MosaicLayer, type NumberStyle, type Point, type ShapeHandle, type ShapeLayer, type TextStyle, type Tool } from '../editor/model'
import { canvasFont, paintArrow, paintShape, renderScene, renderSelection, textMeasure } from '../editor/render'
import { defaultWatermark, loadWatermarkImage } from '../watermark/render'
import SaveExportDialog from '../components/SaveExportDialog.vue'
import ShareActions from '../components/ShareActions.vue'
import ImageContextMenu from '../components/ImageContextMenu.vue'
import OcrSidebar from '../components/OcrSidebar.vue'
import TranslationOverlay from '../components/TranslationOverlay.vue'
import { hitOcrParagraph, clipOcrBounds } from '../ocr/regions'
import WatermarkPanel from '../components/WatermarkPanel.vue'
import { useParagraphTranslation } from '../services/translation'
import PdfPageBar from '../components/PdfPageBar.vue'
import { openPdf, type PdfSource } from '../pdf/document'
import { copyPageDocument, PdfPageStates } from '../pdf/page-state'

const screenshot = ref<Screenshot>()
const isDesktop = !!window.fanhua
const sourceImage = ref<HTMLImageElement>()
const loading = ref(true)
const error = ref('')
const editing = ref(false)
const pinned = ref(false)
const saving = ref(false)
const pdfPage = ref(1)
const pdfPageCount = ref(0)
const pdfName = ref('')
const pdfProgress = ref<{ completed: number; total: number; finalizing: boolean }>()
const pdfCanceling = ref(false)
const pageStates = new PdfPageStates()
let pdfSource: PdfSource | undefined
let originalScreenshot: Screenshot | undefined
let pageRequest = 0
let disposed = false
let pdfSaveJob: string | undefined
const copying = ref<'png' | 'deskflow' | null>(null)
const sharing = ref(false)
const saved = ref(false)
const exportOpen = ref(false)
const preferences = ref<AppSettings>()
const ocrOpen = ref(false)
const ocrBusy = ref(false)
const ocrError = ref('')
const ocrCapabilities = ref<OcrCapabilities>()
const ocrLanguage = ref('auto')
const ocrParagraphs = ref<OcrParagraph[]>([])
const selectedParagraphId = ref<string>()
const ocrHasResult = ref(false)
const ocrSidebar = ref<InstanceType<typeof OcrSidebar>>()
const translation = useParagraphTranslation(ocrParagraphs, () => screenshot.value?.id)
const translationState = translation.state
const hoveredParagraphId = ref<string>()
const hoveredTranslation = computed(() => {
  if (!ocrOpen.value || !translationState.value.open || !hoveredParagraphId.value) return ''
  const paragraph = ocrParagraphs.value.find(item => item.id === hoveredParagraphId.value)
  return paragraph ? translatedText(paragraph) : ''
})
let ocrRequest = 0
let ocrInFlight = false
let pendingOcrPage: string | undefined
const watermarkOpen = ref(false)
const watermark = ref<WatermarkConfig>(defaultWatermark())
const tool = ref<Tool>('select')
const layers = ref<Layer[]>([])
const selectedId = ref<string>()
const selected = computed(() => layers.value.find(layer => layer.id === selectedId.value))
const layerList = computed(() => visualLayers(layers.value).reverse())
const stage = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const contextMenu = ref({ open: false, x: 0, y: 0 })
const textInput = ref<HTMLTextAreaElement>()
const scale = ref(1)
const fitMode = ref(true)
const viewportSize = ref({ width: 0, height: 0 })
const surfaceStyle = computed(() => ({
  width: `${Math.max(viewportSize.value.width - 32, (screenshot.value?.width || 0) * scale.value + (fitMode.value ? 0 : viewportSize.value.width))}px`,
  height: `${Math.max(viewportSize.value.height - 32, (screenshot.value?.height || 0) * scale.value + (fitMode.value ? 0 : viewportSize.value.height))}px`,
}))
let history = new DocumentHistory({ layers: [], watermark: watermark.value })
const historyTick = ref(0)
const canUndo = computed(() => { void historyTick.value; return history.canUndo })
const canRedo = computed(() => { void historyTick.value; return history.canRedo })
const defaults = ref<TextStyle>({ font: 'Microsoft YaHei UI', size: 28, color: '#ef5c68' })
const numberStyle = ref<NumberStyle>('number')
const markerHeadSize = ref(50)
const arrowDefaults = ref({ lineWidth: 4, headSize: 22 })
const shapeDefaults = ref({ lineWidth: 3, borderStyle: 'solid' as BorderStyle })
const mosaicStrength = ref(18)
const fonts = ref(['Microsoft YaHei UI', 'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'Arial', 'Segoe UI', 'Consolas'])
const fontsLoading = ref(false)
const fontsError = ref('')
const colors = ['#ef5c68', '#f3a24a', '#f4d44d', '#44b797', '#438fe8', '#8063d5', '#26232f', '#ffffff']
const selectedText = computed(() => selected.value?.type === 'text' || selected.value?.type === 'marker' ? selected.value : undefined)
const properties = computed(() => selectedText.value || defaults.value)
const selectedShape = computed(() => selected.value?.type === 'rectangle' || selected.value?.type === 'ellipse' ? selected.value : undefined)
const activeShape = computed(() => selectedShape.value || shapeDefaults.value)
const activeColor = computed(() => selectedShape.value?.color || (selected.value?.type === 'arrow' ? selected.value.color : properties.value.color))
const activeArrow = computed(() => selected.value?.type === 'arrow' ? selected.value : arrowDefaults.value)
const activeHeadSize = computed(() => selected.value?.type === 'marker' ? markerDiameter(selected.value) : markerHeadSize.value)
const inspectorType = computed(() => selected.value?.type || (tool.value === 'select' ? 'text' : tool.value))
const fontOptions = computed(() => fonts.value.map(value => ({ value, label: value })))
const filterFonts = (input: string, option?: { value?: unknown }) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())
const activeStrength = computed(() => selected.value?.type === 'mosaic' ? selected.value.strength : mosaicStrength.value)
const activeNumberStyle = computed(() => selected.value?.type === 'marker' ? selected.value.style : numberStyle.value)
const tools = [
  { id: 'select' as const, icon: MousePointer2, label: '选择', key: 'V' },
  { id: 'text' as const, icon: Type, label: '文字', key: 'T' },
  { id: 'marker' as const, icon: Grip, label: '序号', key: 'N' },
  { id: 'arrow' as const, icon: ArrowUpRight, label: '箭头', key: 'A' },
  { id: 'rectangle' as const, icon: Square, label: '方框', key: 'R' },
  { id: 'ellipse' as const, icon: Circle, label: '圆形', key: 'O' },
  { id: 'mosaic' as const, icon: Scan, label: '马赛克', key: 'M' },
]
const toolHint = computed(() => ({ select: '选中后拖动 · Delete 删除', text: '点击图片添加文字', marker: '点击图片添加序号', mosaic: '拖动框选打码区域', arrow: '拖动绘制箭头 · 两端可调整', rectangle: '拖动绘制方框 · Shift 正方形', ellipse: '拖动绘制椭圆 · Shift 正圆' })[tool.value])
let resizeObserver: ResizeObserver | undefined
let frame = 0
let drag: { origin: Point; layer?: Layer; moved: boolean; pointerId: number; endpoint?: 'start' | 'end'; shapeHandle?: ShapeHandle } | undefined
const draft = ref<MosaicLayer | ArrowLayer | ShapeLayer>()
let watermarkRequest = 0
let zoomRequest = 0

function currentDocument(): EditorDocument { return copyPageDocument({ layers: layers.value, watermark: watermark.value }) }
function retainCurrentPage() {
  if (pdfSource) pageStates.store(pdfPage.value, { document: currentDocument(), history, saved: saved.value })
}
async function readImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new window.Image()
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('无法读取图片，请重新打开')); img.src = dataUrl })
  return img
}
function resetPageRecognition() {
  ocrRequest++
  ocrBusy.value = false
  pendingOcrPage = undefined
  translation.reset()
  ocrParagraphs.value = []
  ocrHasResult.value = false
  ocrError.value = ''
  selectedParagraphId.value = undefined
  hoveredParagraphId.value = undefined
}
async function navigatePdfPage(page: number) {
  if (!pdfSource || !originalScreenshot || loading.value || saving.value || copying.value || sharing.value || page === pdfPage.value) return
  const target = Math.max(1, Math.min(pdfPageCount.value, Math.trunc(page)))
  if (target === pdfPage.value) return
  cancelDrag(); retainCurrentPage()
  contextMenu.value.open = false
  watermarkRequest++
  resetPageRecognition()
  const request = ++pageRequest
  loading.value = true
  try {
    const rendered = await pdfSource.renderPage(target)
    const img = await readImage(rendered.dataUrl)
    if (disposed || request !== pageRequest) return
    const state = pageStates.get(target)
    const document = copyPageDocument(state.document)
    screenshot.value = { ...originalScreenshot, pdf: undefined, id: `${originalScreenshot.id}:page:${target}`, dataUrl: rendered.dataUrl, width: rendered.width, height: rendered.height }
    sourceImage.value = img
    error.value = ''
    pdfPage.value = target
    layers.value = document.layers; watermark.value = document.watermark
    history = state.history; historyTick.value++
    saved.value = state.saved
    selectedId.value = undefined
  } catch (cause) {
    if (!disposed && request === pageRequest) message.error(cause instanceof Error ? cause.message : '页面读取失败，请重试')
  } finally {
    if (!disposed && request === pageRequest) {
      loading.value = false
      await nextTick()
      fit(); queuePaint()
      if (ocrOpen.value) void recognizeText()
    }
  }
}
function commit() { history.commit({ layers: layers.value, watermark: watermark.value }); historyTick.value++; saved.value = false }
function queuePaint() { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint) }
function paint() {
  if (!canvas.value || !sourceImage.value || !screenshot.value) return
  const ctx = canvas.value.getContext('2d')!
  renderScene(ctx, sourceImage.value, screenshot.value.width, screenshot.value.height, layers.value, watermark.value)
  if (draft.value?.type === 'arrow') paintArrow(ctx, draft.value)
  else if (draft.value?.type === 'rectangle' || draft.value?.type === 'ellipse') paintShape(ctx, draft.value)
  else if (draft.value) {
    ctx.save(); ctx.fillStyle = '#8063d52b'; ctx.strokeStyle = '#8063d5'; ctx.lineWidth = 1.5 / scale.value
    ctx.fillRect(draft.value.x, draft.value.y, draft.value.width, draft.value.height)
    ctx.strokeRect(draft.value.x, draft.value.y, draft.value.width, draft.value.height); ctx.restore()
  }
  if (editing.value && selected.value) renderSelection(ctx, selected.value, scale.value)
}
function fit() {
  zoomRequest++
  fitMode.value = true
  if (!stage.value || !screenshot.value?.width || !screenshot.value.height) return
  scale.value = Math.max(.02, Math.min(1, (stage.value.clientWidth - 32) / screenshot.value.width, (stage.value.clientHeight - 32) / screenshot.value.height))
  void nextTick(() => { if (stage.value && fitMode.value) { stage.value.scrollLeft = 0; stage.value.scrollTop = 0 } })
  queuePaint()
}
async function zoom(value: number, anchor?: { x: number; y: number }) {
  if (!stage.value || !canvas.value || !screenshot.value) return
  const current = ++zoomRequest
  const viewport = stage.value.getBoundingClientRect()
  const focus = anchor || { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 }
  const point = imagePoint(focus.x, focus.y, canvas.value.getBoundingClientRect(), screenshot.value.width, screenshot.value.height)
  fitMode.value = false
  scale.value = Math.max(.05, Math.min(8, value))
  await nextTick()
  if (current !== zoomRequest || !canvas.value || !stage.value) return
  viewportSize.value = { width: stage.value.clientWidth, height: stage.value.clientHeight }
  await nextTick()
  if (current !== zoomRequest || !canvas.value || !stage.value) return
  const after = canvas.value.getBoundingClientRect()
  stage.value.scrollLeft += after.left + point.x * scale.value - focus.x
  stage.value.scrollTop += after.top + point.y * scale.value - focus.y
  queuePaint()
}
function wheel(event: WheelEvent) {
  if (!event.ctrlKey) return
  event.preventDefault()
  if (exportOpen.value || watermarkOpen.value || !stage.value?.contains(event.target as Node)) return
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.value.clientHeight : 1)
  void zoom(scale.value * Math.exp(-Math.max(-120, Math.min(120, pixels)) * .002), { x: event.clientX, y: event.clientY })
}
function setTool(value: Tool) { if (saving.value || loading.value) return; cancelDrag(); tool.value = value; selectedId.value = undefined }
async function toggleEditing() {
  if (saving.value || loading.value) return
  contextMenu.value.open = false
  cancelDrag()
  editing.value = !editing.value
  selectedId.value = undefined
  tool.value = 'select'
  try { await window.fanhua?.setPreviewLayout({ editing: editing.value, ocr: ocrOpen.value }) }
  catch { message.error('窗口大小调整失败，仍可继续编辑') }
  await nextTick()
  if (fitMode.value) fit()
  queuePaint()
}
function openImageContextMenu(event: MouseEvent) {
  event.preventDefault()
  if (!canvas.value || !screenshot.value || loading.value || error.value || saving.value || copying.value || sharing.value || exportOpen.value || watermarkOpen.value) return
  cancelDrag()
  const point = imagePoint(event.clientX, event.clientY, canvas.value.getBoundingClientRect(), screenshot.value.width, screenshot.value.height)
  const measure = textMeasure(canvas.value.getContext('2d')!)
  selectedId.value = hitTest(layers.value, point, 5 / scale.value, measure)?.id
  contextMenu.value = { open: true, x: event.clientX, y: event.clientY }
}
function closeImageContextMenu(restoreFocus: boolean) {
  contextMenu.value.open = false
  if (restoreFocus) canvas.value?.focus({ preventScroll: true })
}
async function contextCommand(command: 'edit' | 'finish' | 'copy' | 'save' | 'undo' | 'redo' | 'delete') {
  if (command === 'edit') {
    const target = selectedId.value
    if (!editing.value) await toggleEditing()
    tool.value = 'select'
    selectedId.value = target
    await nextTick()
    if (selectedText.value) textInput.value?.focus()
    else canvas.value?.focus({ preventScroll: true })
  } else if (command === 'finish') { if (editing.value) await toggleEditing() }
  else if (command === 'copy') await copy()
  else if (command === 'save') save()
  else {
    if (command === 'undo') undo()
    if (command === 'redo') redo()
    if (command === 'delete') deleteSelected()
    canvas.value?.focus({ preventScroll: true })
  }
}
function patchStyle(key: keyof TextStyle, value: string | number) {
  if (saving.value || loading.value) return
  if (key === 'size') value = Math.max(8, Math.min(200, Number(value) || 28))
  const patch = { [key]: value }
  defaults.value = { ...defaults.value, ...patch }
  if (selectedText.value) { Object.assign(selectedText.value, patch); commit() }
}
function patchText(value: string) { if (saving.value || loading.value) return; if (selectedText.value) { selectedText.value.text = value.slice(0, 4000); commit() } }
function patchColor(value: string) {
  if (saving.value || loading.value) return
  if (selectedShape.value) { selectedShape.value.color = value; defaults.value.color = value; commit() }
  else if (selected.value?.type === 'arrow') { selected.value.color = value; defaults.value.color = value; commit() }
  else patchStyle('color', value)
}
function patchShape(key: 'lineWidth' | 'borderStyle', input: number | BorderStyle) {
  if (saving.value || loading.value) return
  if (key === 'lineWidth') {
    const value = Math.max(1, Math.min(40, Number(input) || 1))
    shapeDefaults.value.lineWidth = value
    if (selectedShape.value) { selectedShape.value.lineWidth = value; commit() }
  } else {
    const value = input as BorderStyle
    if (!['solid', 'dashed', 'dotted'].includes(value)) return
    shapeDefaults.value.borderStyle = value
    if (selectedShape.value) { selectedShape.value.borderStyle = value; commit() }
  }
}
function patchArrow(key: 'lineWidth' | 'headSize', input: number) {
  if (saving.value || loading.value) return
  const value = Math.max(key === 'lineWidth' ? 1 : 6, Math.min(key === 'lineWidth' ? 40 : 160, input || 1))
  arrowDefaults.value[key] = value
  if (selected.value?.type === 'arrow') { selected.value[key] = value; commit() }
}
function patchHeadSize(input: number) {
  if (saving.value || loading.value) return
  const value = Math.max(16, Math.min(240, input || 50))
  markerHeadSize.value = value
  if (selected.value?.type === 'marker') { selected.value.headSize = value; commit() }
}
function patchNumberStyle(value: NumberStyle) {
  if (saving.value || loading.value) return
  numberStyle.value = value
  if (selected.value?.type === 'marker') { selected.value.style = value; commit() }
}
function patchNumber(value: number | null) {
  if (saving.value || loading.value) return
  if (selected.value?.type === 'marker') { selected.value.number = Math.max(1, Math.min(9999, value || 1)); commit() }
}
function patchStrength(value: number | [number, number]) {
  if (saving.value || loading.value) return
  const strength = Array.isArray(value) ? value[0] : value
  mosaicStrength.value = strength
  if (selected.value?.type === 'mosaic') { selected.value.strength = strength; commit() }
}
function deleteSelected() {
  if (saving.value || loading.value) return
  cancelDrag()
  if (!selected.value) return
  layers.value = layers.value.filter(layer => layer.id !== selectedId.value)
  selectedId.value = undefined
  commit()
}
function restore(document: EditorDocument) { watermarkRequest++; layers.value = document.layers; watermark.value = document.watermark; historyTick.value++; selectedId.value = undefined; saved.value = false }
function undo() { if (saving.value || loading.value) return; cancelDrag(); if (history.canUndo) restore(history.undo()) }
function redo() { if (saving.value || loading.value) return; cancelDrag(); if (history.canRedo) restore(history.redo()) }
async function refreshFonts(refresh = false) {
  if (fontsLoading.value) return
  if (!window.fanhua) { if (refresh) message.info('桌面版可读取系统中安装的全部字体'); return }
  fontsLoading.value = true; fontsError.value = ''
  try { fonts.value = [...new Set([...fonts.value, ...await window.fanhua.getFonts(refresh)])].sort((a, b) => a.localeCompare(b)) }
  catch (cause) { fontsError.value = cause instanceof Error ? cause.message : '系统字体读取失败'; message.error(fontsError.value) }
  finally { fontsLoading.value = false }
}
async function setWatermark(config: WatermarkConfig) {
  if (saving.value || loading.value) return
  const current = ++watermarkRequest
  try {
    if (config.enabled && config.kind === 'image' && config.imageDataUrl) await loadWatermarkImage(config.imageDataUrl)
    if (current !== watermarkRequest) return
    watermark.value = { ...config }; commit()
  } catch (cause) { message.error(cause instanceof Error ? cause.message : '水印图片读取失败') }
}
function pointerPosition(event: PointerEvent) {
  return imagePoint(event.clientX, event.clientY, canvas.value!.getBoundingClientRect(), screenshot.value!.width, screenshot.value!.height)
}
function pointerDown(event: PointerEvent) {
  if (!canvas.value || !screenshot.value || event.button !== 0 || saving.value || loading.value) return
  const point = pointerPosition(event)
  const measure = textMeasure(canvas.value.getContext('2d')!)
  if (ocrOpen.value && (!editing.value || tool.value === 'select')) {
    const annotation = editing.value && hitTest(layers.value, point, 5 / scale.value, measure)
    const handle = editing.value && selectedShape.value && shapeHandleAt(selectedShape.value, point, 9 / scale.value)
    const arrowEnd = editing.value && selected.value?.type === 'arrow' && arrowEndpointAt(selected.value, point, 9 / scale.value)
    const paragraph = !annotation && !handle && !arrowEnd && hitOcrParagraph(ocrParagraphs.value, point)
    if (paragraph) { event.preventDefault(); canvas.value.focus(); selectedId.value = undefined; selectParagraph(paragraph.id, false); return }
  }
  if (!editing.value) return
  event.preventDefault()
  canvas.value.focus()
  canvas.value.setPointerCapture(event.pointerId)
  if (tool.value === 'select') {
    const shapeHandle = selectedShape.value && shapeHandleAt(selectedShape.value, point, 9 / scale.value)
    if (shapeHandle && selectedShape.value) {
      drag = { origin: point, layer: { ...selectedShape.value }, moved: false, pointerId: event.pointerId, shapeHandle }
      return
    }
    const endpoint = selected.value?.type === 'arrow' ? arrowEndpointAt(selected.value, point, 9 / scale.value) : undefined
    if (endpoint && selected.value) {
      drag = { origin: point, layer: { ...selected.value }, moved: false, pointerId: event.pointerId, endpoint }
      return
    }
    const found = hitTest(layers.value, point, 5 / scale.value, measure)
    selectedId.value = found?.id
    drag = { origin: point, layer: found ? { ...found } : undefined, moved: false, pointerId: event.pointerId }
  } else if (tool.value === 'mosaic' || tool.value === 'arrow' || tool.value === 'rectangle' || tool.value === 'ellipse') {
    selectedId.value = undefined
    drag = { origin: point, moved: false, pointerId: event.pointerId }
    draft.value = tool.value === 'arrow'
      ? { id: crypto.randomUUID(), type: 'arrow', x: point.x, y: point.y, endX: point.x, endY: point.y, color: defaults.value.color, ...arrowDefaults.value }
      : tool.value === 'mosaic' ? { id: crypto.randomUUID(), type: 'mosaic', x: point.x, y: point.y, width: 0, height: 0, strength: mosaicStrength.value }
      : { id: crypto.randomUUID(), type: tool.value, x: point.x, y: point.y, width: 0, height: 0, color: defaults.value.color, ...shapeDefaults.value }
  } else {
    const common = { id: crypto.randomUUID(), x: point.x, y: point.y, ...defaults.value }
    const layer: Layer = tool.value === 'text'
      ? { ...common, type: 'text', text: '在这里写下批注' }
      : { ...common, type: 'marker', number: Math.max(0, ...layers.value.filter(l => l.type === 'marker').map(l => l.number)) + 1, style: numberStyle.value, headSize: markerHeadSize.value, text: '' }
    layers.value.push(moveLayer(layer, 0, 0, screenshot.value.width, screenshot.value.height, measure))
    selectedId.value = layer.id
    commit()
    if (tool.value === 'text') { tool.value = 'select'; nextTick(() => { textInput.value?.focus(); textInput.value?.select() }) }
  }
}
function pointerMove(event: PointerEvent) {
  if (canvas.value && screenshot.value && ocrOpen.value && translationState.value.open && !drag) {
    hoveredParagraphId.value = hitOcrParagraph(ocrParagraphs.value, pointerPosition(event))?.id
  } else hoveredParagraphId.value = undefined
  if (!drag || drag.pointerId !== event.pointerId || !screenshot.value || !canvas.value) return
  const point = pointerPosition(event)
  const dx = point.x - drag.origin.x
  const dy = point.y - drag.origin.y
  if (Math.hypot(dx, dy) > 2 / scale.value) drag.moved = true
  if (draft.value?.type === 'arrow') { draft.value.endX = point.x; draft.value.endY = point.y }
  else if (draft.value?.type === 'rectangle' || draft.value?.type === 'ellipse') Object.assign(draft.value, shapeRect(drag.origin, point, screenshot.value.width, screenshot.value.height, event.shiftKey))
  else if (draft.value) Object.assign(draft.value, normalizeRect(drag.origin, point, screenshot.value.width, screenshot.value.height))
  else if (drag.layer && drag.moved) {
    const index = layers.value.findIndex(l => l.id === drag!.layer!.id)
    if (index < 0) return
    if (drag.shapeHandle && (drag.layer.type === 'rectangle' || drag.layer.type === 'ellipse')) {
      layers.value[index] = resizeShape(drag.layer, drag.shapeHandle, point, screenshot.value.width, screenshot.value.height, event.shiftKey)
    } else if (drag.endpoint && drag.layer.type === 'arrow') {
      layers.value[index] = { ...drag.layer, ...(drag.endpoint === 'start' ? { x: point.x, y: point.y } : { endX: point.x, endY: point.y }) }
    } else layers.value[index] = moveLayer(drag.layer, dx, dy, screenshot.value.width, screenshot.value.height, textMeasure(canvas.value.getContext('2d')!))
  }
}
function pointerUp(event: PointerEvent) {
  if (drag && drag.pointerId !== event.pointerId) return
  if (draft.value && (draft.value.type === 'arrow' ? Math.hypot(draft.value.endX - draft.value.x, draft.value.endY - draft.value.y) >= 3 : draft.value.width >= 3 && draft.value.height >= 3)) {
    layers.value.push({ ...draft.value }); selectedId.value = draft.value.id; commit()
    if (draft.value.type !== 'mosaic') tool.value = 'select'
  } else if (drag?.layer && drag.moved) commit()
  draft.value = undefined
  drag = undefined
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId)
}
function pointerCancel(event: PointerEvent) {
  if (drag && drag.pointerId !== event.pointerId) return
  cancelDrag()
}
function cancelDrag() {
  const pointerId = drag?.pointerId
  if (drag?.layer) {
    const index = layers.value.findIndex(l => l.id === drag!.layer!.id)
    if (index >= 0) layers.value[index] = drag.layer
  }
  draft.value = undefined; drag = undefined
  if (pointerId !== undefined && canvas.value?.hasPointerCapture(pointerId)) canvas.value.releasePointerCapture(pointerId)
}
function doubleClick() { if (editing.value && selectedText.value) { textInput.value?.focus(); textInput.value?.select() } }
async function composeCanvas(source: HTMLImageElement, documentState: EditorDocument, format: ImageFormat = 'png'): Promise<HTMLCanvasElement> {
  const documentLayers = documentState.layers
  const documentWatermark = documentState.watermark
  if (documentWatermark.enabled && documentWatermark.kind === 'image' && !documentWatermark.imageDataUrl) throw new Error('请先选择水印图片或关闭水印')
  if (documentWatermark.enabled && documentWatermark.kind === 'image' && documentWatermark.imageDataUrl) await loadWatermarkImage(documentWatermark.imageDataUrl)
  const fontRequests = documentLayers.filter(layer => layer.type === 'text' || layer.type === 'marker').map(layer => document.fonts.load(canvasFont(layer.font, layer.size), layer.text || '繁花有图'))
  if (documentWatermark.enabled && documentWatermark.kind === 'text') fontRequests.push(document.fonts.load(canvasFont(documentWatermark.font, documentWatermark.fontSize), documentWatermark.text))
  await Promise.all(fontRequests)
  await document.fonts.ready
  const output = document.createElement('canvas')
  output.width = source.naturalWidth; output.height = source.naturalHeight
  const context = output.getContext('2d')!
  renderScene(context, source, output.width, output.height, documentLayers, documentWatermark)
  if (format === 'jpeg' || format === 'bmp') {
    context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height)
  }
  return output
}
async function exportCanvas(format: ImageFormat = 'png'): Promise<HTMLCanvasElement> {
  if (!sourceImage.value || !screenshot.value) throw new Error('图片尚未加载完成')
  return composeCanvas(sourceImage.value, currentDocument(), format)
}
async function exportImage(format: ImageFormat = 'png', quality = 92): Promise<string> {
  const output = await exportCanvas(format)
  return output.toDataURL(format === 'bmp' ? 'image/png' : `image/${format}`, Math.max(.01, Math.min(1, quality / 100)))
}
function save() {
  if (saving.value || loading.value || error.value || copying.value || sharing.value) return
  cancelDrag()
  exportOpen.value = true
}
async function cancelPdfExport() {
  if (!saving.value || !pdfProgress.value || pdfProgress.value.finalizing) return
  pdfCanceling.value = true
  pdfSource?.cancelRender()
  if (pdfSaveJob) {
    try { await window.fanhua?.cancelPdfSave(pdfSaveJob) }
    catch { /* The export path owns cleanup and reports actual save failures. */ }
  }
}
async function exportPdf(options: ExportOptions): Promise<boolean> {
  const api = window.fanhua
  if (!api) { message.info('PDF 保存请在 Windows 桌面版使用。'); return false }
  if (!sourceImage.value || !screenshot.value) throw new Error('页面尚未加载完成')
  retainCurrentPage()
  const pages = pdfSource && options.scope !== 'current' ? Array.from({ length: pdfPageCount.value }, (_, index) => index + 1) : [pdfPage.value]
  const documents = new Map(pages.map(page => [page, pdfSource ? copyPageDocument(pageStates.get(page).document) : currentDocument()]))
  const currentImage = sourceImage.value
  pdfProgress.value = { completed: 0, total: pages.length, finalizing: false }
  let finished = false
  try {
    const job = await api.beginPdfSave({ pageCount: pages.length, ...(pdfName.value ? { name: pdfName.value } : {}) })
    if (job.canceled || !job.jobId) return false
    pdfSaveJob = job.jobId
    for (const page of pages) {
      if (pdfCanceling.value || disposed) return false
      let source = currentImage
      let widthPoints = currentImage.naturalWidth * 72 / 96
      let heightPoints = currentImage.naturalHeight * 72 / 96
      if (pdfSource) {
        const rendered = await pdfSource.renderPage(page)
        if (pdfCanceling.value || disposed) return false
        source = await readImage(rendered.dataUrl)
        widthPoints = rendered.widthPoints; heightPoints = rendered.heightPoints
      }
      let output: HTMLCanvasElement | undefined
      try {
        if (pdfCanceling.value || disposed) return false
        output = await composeCanvas(source, documents.get(page)!)
        if (pdfCanceling.value || disposed) return false
        const dataUrl = output.toDataURL('image/png')
        output.width = 0; output.height = 0
        await api.appendPdfPage(job.jobId, { dataUrl, widthPoints, heightPoints })
        if (!disposed) pdfProgress.value = { completed: (pdfProgress.value?.completed || 0) + 1, total: pages.length, finalizing: false }
      } finally {
        if (output) { output.width = 0; output.height = 0 }
        if (source !== currentImage) source.src = ''
      }
    }
    if (pdfCanceling.value || disposed) return false
    pdfProgress.value = { completed: pages.length, total: pages.length, finalizing: true }
    const result = await api.finishPdfSave(job.jobId)
    if (result.canceled || disposed) return false
    finished = true
    if (pdfSource) pageStates.markSaved(pages)
    if (pages.includes(pdfPage.value)) saved.value = true
    return true
  } finally {
    const jobId = pdfSaveJob
    pdfSaveJob = undefined
    if (jobId && !finished) await api.cancelPdfSave(jobId).catch(() => {})
  }
}
async function confirmSave(options: ExportOptions) {
  if (saving.value || loading.value || error.value) return
  cancelDrag(); watermarkRequest++
  saving.value = true
  pdfCanceling.value = false
  try {
    if (options.format === 'pdf') {
      if (await exportPdf(options)) { exportOpen.value = false; message.success('PDF 已保存') }
      return
    }
    if (!window.fanhua) throw new Error('图片保存仅在 Windows 桌面版中可用。')
    const result = await window.fanhua.saveImage(await exportImage(options.format, options.quality), { format: options.format, quality: options.quality })
    if (result.canceled) return
    saved.value = true; retainCurrentPage(); exportOpen.value = false; message.success(pdfSource ? '当前页图片已保存' : '图片已保存')
  } catch (cause) { if (!pdfCanceling.value && !disposed) message.error(cause instanceof Error ? cause.message : '保存失败，请重试') }
  finally {
    if (!disposed) {
      if (pdfCanceling.value) { exportOpen.value = false; message.info('已取消导出') }
      saving.value = false; pdfProgress.value = undefined; pdfCanceling.value = false
    }
  }
}
function actionError(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : fallback
}
async function copy(mode: 'png' | 'deskflow' = 'png') {
  if (loading.value || error.value || copying.value || sharing.value || saving.value) return
  if (!window.fanhua) { message.info('图片复制仅在 Windows 桌面版中可用。'); return }
  copying.value = mode
  try {
    const dataUrl = await exportImage(mode === 'deskflow' ? 'jpeg' : 'png', mode === 'deskflow' ? 60 : 92)
    await window.fanhua.copyImage(dataUrl, mode)
    message.success(mode === 'deskflow' ? '已复制 DeskFlow 图片（JPG 60%）' : '已复制图片')
  } catch (cause) { message.error(actionError(cause, '复制失败，请使用保存图片')) }
  finally { copying.value = null }
}
async function shareViaLocalSend() {
  if (loading.value || error.value || sharing.value || copying.value || saving.value) return
  if (!window.fanhua) { message.info('LocalSend 共享需在桌面版运行。'); return }
  sharing.value = true
  try {
    const result = await window.fanhua.shareViaLocalSend(await exportImage('png'))
    if (!result.canceled) message.success('已交给 LocalSend，请选择接收设备')
  } catch (cause) { message.error(actionError(cause, '无法唤起 LocalSend，请重试')) }
  finally { sharing.value = false }
}
async function setOcrOpen(open: boolean) {
  cancelDrag()
  ocrOpen.value = open
  if (!open) {
    if (pendingOcrPage) ocrBusy.value = false
    pendingOcrPage = undefined
    void translation.cancel(false)
  }
  try { await window.fanhua?.setPreviewLayout({ editing: editing.value, ocr: open }) }
  catch { message.error('窗口大小调整失败，仍可继续使用识别面板') }
  await nextTick()
  if (fitMode.value) fit()
}
async function toggleOcr() {
  if (loading.value || error.value || saving.value) return
  const open = !ocrOpen.value
  await setOcrOpen(open)
  if (open && !ocrHasResult.value && !ocrBusy.value) void recognizeText()
}
async function showTranslation() {
  if (loading.value || error.value || saving.value) return
  await setOcrOpen(true)
  void translation.setOpen(true)
  if (!ocrHasResult.value && !ocrBusy.value) void recognizeText()
}
async function recognizeText() {
  if (disposed || ocrBusy.value || loading.value || error.value || !screenshot.value) return
  if (!window.fanhua) { ocrError.value = '文字识别需在桌面版运行。'; return }
  if (ocrInFlight) {
    // The native OCR engine accepts one task at a time. Keep only the latest
    // page ID while the previous page finishes, without retaining its bitmap
    // or issuing busy retries for each page the user passes through.
    pendingOcrPage = screenshot.value.id
    ocrBusy.value = true; ocrError.value = ''
    return
  }
  ocrInFlight = true
  translation.reset()
  const request = ++ocrRequest
  const source = screenshot.value
  ocrBusy.value = true; ocrError.value = ''
  // OCR always reads the immutable image opened in this preview. The composed
  // export also contains annotations, watermarks and mosaics and is not OCR input.
  try {
    const data = source.dataUrl
    const capabilities = await window.fanhua.getOcrCapabilities()
    if (request !== ocrRequest) return
    ocrCapabilities.value = capabilities
    if (!capabilities.available) throw new Error(capabilities.reason || '当前系统无法使用文字识别')
    const result = await window.fanhua.recognizeText(data, ocrLanguage.value)
    if (request !== ocrRequest || screenshot.value?.id !== source.id) return
    ocrParagraphs.value = result.paragraphs.flatMap(paragraph => {
      const bounds = clipOcrBounds(paragraph.bounds, source.width, source.height)
      return bounds ? [{ ...paragraph, bounds }] : []
    })
    selectedParagraphId.value = undefined
    ocrHasResult.value = true
  } catch (cause) {
    if (request === ocrRequest) ocrError.value = cause instanceof Error ? cause.message : '文字识别失败，请重试'
  } finally {
    ocrInFlight = false
    const pendingPage = pendingOcrPage
    pendingOcrPage = undefined
    if (request === ocrRequest || pendingPage) ocrBusy.value = false
    if (pendingPage && !disposed && ocrOpen.value && !loading.value && !error.value && screenshot.value?.id === pendingPage) void recognizeText()
  }
}
function selectParagraph(id: string, locateImage = true) {
  const paragraph = ocrParagraphs.value.find(item => item.id === id)
  if (!paragraph) return
  selectedParagraphId.value = id
  void nextTick(() => ocrSidebar.value?.revealSelection())
  if (!locateImage || !canvas.value || !stage.value) return
  const viewport = stage.value.getBoundingClientRect()
  const image = canvas.value.getBoundingClientRect()
  const bounds = paragraph.bounds
  const left = image.left + bounds.x * scale.value, top = image.top + bounds.y * scale.value
  const width = bounds.width * scale.value, height = bounds.height * scale.value
  if (left < viewport.left + 12 || left + width > viewport.right - 12) stage.value.scrollLeft += left + width / 2 - viewport.left - viewport.width / 2
  if (top < viewport.top + 12 || top + height > viewport.bottom - 12) stage.value.scrollTop += top + height / 2 - viewport.top - viewport.height / 2
}
function editParagraph(id: string, text: string) {
  const paragraph = ocrParagraphs.value.find(item => item.id === id)
  if (paragraph) paragraph.text = text.slice(0, 100000)
}
function paragraphStyle(paragraph: OcrParagraph) {
  const bounds = paragraph.bounds
  return { left: `${bounds.x * scale.value}px`, top: `${bounds.y * scale.value}px`, width: `${bounds.width * scale.value}px`, height: `${bounds.height * scale.value}px` }
}
function translatedText(paragraph: OcrParagraph) {
  const result = translationState.value.results[paragraph.id]
  return translationState.value.open && result?.sourceText === paragraph.text ? result.text : ''
}
function paragraphLineHeight(paragraph: OcrParagraph) {
  const heights = paragraph.lines.map(line => line.bounds.height).filter(height => Number.isFinite(height) && height > 0)
  return heights.length ? heights.reduce((sum, height) => sum + height, 0) / heights.length : paragraph.bounds.height
}
async function togglePin() {
  if (!window.fanhua) { message.info('桌面版支持将图片固定在其他窗口上方'); return }
  try { pinned.value = await window.fanhua.setPinned(!pinned.value) } catch { message.error('固定窗口失败') }
}
async function close() { await window.fanhua?.closeWindow() }
async function minimize() { await window.fanhua?.minimizeWindow() }
async function openSettings() {
  try { await window.fanhua?.openSettings() }
  catch { message.error('无法打开设置，请通过托盘重试') }
}
async function loadPreferences() {
  if (!window.fanhua) return
  try {
    const value = await window.fanhua.getSettings()
    if (disposed) return
    preferences.value = value
    const editor = value.editor
    defaults.value = { font: editor.font, size: editor.size, color: editor.color }
    numberStyle.value = editor.markerStyle
    markerHeadSize.value = editor.markerHeadSize
    arrowDefaults.value = { lineWidth: editor.arrowLineWidth, headSize: editor.arrowHeadSize }
    shapeDefaults.value = { lineWidth: editor.shapeLineWidth, borderStyle: editor.shapeBorderStyle }
    mosaicStrength.value = editor.mosaicStrength
    ocrLanguage.value = value.ocrLanguage
    translation.changeDirection(value.translationDirection)
  } catch { message.warning('无法读取偏好设置，本窗口使用默认选项') }
}
function keyDown(event: KeyboardEvent) {
  if (exportOpen.value || watermarkOpen.value || saving.value || loading.value) return
  const target = event.target as HTMLElement
  if (target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],.ant-select,.ocr-sidebar')) return
  if (event.key === 'Escape' && drag) { event.preventDefault(); cancelDrag(); return }
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); void copy() }
    if (editing.value && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
    if (editing.value && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    return
  }
  if (event.key === 'Escape') { if (selectedId.value) selectedId.value = undefined; else if (ocrOpen.value) void setOcrOpen(false); else if (editing.value) void toggleEditing(); return }
  if (!editing.value) return
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected() }
  const shortcutTools: Record<string, Tool> = { v: 'select', t: 'text', n: 'marker', a: 'arrow', r: 'rectangle', o: 'ellipse', m: 'mosaic' }
  const chosen = shortcutTools[event.key.toLowerCase()]
  if (chosen) setTool(chosen)
  if (selected.value && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && screenshot.value && canvas.value) {
    event.preventDefault()
    const step = event.shiftKey ? 10 : 1
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    Object.assign(selected.value, moveLayer(selected.value, dx, dy, screenshot.value.width, screenshot.value.height, textMeasure(canvas.value.getContext('2d')!)))
    commit()
  }
}
function layerTitle(layer: Layer) { return layer.type === 'mosaic' ? '马赛克区域' : layer.type === 'arrow' ? '箭头标注' : layer.type === 'rectangle' ? '方框标注' : layer.type === 'ellipse' ? '圆形标注' : layer.type === 'marker' ? `${sequenceLabel(layer.number, layer.style)} · ${layer.text || '步骤标识'}` : layer.text || '空白文字' }
function selectLayer(layer: Layer) { if (saving.value || loading.value) return; cancelDrag(); selectedId.value = layer.id; tool.value = 'select' }
watch([layers, selectedId, editing, draft, scale, watermark], queuePaint, { deep: true })
watch(() => watermark.value.imageDataUrl, async value => {
  if (!value) return
  try { await loadWatermarkImage(value); queuePaint() } catch { message.error('水印图片读取失败') }
})
onMounted(async () => {
  window.addEventListener('keydown', keyDown)
  window.addEventListener('blur', cancelDrag)
  window.addEventListener('wheel', wheel, { passive: false })
  resizeObserver = new ResizeObserver(() => {
    if (stage.value) viewportSize.value = { width: stage.value.clientWidth, height: stage.value.clientHeight }
    if (fitMode.value) fit()
  })
  if (stage.value) resizeObserver.observe(stage.value)
  try {
    if (!window.fanhua) throw new Error('图片编辑仅在 Windows 桌面版中可用，请启动繁花有图桌面应用。')
    await loadPreferences()
    const initial = await window.fanhua.getPreview()
    if (disposed) return
    originalScreenshot = { ...initial, pdf: undefined }
    screenshot.value = initial
    if (initial.pdf) {
      pdfName.value = initial.pdf.name
      const document = await openPdf(initial.pdf.bytes)
      if (disposed) { await document.destroy(); return }
      pdfSource = document
      pdfPageCount.value = document.pageCount
      const rendered = await document.renderPage(1)
      if (disposed) return
      screenshot.value = { ...originalScreenshot, id: `${initial.id}:page:1`, dataUrl: rendered.dataUrl, width: rendered.width, height: rendered.height }
    }
    const img = await readImage(screenshot.value.dataUrl)
    if (disposed) return
    sourceImage.value = img
    screenshot.value.width = img.naturalWidth; screenshot.value.height = img.naturalHeight
    loading.value = false
    await nextTick()
    if (screenshot.value.initialEditing) await toggleEditing()
    if (stage.value) viewportSize.value = { width: stage.value.clientWidth, height: stage.value.clientHeight }
    fit(); queuePaint()
    void refreshFonts()
  } catch (cause) { if (!disposed) { error.value = cause instanceof Error ? cause.message : '图片加载失败'; loading.value = false } }
})
onBeforeUnmount(() => {
  disposed = true; pageRequest++; ocrRequest++; watermarkRequest++
  if (pdfSaveJob) void window.fanhua?.cancelPdfSave(pdfSaveJob).catch(() => {})
  void pdfSource?.destroy().catch(() => {})
  window.removeEventListener('keydown', keyDown); window.removeEventListener('blur', cancelDrag); window.removeEventListener('wheel', wheel); resizeObserver?.disconnect(); cancelAnimationFrame(frame)
})
</script>

<template>
  <div class="preview-app">
    <header class="titlebar drag-region">
      <div class="brand"><Flower2 :size="16" /><span>繁花有图</span><span class="window-name">{{ editing ? '编辑' : '预览' }}</span></div>
      <div class="window-controls no-drag"><button class="icon-button" aria-label="打开设置" title="偏好设置" :disabled="!isDesktop" @click="openSettings"><Settings :size="15" /></button><button class="icon-button" aria-label="最小化窗口" :disabled="!isDesktop" @click="minimize"><Minus :size="16" /></button><button class="icon-button danger" aria-label="关闭窗口不保存" title="关闭窗口，不自动保存" :disabled="!isDesktop" @click="close"><X :size="17" /></button></div>
    </header>
    <div class="preview-topbar">
      <div class="file-identity"><ImageIcon :size="14" /><span>{{ screenshot ? `${screenshot.width} × ${screenshot.height}` : '读取图片…' }}</span><span v-if="layers.length" class="annotation-count">{{ layers.length }} 个标注</span></div>
      <div class="primary-actions">
        <AButton size="small" type="text" :class="{ 'is-pinned': pinned }" :title="pinned ? '取消置顶' : '固定到屏幕前方'" aria-label="固定窗口" :aria-pressed="pinned" @click="togglePin"><template #icon><PinOff v-if="pinned" :size="15" /><Pin v-else :size="15" /></template><span class="action-label">{{ pinned ? '已固定' : '固定' }}</span></AButton>
        <ShareActions :disabled="loading || !!error || saving" :desktop="isDesktop" :copying="copying" :sharing="sharing" @copy="copy" @share="shareViaLocalSend" />
        <AButton size="small" type="text" :disabled="loading || !!error || saving" :class="{ 'edit-active': ocrOpen }" :aria-pressed="ocrOpen" aria-label="识别文字" title="显示或收起文字识别面板" @click="toggleOcr"><template #icon><ScanText :size="15" /></template><span class="action-label">识别文字</span></AButton>
        <AButton size="small" type="text" :disabled="loading || !!error || saving" :class="{ 'edit-active': ocrOpen && translationState.open }" aria-label="中英翻译" title="在图片原文位置和段落列表显示中英译文" @click="showTranslation"><template #icon><Languages :size="15" /></template><span class="action-label">翻译</span></AButton>
        <AButton size="small" type="text" :disabled="loading || !!error || saving" :class="{ 'edit-active': watermark.enabled }" aria-label="水印设置" title="添加文字或图片水印" @click="watermarkOpen = true"><template #icon><Stamp :size="15" /></template><span class="action-label">水印</span></AButton>
        <AButton size="small" type="text" :disabled="loading || !!error || saving" aria-label="进入编辑模式" :title="editing ? '完成编辑' : '编辑图片'" :class="{ 'edit-active': editing }" @click="toggleEditing"><template #icon><Check v-if="editing" :size="15" /><Pencil v-else :size="15" /></template><span class="action-label">{{ editing ? '完成' : '编辑' }}</span></AButton>
        <AButton size="small" type="primary" :loading="saving" :disabled="loading || !!error || !!copying || sharing" aria-label="保存图片" title="选择格式并保存 Ctrl+S" @click="save"><template #icon><Download :size="15" /></template><span class="action-label">保存</span></AButton>
      </div>
    </div>
    <PdfPageBar v-if="pdfPageCount" :page="pdfPage" :total="pdfPageCount" :name="pdfName" :busy="loading || saving || !!copying || sharing" @navigate="navigatePdfPage" />
    <div v-if="editing" class="editor-toolbar" :inert="saving || loading">
      <div class="tool-list"><button v-for="item in tools" :key="item.id" class="tool-button" :class="{ active: tool === item.id }" :aria-label="item.label + '工具'" :aria-pressed="tool === item.id" :title="`${item.label} (${item.key})`" @click="setTool(item.id)"><component :is="item.icon" :size="18" /><span>{{ item.label }}</span><kbd>{{ item.key }}</kbd></button></div>
      <div class="history-actions"><button class="icon-button" aria-label="撤销" title="撤销 Ctrl+Z" :disabled="!canUndo" @click="undo"><Undo2 :size="18" /></button><button class="icon-button" aria-label="重做" title="重做 Ctrl+Y" :disabled="!canRedo" @click="redo"><Redo2 :size="18" /></button><i></i><button class="icon-button danger" aria-label="删除选中标注" title="删除选中标注 Delete" :disabled="!selected" @click="deleteSelected"><Trash2 :size="17" /></button></div>
    </div>
    <main class="workspace" :class="{ editing }">
      <section class="image-workspace">
        <div ref="stage" class="image-stage">
          <div v-if="loading || error" class="load-state"><ImageIcon :size="28" /><h2>{{ error || '正在读取图片…' }}</h2><p v-if="error && isDesktop">请重新截图或打开图片</p></div>
          <div v-else-if="screenshot" class="canvas-surface" :style="surfaceStyle">
          <div class="canvas-wrapper" :style="{ width: `${screenshot.width * scale}px`, height: `${screenshot.height * scale}px` }">
            <canvas ref="canvas" :width="screenshot.width" :height="screenshot.height" :style="{ width: '100%', height: '100%', cursor: !editing ? 'default' : tool === 'select' ? 'default' : 'crosshair' }" :title="hoveredTranslation" tabindex="0" role="img" aria-label="截图编辑画布" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerleave="hoveredParagraphId = undefined" @pointerup="pointerUp" @pointercancel="pointerCancel" @lostpointercapture="pointerCancel" @dblclick="doubleClick" @contextmenu="openImageContextMenu"></canvas>
            <div v-if="ocrOpen" class="ocr-regions" aria-hidden="true">
              <div v-for="(paragraph, index) in ocrParagraphs" :key="paragraph.id" class="ocr-region" :class="{ active: selectedParagraphId === paragraph.id, translated: !!translatedText(paragraph) }" :style="paragraphStyle(paragraph)">
                <TranslationOverlay v-if="translatedText(paragraph)" :text="translatedText(paragraph)" :source-line-height="paragraphLineHeight(paragraph)" :scale="scale" />
                <span v-else>{{ index + 1 }}</span>
              </div>
            </div>
          </div>
          </div>
        </div>
      </section>
      <aside v-if="editing" class="inspector" :inert="saving || loading">
        <div class="inspector-heading"><h2>{{ selected ? '标注属性' : '工具样式' }}</h2><span>{{ selected ? '已选中' : '新建标注' }}</span></div>
        <div class="properties">
          <template v-if="inspectorType === 'text' || inspectorType === 'marker'">
            <label v-if="selectedText" class="field-label">{{ selectedText.type === 'marker' ? '步骤说明' : '文字内容' }}<textarea ref="textInput" aria-label="标注文字内容" class="annotation-textarea" :value="selectedText.text" :placeholder="selectedText.type === 'marker' ? '说明（可选）' : '输入批注文字'" rows="2" maxlength="4000" @input="patchText(($event.target as HTMLTextAreaElement).value)"></textarea></label>
            <template v-if="inspectorType === 'marker'">
              <label class="field-label">序号方式<ASelect size="small" aria-label="序号方式" :value="activeNumberStyle" :options="[{ value: 'number', label: '1, 2, 3 · 阿拉伯数字' }, { value: 'letter', label: 'A, B, C · 字母' }, { value: 'chinese', label: '壹, 贰, 叁 · 中文大写' }]" @change="value => patchNumberStyle(value as NumberStyle)" /></label>
              <label v-if="selected?.type === 'marker'" class="field-label">序号数值<AInputNumber size="small" aria-label="序号数值" :value="selected.number" :min="1" :max="9999" :precision="0" @change="value => patchNumber(Number(value))" /></label>
              <label class="field-label">序号头大小<AInputNumber size="small" aria-label="序号头大小" :value="activeHeadSize" :min="16" :max="240" :precision="0" addon-after="px" @change="value => patchHeadSize(Number(value))" /></label>
            </template>
            <div class="field-label"><div class="font-heading"><span>字体 <small>{{ fontsLoading ? '读取中…' : `${fonts.length} 种` }}</small></span><button class="icon-button font-refresh" aria-label="刷新系统字体" :disabled="fontsLoading" title="重新读取系统中安装的全部字体" @click="refreshFonts(true)"><RefreshCw :size="12" :class="{ spinning: fontsLoading }" /></button></div><ASelect size="small" aria-label="标注字体" show-search :value="properties.font" :options="fontOptions" :loading="fontsLoading" :filter-option="filterFonts" placeholder="搜索系统字体" @change="value => patchStyle('font', String(value))"><template #option="{ value }"><span :style="{ fontFamily: String(value) }">{{ value }}</span></template></ASelect><span v-if="fontsError" class="font-error">{{ fontsError }}</span></div>
            <div class="style-row"><label class="field-label">{{ inspectorType === 'marker' ? '说明字号' : '字号' }}<AInputNumber size="small" aria-label="标注字号" :value="properties.size" :min="8" :max="200" :precision="0" addon-after="px" @change="value => patchStyle('size', Number(value))" /></label><label class="field-label color-label">颜色<div class="custom-color"><input type="color" aria-label="自定义标注颜色" :value="activeColor" @input="patchColor(($event.target as HTMLInputElement).value)" /><span>{{ activeColor.toUpperCase() }}</span></div></label></div>
            <div class="color-palette"><button v-for="color in colors" :key="color" :style="{ background: color }" :class="{ chosen: activeColor === color }" :aria-label="`颜色 ${color}`" @click="patchColor(color)"><Check v-if="activeColor === color" :size="13" :color="color === '#ffffff' || color === '#f4d44d' ? '#38313c' : '#fff'" /></button></div>
            <p class="property-tip">{{ selected ? '选中标注可修改，拖动可移动。' : toolHint }}</p>
          </template>
          <template v-else-if="inspectorType === 'arrow'">
            <div class="mosaic-symbol"><ArrowUpRight :size="22" /><strong>箭头标注</strong></div>
            <label class="field-label">线宽<AInputNumber size="small" aria-label="箭头线宽" :value="activeArrow.lineWidth" :min="1" :max="40" :precision="0" addon-after="px" @change="value => patchArrow('lineWidth', Number(value))" /></label>
            <label class="field-label">箭头头大小<AInputNumber size="small" aria-label="箭头头大小" :value="activeArrow.headSize" :min="6" :max="160" :precision="0" addon-after="px" @change="value => patchArrow('headSize', Number(value))" /></label>
            <label class="field-label">颜色<div class="custom-color"><input type="color" aria-label="自定义标注颜色" :value="activeColor" @input="patchColor(($event.target as HTMLInputElement).value)" /><span>{{ activeColor.toUpperCase() }}</span></div></label>
            <div class="color-palette"><button v-for="color in colors" :key="color" :style="{ background: color }" :class="{ chosen: activeColor === color }" :aria-label="`颜色 ${color}`" @click="patchColor(color)"><Check v-if="activeColor === color" :size="13" :color="color === '#ffffff' || color === '#f4d44d' ? '#38313c' : '#fff'" /></button></div>
            <p class="property-tip">拖动箭身可移动；拖动两端圆点可调整方向和长度。</p>
          </template>
          <template v-else-if="inspectorType === 'rectangle' || inspectorType === 'ellipse'">
            <div class="mosaic-symbol"><Square v-if="inspectorType === 'rectangle'" :size="21" /><Circle v-else :size="21" /><strong>{{ inspectorType === 'rectangle' ? '方框标注' : '圆形标注' }}</strong></div>
            <label class="field-label">边框类型<ASelect size="small" aria-label="边框类型" :value="activeShape.borderStyle" :options="[{ value: 'solid', label: '实线' }, { value: 'dashed', label: '虚线' }, { value: 'dotted', label: '点线' }]" @change="value => patchShape('borderStyle', value as BorderStyle)" /></label>
            <label class="field-label">边框粗细<AInputNumber size="small" aria-label="边框粗细" :value="activeShape.lineWidth" :min="1" :max="40" :precision="0" addon-after="px" @change="value => patchShape('lineWidth', Number(value))" /></label>
            <label class="field-label">边框颜色<div class="custom-color"><input type="color" aria-label="边框颜色" :value="activeColor" @input="patchColor(($event.target as HTMLInputElement).value)" /><span>{{ activeColor.toUpperCase() }}</span></div></label>
            <div class="color-palette"><button v-for="color in colors" :key="color" :style="{ background: color }" :class="{ chosen: activeColor === color }" :aria-label="`颜色 ${color}`" @click="patchColor(color)"><Check v-if="activeColor === color" :size="13" :color="color === '#ffffff' || color === '#f4d44d' ? '#38313c' : '#fff'" /></button></div>
            <p class="property-tip">拖动边框移动，拖动控制点调整大小。按住 Shift 绘制正方形或正圆。</p>
          </template>
          <template v-else>
            <div class="mosaic-symbol"><Scan :size="21" /><strong>像素马赛克</strong></div>
            <label class="field-label strength-label">打码强度<strong>{{ activeStrength }} px</strong></label><ASlider aria-label-for-handle="打码强度" :value="activeStrength" :min="4" :max="64" :step="2" @change="patchStrength" /><div class="range-labels"><span>细腻</span><span>强烈</span></div>
            <p class="property-tip">选中区域可调整强度、移动或删除。</p>
          </template>
          <AButton v-if="selected" size="small" danger block class="delete-layer" aria-label="删除此标注" @click="deleteSelected"><template #icon><Trash2 :size="14" /></template>删除{{ selected.type === 'mosaic' ? '打码区域' : '标注' }}</AButton>
        </div>
        <div class="layers-heading"><h2><Layers3 :size="15" />标注图层</h2><span>{{ layers.length }}</span></div>
        <div class="layers-list">
          <div v-if="!layers.length" class="layers-empty">暂无标注</div>
          <button v-for="layer in layerList" :key="layer.id" class="layer-item" :class="{ selected: selectedId === layer.id }" :aria-label="`选择图层 ${layerTitle(layer)}`" @click="selectLayer(layer)"><span class="layer-type"><Type v-if="layer.type === 'text'" :size="15" /><Scan v-else-if="layer.type === 'mosaic'" :size="15" /><ArrowUpRight v-else-if="layer.type === 'arrow'" :size="15" /><Square v-else-if="layer.type === 'rectangle'" :size="15" /><Circle v-else-if="layer.type === 'ellipse'" :size="15" /><span v-else>{{ sequenceLabel(layer.number, layer.style) }}</span></span><span class="layer-title">{{ layerTitle(layer) }}</span><span v-if="selectedId === layer.id" class="selected-indicator"></span></button>
        </div>
        <div class="inspector-footer"><kbd>Delete</kbd> 删除 <span>·</span> <kbd>Ctrl Z</kbd> 撤销</div>
      </aside>
      <OcrSidebar v-if="ocrOpen" ref="ocrSidebar" :busy="ocrBusy" :error="ocrError" :paragraphs="ocrParagraphs" :selected-id="selectedParagraphId" :languages="ocrCapabilities?.languages || []" :language="ocrLanguage" :available="isDesktop && ocrCapabilities?.available !== false" :has-result="ocrHasResult" :translation="translationState" @close="setOcrOpen(false)" @recognize="recognizeText" @update:language="ocrLanguage = $event" @select="selectParagraph" @update:text="editParagraph" @translation:open="translation.setOpen" @translation:direction="translation.changeDirection" @translate="translation.translate" @translation:cancel="translation.cancel()" @translation:retry="translation.setOpen(true)" />
    </main>
    <footer class="statusbar"><div class="image-status"><span :class="['status-dot', { unsaved: !saved }]"></span><span v-if="pdfPageCount">第 {{ pdfPage }} 页</span><span>{{ saved ? '已保存到本地' : '未保存' }}</span><span v-if="pinned" class="pin-status">已置顶</span><span v-if="editing" class="status-hint">{{ toolHint }}</span></div><div class="zoom-controls" title="Ctrl + 鼠标滚轮缩放图片"><button class="icon-button" aria-label="缩小图片" @click="zoom(scale / 1.2)"><Minus :size="13" /></button><button class="zoom-value" aria-label="原始大小" title="原始大小 100%" @click="zoom(1)">{{ Math.round(scale * 100) }}%<ChevronDown :size="10" /></button><button class="icon-button" aria-label="放大图片" @click="zoom(scale * 1.2)"><Plus :size="13" /></button><i></i><button class="fit-button" :class="{ active: fitMode }" aria-label="适应窗口" title="适应窗口" @click="fit"><Maximize :size="13" /><span>适应</span></button></div></footer>
    <ImageContextMenu :open="contextMenu.open" :x="contextMenu.x" :y="contextMenu.y" :editing="editing" :has-selection="!!selected" :can-undo="canUndo" :can-redo="canRedo" @close="closeImageContextMenu" @command="contextCommand" />
    <SaveExportDialog v-model:open="exportOpen" :width="screenshot?.width || 0" :height="screenshot?.height || 0" :busy="saving" :pdf="!!pdfPageCount" :page-count="pdfPageCount" :current-page="pdfPage" :progress="pdfProgress" :canceling="pdfCanceling" :defaults="preferences" @confirm="confirmSave" @cancel-export="cancelPdfExport" />
    <WatermarkPanel v-model:open="watermarkOpen" :model-value="watermark" :fonts="fonts" @update:model-value="setWatermark" />
  </div>
</template>

<style scoped>
.preview-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: #34323b;
  background: #f4f4f6;
}
.titlebar {
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 5px 0 12px;
  background: #fafafa;
  border-bottom: 1px solid #e6e5e9;
}
.brand { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 550; }
.brand > svg { color: #7860d2; }
.window-name { color: #797780; font-weight: 400; margin-left: 5px; }
.window-controls { display: flex; gap: 2px; }
.window-controls .icon-button { width: 30px; height: 28px; border-radius: 4px; }
.preview-topbar {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 9px 0 13px;
  border-bottom: 1px solid #e4e3e8;
  background: #fff;
}
.file-identity { display: flex; align-items: center; gap: 7px; min-width: 0; color: #77727f; font-size: 11px; white-space: nowrap; }
.file-identity > svg { color: #918799; }
.annotation-count { margin-left: 7px; padding-left: 11px; border-left: 1px solid #e2dfe7; color: #8f8599; }
.primary-actions { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
.primary-actions > :deep(.ant-btn) { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 27px; padding: 0 8px; font-size: 11px; border-radius: 4px; box-shadow: none; }
.primary-actions > :deep(.ant-btn .ant-btn-icon) { display: flex; margin: 0; }
.primary-actions > :deep(.ant-btn-primary) { margin-left: 3px; padding: 0 10px; }
.is-pinned, .edit-active { color: #7154bd !important; background: #eee9f8 !important; }
.editor-toolbar {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid #e2e0e6;
  background: #fafafa;
}
.tool-list, .history-actions { display: flex; align-items: center; gap: 4px; }
.tool-button { display: flex; align-items: center; gap: 5px; height: 29px; padding: 0 8px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #625a6c; font-size: 11px; }
.tool-button svg { width: 16px; height: 16px; }
.tool-button kbd { min-width: 13px; padding: 0 2px; background: transparent; border: 0; font-size: 9px; color: #96909e; }
.tool-button:hover { background: #efedf3; }
.tool-button.active { color: #7151b8; border-color: #ded4ef; background: #eee8f8; }
.history-actions { gap: 1px; }
.history-actions .icon-button { width: 28px; height: 28px; border-radius: 4px; }
.history-actions .icon-button:disabled { opacity: .3; }
.history-actions i, .zoom-controls i { width: 1px; height: 15px; margin: 0 6px; background: #dedbe3; }
.workspace { display: flex; flex: 1; min-width: 0; min-height: 0; }
.image-workspace { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: #eeedf0; }
.image-stage { width: 100%; height: 100%; overflow: auto; padding: 16px; overscroll-behavior: contain; }
.canvas-surface { display: flex; align-items: center; justify-content: center; }
.canvas-wrapper {
  flex-shrink: 0;
  position: relative;
  background-color: #fff;
  background-image: linear-gradient(45deg,#eeedf0 25%,transparent 25%),linear-gradient(-45deg,#eeedf0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eeedf0 75%),linear-gradient(-45deg,transparent 75%,#eeedf0 75%);
  background-size: 16px 16px;
  background-position: 0 0,0 8px,8px -8px,-8px 0;
  box-shadow: 0 0 0 1px #30204012, 0 2px 8px #30204012;
}
.canvas-wrapper canvas { display: block; touch-action: none; outline: none; }
.ocr-regions { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.ocr-region { position: absolute; border: 1px dashed #967acb; background: #967acb14; }
.ocr-region.active { border-color: #6e47b7; background: #9370ce30; box-shadow: 0 0 0 1px #8b65c754; }
.ocr-region > span { position: absolute; top: 0; left: 0; padding: 0 3px; border-radius: 0 0 3px 0; color: #fff; background: #9577bf; font-size: 9px; line-height: 14px; }
.ocr-region.active > span { background: #724fb0; }
.ocr-region.translated { background:#fff; }
.tool-list { min-width: 0; overflow-x: auto; }
.tool-button { flex-shrink: 0; }
.history-actions { flex-shrink: 0; }
.load-state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #7d738a; }
.load-state h2 { font-size: 13px; font-weight: 500; margin: 12px 0 7px; }
.load-state p { font-size: 11px; }
.inspector { width: 236px; flex-shrink: 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; border-left: 1px solid #ddd9e4; background: #fff; }
.inspector-heading { display: flex; align-items: center; justify-content: space-between; padding: 12px 13px 11px; }
.inspector h2 { margin: 0; font-size: 12px; font-weight: 600; }
.inspector-heading > span { font-size: 10px; color: #8e8699; }
.properties { flex-shrink: 0; padding: 0 13px 12px; }
.field-label { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; color: #767080; font-size: 11px; }
.field-label :deep(.ant-select), .field-label :deep(.ant-input-number) { width: 100%; font-size: 12px; }
.field-label :deep(.ant-select-selector) { font-size: 12px !important; border-radius: 4px !important; }
.field-label :deep(.ant-input-number) { border-radius: 4px; }
.font-heading { display: flex; align-items: center; justify-content: space-between; height: 18px; }
.font-heading small { color: #aaa1b2; font-size: 9px; margin-left: 4px; }
.font-refresh { width: 22px; height: 20px; color: #84758f; }
.font-error { color: #bd505f; font-size: 10px; line-height: 1.4; }
.spinning { animation: font-spin 1s linear infinite; }
@keyframes font-spin { to { transform: rotate(360deg); } }
.annotation-textarea { display: block; width: 100%; min-height: 54px; max-height: 120px; resize: vertical; border: 1px solid #d9d4df; border-radius: 4px; padding: 5px 7px; color: #40394b; background: #fff; font-size: 12px; line-height: 1.6; outline: none; }
.annotation-textarea:focus { border-color: #9e86d0; box-shadow: 0 0 0 2px #f0eafa; }
.annotation-textarea::placeholder { color: #a49aac; }
.style-row { display: flex; gap: 9px; }
.style-row > .field-label:first-child { width: 96px; }
.style-row :deep(.ant-input-number-group-addon) { padding: 0 6px; font-size: 10px; color: #8c8198; background: #f8f7fa; }
.color-label { flex: 1; min-width: 0; }
.custom-color { height: 24px; display: flex; align-items: center; gap: 5px; padding: 0 5px; border: 1px solid #d9d9d9; border-radius: 4px; overflow: hidden; }
.custom-color input { width: 18px; height: 20px; flex-shrink: 0; padding: 0; border: 0; background: transparent; cursor: pointer; }
.custom-color input::-webkit-color-swatch-wrapper { padding: 2px 0; }
.custom-color input::-webkit-color-swatch { border: 0; border-radius: 2px; }
.custom-color span { font: 9px Consolas, monospace; color: #766b82; }
.color-palette { display: flex; justify-content: space-between; gap: 4px; margin: 2px 0 12px; }
.color-palette button { display: flex; align-items: center; justify-content: center; width: 19px; height: 19px; padding: 0; border: 1px solid #30203f20; border-radius: 50%; }
.color-palette button.chosen { outline: 2px solid #b6a1d6; outline-offset: 2px; }
.property-tip { margin: 8px 0 0; font-size: 10px; line-height: 1.6; color: #8e839b; }
.delete-layer { display: flex; align-items: center; justify-content: center; gap: 5px; height: 26px; margin-top: 10px; border-radius: 4px; font-size: 11px; box-shadow: none; }
.delete-layer :deep(.ant-btn-icon) { display: flex; }
.layers-heading { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px 8px; border-top: 1px solid #e8e4ed; }
.layers-heading h2 { display: flex; align-items: center; gap: 6px; }
.layers-heading h2 > svg { color: #887b97; }
.layers-heading > span { font-size: 10px; color: #88799a; }
.layers-list { flex: 1; min-height: 70px; overflow: auto; padding: 0 7px 8px; }
.layers-empty { padding: 20px 0; text-align: center; color: #a49aac; font-size: 11px; }
.layer-item { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 6px; margin-bottom: 2px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #796c88; text-align: left; }
.layer-item:hover { background: #f4f1f8; }
.layer-item.selected { border-color: #e2d7f1; background: #f0eaf8; color: #6c4da4; }
.layer-type { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 22px; height: 22px; overflow: hidden; border-radius: 3px; background: #f0edf5; font-size: 10px; }
.layer-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.selected-indicator { width: 4px; height: 4px; border-radius: 50%; background: #9b79cc; }
.inspector-footer { display: flex; align-items: center; justify-content: center; gap: 6px; flex-shrink: 0; padding: 7px 10px; border-top: 1px solid #ebe7f0; color: #948a9f; font-size: 9px; }
.inspector-footer kbd { min-width: 0; padding: 1px 4px; border-width: 1px; border-radius: 3px; background: #f9f8fb; color: #8a7c99; font-size: 8px; }
.inspector-footer > span { margin: 0 3px; }
.mosaic-symbol { display: flex; align-items: center; gap: 8px; padding: 6px 0 16px; color: #8b74ab; }
.mosaic-symbol strong { font-size: 12px; font-weight: 500; color: #6d5e7c; }
.strength-label { flex-direction: row; justify-content: space-between; margin-bottom: 4px; }
.strength-label strong { color: #8266b1; font-size: 11px; font-weight: 500; }
.range-labels { display: flex; justify-content: space-between; margin: -3px 0 12px; color: #9f90ad; font-size: 10px; }
.statusbar { height: 26px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 9px; border-top: 1px solid #dedbe4; background: #fafafa; color: #857b92; font-size: 10px; }
.image-status { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; }
.status-dot { width: 4px; height: 4px; flex-shrink: 0; border-radius: 50%; background: #65a98b; }
.status-dot.unsaved { background: #b9a3cf; }
.pin-status { padding-left: 8px; color: #8465b4; }
.status-hint { overflow: hidden; text-overflow: ellipsis; margin-left: 10px; color: #978d9f; }
.zoom-controls { display: flex; align-items: center; gap: 1px; flex-shrink: 0; }
.zoom-controls .icon-button { width: 23px; height: 22px; border-radius: 3px; color: #8d7b9e; }
.zoom-value { display: flex; align-items: center; justify-content: center; gap: 4px; min-width: 47px; padding: 2px; border: 0; background: transparent; color: #7e6d8e; font-size: 10px; }
.zoom-controls i { height: 12px; margin: 0 5px; }
.fit-button { display: flex; align-items: center; gap: 4px; padding: 3px 5px; border: 0; border-radius: 3px; background: transparent; color: #8b7b9d; font-size: 10px; }
.fit-button.active { background: #eee8f6; color: #8160ae; }
@media (max-width: 900px) {
  .tool-button kbd { display: none; }
  .annotation-count { display: none; }
  .status-hint { display: none; }
}
@media (max-width: 600px) {
  .action-label { display: none; }
  .primary-actions > :deep(.ant-btn), .primary-actions > :deep(.ant-btn-primary) { width: 29px; padding: 0; margin-left: 0; }
  .primary-actions > :deep(.ant-btn > .ant-btn-icon) { margin: 0; }
  .preview-topbar { padding: 0 7px 0 10px; }
  .editor-toolbar { padding: 0 6px; gap: 3px; }
  .tool-button { padding: 0 5px; gap: 4px; }
  .history-actions .icon-button { width: 24px; }
  .history-actions i { margin: 0 2px; }
  .inspector { width: 220px; }
  .properties { padding: 0 10px 10px; }
  .style-row { gap: 6px; }
  .style-row > .field-label:first-child { width: 90px; }
  .custom-color span { font-size: 8px; }
  .pin-status { display: none; }
}
@media (max-width: 450px) {
  .file-identity { font-size: 10px; gap: 4px; }
  .file-identity > svg { display: none; }
  .tool-button span { display: none; }
  .tool-button { width: 32px; justify-content: center; }
}
</style>
