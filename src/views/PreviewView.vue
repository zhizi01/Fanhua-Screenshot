<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button as AButton, InputNumber as AInputNumber, AutoComplete as AAutoComplete, Slider as ASlider, Select as ASelect, message } from 'ant-design-vue'
import { ArrowLeft, Check, ChevronDown, Copy, Download, Flower2, Grip, Image as ImageIcon, Layers3, Maximize, Minus, MousePointer2, Pencil, Pin, PinOff, Plus, Redo2, Scan, Trash2, Type, Undo2, X } from 'lucide-vue-next'
import type { Screenshot } from '../shared'
import { getDemoScreenshot } from '../demo'
import { EditHistory, hitTest, imagePoint, moveLayer, normalizeRect, sequenceLabel, visualLayers, type Layer, type MosaicLayer, type NumberStyle, type Point, type TextStyle, type Tool } from '../editor/model'
import { renderScene, renderSelection, textMeasure } from '../editor/render'

const screenshot = ref<Screenshot>()
const isDesktop = !!window.fanhua
const sourceImage = ref<HTMLImageElement>()
const loading = ref(true)
const error = ref('')
const editing = ref(false)
const pinned = ref(false)
const saving = ref(false)
const saved = ref(false)
const tool = ref<Tool>('select')
const layers = ref<Layer[]>([])
const selectedId = ref<string>()
const selected = computed(() => layers.value.find(layer => layer.id === selectedId.value))
const layerList = computed(() => visualLayers(layers.value).reverse())
const stage = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const textInput = ref<HTMLTextAreaElement>()
const scale = ref(1)
const fitMode = ref(true)
const history = new EditHistory()
const historyTick = ref(0)
const canUndo = computed(() => { void historyTick.value; return history.canUndo })
const canRedo = computed(() => { void historyTick.value; return history.canRedo })
const defaults = ref<TextStyle>({ font: 'Microsoft YaHei UI', size: 28, color: '#ef5c68' })
const numberStyle = ref<NumberStyle>('number')
const mosaicStrength = ref(18)
const fonts = ref(['Microsoft YaHei UI', 'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'Arial', 'Segoe UI', 'Consolas'])
const colors = ['#ef5c68', '#f3a24a', '#f4d44d', '#44b797', '#438fe8', '#8063d5', '#26232f', '#ffffff']
const properties = computed(() => selected.value && selected.value.type !== 'mosaic' ? selected.value : defaults.value)
const inspectorType = computed(() => selected.value?.type || (tool.value === 'select' ? 'text' : tool.value))
const fontOptions = computed(() => fonts.value.map(value => ({ value })))
const filterFonts = (input: string, option?: { value?: unknown }) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())
const activeStrength = computed(() => selected.value?.type === 'mosaic' ? selected.value.strength : mosaicStrength.value)
const activeNumberStyle = computed(() => selected.value?.type === 'marker' ? selected.value.style : numberStyle.value)
const tools = [
  { id: 'select' as const, icon: MousePointer2, label: '选择', key: 'V' },
  { id: 'text' as const, icon: Type, label: '文字', key: 'T' },
  { id: 'marker' as const, icon: Grip, label: '序号', key: 'N' },
  { id: 'mosaic' as const, icon: Scan, label: '马赛克', key: 'M' },
]
const toolHint = computed(() => ({ select: '点击选择标注，拖动调整位置', text: '点击画面添加文字，在右侧编辑内容', marker: '点击画面添加序号，可为步骤写下说明', mosaic: '拖动框选需要打码的区域' })[tool.value])
let resizeObserver: ResizeObserver | undefined
let frame = 0
let drag: { origin: Point; layer?: Layer; moved: boolean } | undefined
const draft = ref<MosaicLayer>()

function commit() { history.commit(layers.value); historyTick.value++; saved.value = false }
function queuePaint() { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint) }
function paint() {
  if (!canvas.value || !sourceImage.value || !screenshot.value) return
  const ctx = canvas.value.getContext('2d')!
  renderScene(ctx, sourceImage.value, screenshot.value.width, screenshot.value.height, layers.value)
  if (draft.value) {
    ctx.save(); ctx.fillStyle = '#8063d52b'; ctx.strokeStyle = '#8063d5'; ctx.lineWidth = 1.5 / scale.value
    ctx.fillRect(draft.value.x, draft.value.y, draft.value.width, draft.value.height)
    ctx.strokeRect(draft.value.x, draft.value.y, draft.value.width, draft.value.height); ctx.restore()
  }
  if (editing.value && selected.value) renderSelection(ctx, selected.value, scale.value)
}
function fit() {
  fitMode.value = true
  if (!stage.value || !screenshot.value) return
  scale.value = Math.max(.02, Math.min(1, (stage.value.clientWidth - 72) / screenshot.value.width, (stage.value.clientHeight - 72) / screenshot.value.height))
  queuePaint()
}
function zoom(value: number) { fitMode.value = false; scale.value = Math.max(.05, Math.min(4, value)); queuePaint() }
function setTool(value: Tool) { tool.value = value; selectedId.value = undefined }
async function toggleEditing() {
  editing.value = !editing.value
  selectedId.value = undefined
  tool.value = 'select'
  await nextTick()
  if (fitMode.value) fit()
  queuePaint()
}
function patchStyle(key: keyof TextStyle, value: string | number) {
  if (key === 'size') value = Math.max(8, Math.min(200, Number(value) || 28))
  const patch = { [key]: value }
  defaults.value = { ...defaults.value, ...patch }
  if (selected.value && selected.value.type !== 'mosaic') { Object.assign(selected.value, patch); commit() }
}
function patchText(value: string) { if (selected.value && selected.value.type !== 'mosaic') { selected.value.text = value.slice(0, 4000); commit() } }
function patchNumberStyle(value: NumberStyle) {
  numberStyle.value = value
  if (selected.value?.type === 'marker') { selected.value.style = value; commit() }
}
function patchNumber(value: number | null) {
  if (selected.value?.type === 'marker') { selected.value.number = Math.max(1, Math.min(9999, value || 1)); commit() }
}
function patchStrength(value: number | [number, number]) {
  const strength = Array.isArray(value) ? value[0] : value
  mosaicStrength.value = strength
  if (selected.value?.type === 'mosaic') { selected.value.strength = strength; commit() }
}
function deleteSelected() {
  if (!selected.value) return
  layers.value = layers.value.filter(layer => layer.id !== selectedId.value)
  selectedId.value = undefined
  commit()
}
function undo() { layers.value = history.undo(); historyTick.value++; selectedId.value = undefined; saved.value = false }
function redo() { layers.value = history.redo(); historyTick.value++; selectedId.value = undefined; saved.value = false }
function pointerPosition(event: PointerEvent) {
  return imagePoint(event.clientX, event.clientY, canvas.value!.getBoundingClientRect(), screenshot.value!.width, screenshot.value!.height)
}
function pointerDown(event: PointerEvent) {
  if (!editing.value || !canvas.value || !screenshot.value || event.button !== 0) return
  event.preventDefault()
  canvas.value.focus()
  canvas.value.setPointerCapture(event.pointerId)
  const point = pointerPosition(event)
  const measure = textMeasure(canvas.value.getContext('2d')!)
  if (tool.value === 'select') {
    const found = hitTest(layers.value, point, 5 / scale.value, measure)
    selectedId.value = found?.id
    drag = { origin: point, layer: found ? { ...found } : undefined, moved: false }
  } else if (tool.value === 'mosaic') {
    selectedId.value = undefined
    drag = { origin: point, moved: false }
    draft.value = { id: crypto.randomUUID(), type: 'mosaic', x: point.x, y: point.y, width: 0, height: 0, strength: mosaicStrength.value }
  } else {
    const common = { id: crypto.randomUUID(), x: point.x, y: point.y, ...defaults.value }
    const layer: Layer = tool.value === 'text'
      ? { ...common, type: 'text', text: '在这里写下批注' }
      : { ...common, type: 'marker', number: Math.max(0, ...layers.value.filter(l => l.type === 'marker').map(l => l.number)) + 1, style: numberStyle.value, text: '' }
    layers.value.push(moveLayer(layer, 0, 0, screenshot.value.width, screenshot.value.height, measure))
    selectedId.value = layer.id
    commit()
    if (tool.value === 'text') { tool.value = 'select'; nextTick(() => { textInput.value?.focus(); textInput.value?.select() }) }
  }
}
function pointerMove(event: PointerEvent) {
  if (!drag || !screenshot.value || !canvas.value) return
  const point = pointerPosition(event)
  const dx = point.x - drag.origin.x
  const dy = point.y - drag.origin.y
  if (Math.hypot(dx, dy) > 2 / scale.value) drag.moved = true
  if (draft.value) Object.assign(draft.value, normalizeRect(drag.origin, point, screenshot.value.width, screenshot.value.height))
  else if (drag.layer && drag.moved) {
    const index = layers.value.findIndex(l => l.id === drag!.layer!.id)
    layers.value[index] = moveLayer(drag.layer, dx, dy, screenshot.value.width, screenshot.value.height, textMeasure(canvas.value.getContext('2d')!))
  }
}
function pointerUp(event: PointerEvent) {
  if (draft.value && draft.value.width >= 3 && draft.value.height >= 3) {
    layers.value.push({ ...draft.value }); selectedId.value = draft.value.id; commit()
  } else if (drag?.layer && drag.moved) commit()
  draft.value = undefined
  drag = undefined
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId)
}
function pointerCancel(event: PointerEvent) {
  if (drag?.layer) {
    const index = layers.value.findIndex(l => l.id === drag!.layer!.id)
    if (index >= 0) layers.value[index] = drag.layer
  }
  draft.value = undefined; drag = undefined
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId)
}
function doubleClick() { if (editing.value && selected.value && selected.value.type !== 'mosaic') { textInput.value?.focus(); textInput.value?.select() } }
function exportImage(): string {
  if (!sourceImage.value || !screenshot.value) throw new Error('图片尚未加载完成')
  const output = document.createElement('canvas')
  output.width = screenshot.value.width; output.height = screenshot.value.height
  renderScene(output.getContext('2d')!, sourceImage.value, output.width, output.height, layers.value)
  return output.toDataURL('image/png')
}
async function save() {
  if (saving.value || loading.value || error.value) return
  saving.value = true
  try {
    const dataUrl = exportImage()
    if (window.fanhua) { const result = await window.fanhua.saveImage(dataUrl); if (result.canceled) return }
    else {
      const a = document.createElement('a'); a.href = dataUrl; a.download = `繁花有图-${new Date().toISOString().replace(/[:.]/g, '-')}.png`; a.click()
    }
    saved.value = true; message.success('图片已保存，标注仍可继续编辑')
  } catch (cause) { message.error(cause instanceof Error ? cause.message : '保存失败，请重试') }
  finally { saving.value = false }
}
async function copy() {
  if (loading.value || error.value) return
  try {
    const dataUrl = exportImage()
    if (window.fanhua) await window.fanhua.copyImage(dataUrl)
    else { const blob = await (await fetch(dataUrl)).blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]) }
    message.success('已复制图片，可粘贴到聊天或文档')
  } catch { message.error('复制失败，请使用保存图片') }
}
async function togglePin() {
  if (!window.fanhua) { message.info('桌面版支持将图片固定在其他窗口上方'); return }
  try { pinned.value = await window.fanhua.setPinned(!pinned.value) } catch { message.error('固定窗口失败') }
}
async function close() { if (window.fanhua) await window.fanhua.closeWindow(); else location.search = '' }
async function minimize() { await window.fanhua?.minimizeWindow() }
function keyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.closest('input,textarea,select,[contenteditable="true"],.ant-select')) return
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); void copy() }
    if (editing.value && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
    if (editing.value && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    return
  }
  if (event.key === 'Escape') { if (selectedId.value) selectedId.value = undefined; else if (editing.value) void toggleEditing(); return }
  if (!editing.value) return
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected() }
  const shortcutTools: Record<string, Tool> = { v: 'select', t: 'text', n: 'marker', m: 'mosaic' }
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
function layerTitle(layer: Layer) { return layer.type === 'mosaic' ? '马赛克区域' : layer.type === 'marker' ? `${sequenceLabel(layer.number, layer.style)} · ${layer.text || '步骤标识'}` : layer.text || '空白文字' }
function selectLayer(layer: Layer) { selectedId.value = layer.id; tool.value = 'select' }
watch([layers, selectedId, editing, draft, scale], queuePaint, { deep: true })
onMounted(async () => {
  window.addEventListener('keydown', keyDown)
  try {
    screenshot.value = await (window.fanhua ? window.fanhua.getPreview() : getDemoScreenshot())
    const img = new window.Image()
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('无法读取图片，请重新截图')); img.src = screenshot.value!.dataUrl })
    sourceImage.value = img
    screenshot.value.width = img.naturalWidth; screenshot.value.height = img.naturalHeight
    loading.value = false
    await nextTick()
    resizeObserver = new ResizeObserver(() => { if (fitMode.value) fit() })
    if (stage.value) resizeObserver.observe(stage.value)
    fit(); queuePaint()
    if (window.fanhua) window.fanhua.getFonts().then(values => { fonts.value = [...new Set([...fonts.value, ...values])].sort() }).catch(() => {})
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '图片加载失败'; loading.value = false }
})
onBeforeUnmount(() => { window.removeEventListener('keydown', keyDown); resizeObserver?.disconnect(); cancelAnimationFrame(frame) })
</script>

<template>
  <div class="preview-app">
    <header class="titlebar drag-region">
      <div class="brand"><Flower2 :size="19" /><span>繁花有图</span><i></i><span class="window-name">{{ editing ? '图片编辑' : '图片预览' }}</span></div>
      <div class="window-controls no-drag"><button class="icon-button" aria-label="最小化窗口" @click="minimize"><Minus :size="16" /></button><button class="icon-button danger" aria-label="关闭窗口不保存" title="关闭窗口，不自动保存" @click="close"><X :size="17" /></button></div>
    </header>
    <div class="preview-topbar">
      <div class="file-identity"><span class="file-icon"><ImageIcon :size="20" /></span><div><h1>{{ editing ? '为灵感，添一笔' : '留住这一刻' }}</h1><p>{{ screenshot ? `${screenshot.width} × ${screenshot.height} px` : '正在读取图片' }} <span>·</span> {{ layers.length ? `${layers.length} 个标注` : '原始截图' }}<span v-if="!isDesktop"> · 演示图片</span></p></div></div>
      <div class="primary-actions">
        <AButton :class="{ 'is-pinned': pinned }" :title="pinned ? '取消始终置顶' : '始终置于其他窗口上方'" aria-label="固定窗口" @click="togglePin"><template #icon><PinOff v-if="pinned" :size="16" /><Pin v-else :size="16" /></template><span class="action-label">{{ pinned ? '已固定' : '固定' }}</span></AButton>
        <AButton :disabled="loading || !!error" aria-label="复制图片" title="复制图片 Ctrl+C" @click="copy"><template #icon><Copy :size="16" /></template><span class="action-label">复制</span></AButton>
        <AButton :disabled="loading || !!error" aria-label="进入编辑模式" :class="{ 'edit-active': editing }" @click="toggleEditing"><template #icon><Check v-if="editing" :size="16" /><Pencil v-else :size="16" /></template>{{ editing ? '完成编辑' : '编辑图片' }}</AButton>
        <AButton type="primary" :loading="saving" :disabled="loading || !!error" aria-label="保存图片" title="保存 PNG 图片 Ctrl+S" @click="save"><template #icon><Download :size="16" /></template>保存<span class="action-label">图片</span></AButton>
      </div>
    </div>
    <div v-if="editing" class="editor-toolbar">
      <div class="tool-list"><button v-for="item in tools" :key="item.id" class="tool-button" :class="{ active: tool === item.id }" :aria-label="item.label + '工具'" :aria-pressed="tool === item.id" :title="`${item.label} (${item.key})`" @click="setTool(item.id)"><component :is="item.icon" :size="18" /><span>{{ item.label }}</span><kbd>{{ item.key }}</kbd></button></div>
      <div class="history-actions"><button class="icon-button" aria-label="撤销" title="撤销 Ctrl+Z" :disabled="!canUndo" @click="undo"><Undo2 :size="18" /></button><button class="icon-button" aria-label="重做" title="重做 Ctrl+Y" :disabled="!canRedo" @click="redo"><Redo2 :size="18" /></button><i></i><button class="icon-button danger" aria-label="删除选中标注" title="删除选中标注 Delete" :disabled="!selected" @click="deleteSelected"><Trash2 :size="17" /></button></div>
    </div>
    <main class="workspace" :class="{ editing }">
      <section class="image-workspace">
        <div v-if="editing" class="canvas-instruction"><MousePointer2 :size="13" />{{ toolHint }}</div>
        <div ref="stage" class="image-stage" data-testid="image-stage">
          <div v-if="loading || error" class="load-state"><ImageIcon :size="36" /><h2>{{ error || '正在准备图片…' }}</h2><p>{{ error ? '请关闭此窗口，重新截图或导入图片' : '稍等片刻，灵感马上呈现' }}</p></div>
          <div v-else-if="screenshot" class="canvas-wrapper" :style="{ width: `${screenshot.width * scale}px`, height: `${screenshot.height * scale}px` }">
            <canvas ref="canvas" :width="screenshot.width" :height="screenshot.height" :style="{ width: '100%', height: '100%', cursor: !editing ? 'default' : tool === 'select' ? 'default' : 'crosshair' }" tabindex="0" role="img" aria-label="截图编辑画布" data-testid="editor-canvas" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerCancel" @dblclick="doubleClick"></canvas>
          </div>
        </div>
        <div v-if="!editing && !loading && !error" class="preview-note"><span class="note-dot"></span>图片仅保留在此窗口，点击保存后才会写入文件<ArrowLeft :size="14" /></div>
      </section>
      <aside v-if="editing" class="inspector">
        <div class="inspector-heading"><h2>{{ selected ? '标注属性' : '工具样式' }}</h2><span>{{ selected ? '已选中' : '新建标注' }}</span></div>
        <div class="properties">
          <template v-if="inspectorType !== 'mosaic'">
            <label v-if="selected && selected.type !== 'mosaic'" class="field-label">{{ selected.type === 'marker' ? '步骤说明' : '文字内容' }}<textarea ref="textInput" aria-label="标注文字内容" class="annotation-textarea" :value="selected.text" :placeholder="selected.type === 'marker' ? '为这个步骤写一点说明…' : '输入批注文字…'" rows="3" maxlength="4000" @input="patchText(($event.target as HTMLTextAreaElement).value)"></textarea></label>
            <template v-if="inspectorType === 'marker'">
              <label class="field-label">序号方式<ASelect aria-label="序号方式" :value="activeNumberStyle" :options="[{ value: 'number', label: '1, 2, 3 · 阿拉伯数字' }, { value: 'letter', label: 'A, B, C · 字母' }, { value: 'chinese', label: '壹, 贰, 叁 · 中文大写' }]" @change="value => patchNumberStyle(value as NumberStyle)" /></label>
              <label v-if="selected?.type === 'marker'" class="field-label">序号数值<AInputNumber aria-label="序号数值" :value="selected.number" :min="1" :max="9999" :precision="0" @change="value => patchNumber(Number(value))" /></label>
            </template>
            <label class="field-label">字体<AAutoComplete aria-label="标注字体" :value="properties.font" :options="fontOptions" :filter-option="filterFonts" placeholder="选择或输入字体名称" @change="value => patchStyle('font', String(value))" /></label>
            <div class="style-row"><label class="field-label">字号<AInputNumber aria-label="标注字号" :value="properties.size" :min="8" :max="200" :precision="0" addon-after="px" @change="value => patchStyle('size', Number(value))" /></label><label class="field-label color-label">颜色<div class="custom-color"><input type="color" aria-label="自定义标注颜色" :value="properties.color" @input="patchStyle('color', ($event.target as HTMLInputElement).value)" /><span>{{ properties.color.toUpperCase() }}</span></div></label></div>
            <div class="color-palette"><button v-for="color in colors" :key="color" :style="{ background: color }" :class="{ chosen: properties.color === color }" :aria-label="`颜色 ${color}`" @click="patchStyle('color', color)"><Check v-if="properties.color === color" :size="13" :color="color === '#ffffff' || color === '#f4d44d' ? '#38313c' : '#fff'" /></button></div>
            <p class="property-tip">{{ selected ? '点击画面中的标注可再次修改，拖动可移动。' : '选择工具后点击画面，开始添加标注。' }}</p>
          </template>
          <template v-else>
            <div class="mosaic-symbol"><Scan :size="28" /><div><strong>像素马赛克</strong><p>框选区域，遮住私密内容</p></div></div>
            <label class="field-label strength-label">打码强度<strong>{{ activeStrength }} px</strong></label><ASlider aria-label-for-handle="打码强度" :value="activeStrength" :min="4" :max="64" :step="2" @change="patchStrength" /><div class="range-labels"><span>细腻</span><span>强烈</span></div>
            <p class="property-tip">每个打码区域独立保留。选中后可以调整强度、拖动位置，或删除恢复原图。</p>
          </template>
          <AButton v-if="selected" danger block class="delete-layer" aria-label="删除此标注" @click="deleteSelected"><template #icon><Trash2 :size="15" /></template>删除此{{ selected.type === 'mosaic' ? '打码区域' : '标注' }}</AButton>
        </div>
        <div class="layers-heading"><h2><Layers3 :size="15" />标注图层</h2><span>{{ layers.length }}</span></div>
        <div class="layers-list">
          <div v-if="!layers.length" class="layers-empty"><Layers3 :size="25" /><p>还没有标注</p><span>让你的想法清晰可见</span></div>
          <button v-for="layer in layerList" :key="layer.id" class="layer-item" :class="{ selected: selectedId === layer.id }" :aria-label="`选择图层 ${layerTitle(layer)}`" @click="selectLayer(layer)"><span class="layer-type"><Type v-if="layer.type === 'text'" :size="15" /><Scan v-else-if="layer.type === 'mosaic'" :size="15" /><span v-else>{{ sequenceLabel(layer.number, layer.style) }}</span></span><span class="layer-title">{{ layerTitle(layer) }}</span><span v-if="selectedId === layer.id" class="selected-indicator"></span></button>
        </div>
        <div class="inspector-footer"><kbd>Delete</kbd> 删除 <span>·</span> <kbd>Ctrl Z</kbd> 撤销</div>
      </aside>
    </main>
    <footer class="statusbar"><div class="image-status"><span :class="['status-dot', { unsaved: !saved }]"></span>{{ saved ? '已保存到本地' : layers.length ? '标注尚未保存' : '图片尚未保存' }}<span class="status-divider">|</span><span>{{ editing ? '所有标注均可再次编辑' : pinned ? '窗口已固定在最前方' : '随手记录，自在表达' }}</span></div><div class="zoom-controls"><button class="icon-button" aria-label="缩小图片" @click="zoom(scale / 1.2)"><Minus :size="14" /></button><button class="zoom-value" aria-label="原始大小" title="点击显示原始大小" @click="zoom(1)">{{ Math.round(scale * 100) }}%<ChevronDown :size="11" /></button><button class="icon-button" aria-label="放大图片" @click="zoom(scale * 1.2)"><Plus :size="14" /></button><i></i><button class="fit-button" :class="{ active: fitMode }" aria-label="适应窗口" @click="fit"><Maximize :size="14" />适应窗口</button></div></footer>
  </div>
</template>

<style scoped>
.preview-app{display:flex;flex-direction:column;height:100%;background:#f8f7fa}.titlebar{height:42px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 21px;background:#fff;border-bottom:1px solid #efedf3}.brand{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:600;letter-spacing:.3px}.brand>svg{color:#8063d5}.brand i{height:12px;width:1px;background:#e4e0eb;margin:0 4px}.window-name{font-weight:400;color:#8a8494}.window-controls{display:flex;gap:3px}.window-controls .icon-button{width:32px;height:28px}.preview-topbar{height:86px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 25px;background:#fff;border-bottom:1px solid #eae7f0;gap:12px}.file-identity{display:flex;align-items:center;gap:12px;white-space:nowrap}.file-icon{width:43px;height:43px;border-radius:12px;background:#f0ecfb;color:#856cd1;display:flex;align-items:center;justify-content:center}.file-identity h1{margin:0 0 5px;font-size:17px;font-weight:650;letter-spacing:.5px}.file-identity p{margin:0;font-size:11px;color:#928b9d}.file-identity p span{padding:0 5px;color:#bdb7c6}.primary-actions{display:flex;align-items:center;gap:8px}.primary-actions :deep(.ant-btn){display:inline-flex;align-items:center;justify-content:center;gap:7px;font-size:12px;padding:0 13px;box-shadow:none}.primary-actions :deep(.ant-btn .ant-btn-icon){display:flex;margin:0}.primary-actions :deep(.ant-btn-primary){padding:0 17px}.is-pinned,.edit-active{color:#7860d2!important;border-color:#d4c8ef!important;background:#f8f5ff!important}.editor-toolbar{height:58px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;background:#fff;padding:0 22px;border-bottom:1px solid #eae7f0;gap:10px}.tool-list,.history-actions{display:flex;align-items:center;gap:6px}.tool-button{display:flex;align-items:center;gap:7px;border:1px solid transparent;background:transparent;border-radius:8px;color:#766e84;height:36px;padding:0 11px;font-size:12px}.tool-button kbd{font-size:9px;padding:1px 4px;min-width:15px;background:transparent;border-color:transparent;color:#a29aa9}.tool-button:hover{background:#f6f3fa}.tool-button.active{background:#f0ebfb;border-color:#e8defa;color:#785dc7}.tool-button.active kbd{color:#9f8fc8}.history-actions{gap:2px}.history-actions .icon-button:disabled{opacity:.3}.history-actions i,.zoom-controls i{height:18px;width:1px;background:#e9e5ef;margin:0 9px}.workspace{display:flex;flex:1;min-height:0;min-width:0}.image-workspace{position:relative;display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:#f5f4f7}.canvas-instruction{position:absolute;z-index:1;top:13px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:7px;background:#fffef2e0;border:1px solid #e8e3d8;color:#958566;box-shadow:0 2px 5px #40342604;border-radius:6px;white-space:nowrap;padding:6px 10px;font-size:11px;pointer-events:none}.image-stage{height:100%;width:100%;padding:36px;overflow:auto;display:flex;align-items:safe center;justify-content:safe center;background-image:radial-gradient(#d9d4e3 .7px,transparent .7px);background-size:12px 12px}.canvas-wrapper{flex-shrink:0;position:relative;box-shadow:0 10px 40px #3e315315,0 1px 3px #3e31531a;background:#fff;background-image:linear-gradient(45deg,#f2f1f4 25%,transparent 25%),linear-gradient(-45deg,#f2f1f4 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f2f1f4 75%),linear-gradient(-45deg,transparent 75%,#f2f1f4 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}.canvas-wrapper canvas{display:block;touch-action:none;outline:none}.load-state{text-align:center;color:#8d839d}.load-state>svg{color:#b1a4c8}.load-state h2{font-weight:500;font-size:17px;margin-top:20px}.load-state p{font-size:12px}.preview-note{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;border:1px solid #ebe6f2;padding:9px 14px;border-radius:7px;background:#ffffffef;color:#9c91ab;font-size:11px;white-space:nowrap;pointer-events:none}.preview-note>svg{transform:rotate(90deg);margin-left:10px;color:#b5a8cb}.note-dot{width:5px;height:5px;border-radius:50%;background:#b19ad8}.inspector{width:256px;flex-shrink:0;border-left:1px solid #e9e5ef;background:#fff;display:flex;flex-direction:column;overflow-y:auto;min-height:0}.inspector-heading{display:flex;align-items:center;justify-content:space-between;padding:20px 18px 15px}.inspector h2{font-size:12px;margin:0;font-weight:650}.inspector-heading>span{font-size:10px;color:#a39aaa;background:#f5f3f8;border:1px solid #eeebf3;padding:2px 6px;border-radius:4px}.properties{padding:0 18px 18px;flex-shrink:0}.field-label{display:flex;flex-direction:column;gap:8px;font-size:11px;color:#918898;margin-bottom:15px}.field-label :deep(.ant-select),.field-label :deep(.ant-input-number){width:100%;font-size:12px}.field-label :deep(.ant-select-selector){font-size:12px!important}.annotation-textarea{display:block;width:100%;resize:vertical;min-height:68px;max-height:150px;border:1px solid #e3dce9;border-radius:7px;padding:8px 9px;font-size:12px;line-height:1.7;color:#4b4258;background:#fefeff;outline:none}.annotation-textarea:focus{border-color:#ac93e2;box-shadow:0 0 0 2px #f2ecfc}.annotation-textarea::placeholder{color:#b1a7bb}.style-row{display:flex;gap:10px}.style-row>.field-label:first-child{width:103px}.style-row :deep(.ant-input-number-group-addon){font-size:10px;padding:0 8px;color:#b0a6bd;background:#faf8fc}.color-label{flex:1}.custom-color{height:36px;border:1px solid #d9d9d9;border-radius:9px;display:flex;align-items:center;gap:6px;padding:0 7px;overflow:hidden}.custom-color input{padding:0;border:0;background:transparent;width:20px;height:24px;flex-shrink:0;cursor:pointer}.custom-color input::-webkit-color-swatch-wrapper{padding:3px 0}.custom-color input::-webkit-color-swatch{border:0;border-radius:4px}.custom-color span{font-size:9px;color:#8f859c;font-family:Consolas,monospace}.color-palette{display:flex;justify-content:space-between;gap:4px;margin:1px 0 17px}.color-palette button{width:20px;height:20px;border-radius:50%;border:1px solid #2a203216;display:flex;align-items:center;justify-content:center;padding:0}.color-palette button.chosen{outline:2px solid #c7b9e5;outline-offset:2px}.property-tip{font-size:10px;line-height:1.8;color:#aaa0b4;margin:10px 0 0}.delete-layer{margin-top:15px;font-size:11px;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:none}.delete-layer :deep(.ant-btn-icon){display:flex}.layers-heading{border-top:1px solid #f0edf4;padding:17px 18px 12px;display:flex;align-items:center;justify-content:space-between}.layers-heading h2{display:flex;align-items:center;gap:7px}.layers-heading h2>svg{color:#9b8cae}.layers-heading>span{font-size:10px;color:#9e92ae;background:#f2eef8;min-width:18px;text-align:center;border-radius:4px;padding:1px 4px}.layers-list{padding:0 11px 12px;min-height:100px;flex:1;overflow:auto}.layers-empty{text-align:center;padding:18px 0 10px;color:#c3b8cf}.layers-empty p{font-size:11px;color:#a597b5;margin:10px 0 3px}.layers-empty span{font-size:10px;color:#bfb4ca}.layer-item{display:flex;align-items:center;gap:9px;text-align:left;border:1px solid transparent;border-radius:7px;padding:8px;width:100%;background:transparent;color:#8e819f;margin-bottom:4px}.layer-item:hover{background:#f8f5fc}.layer-item.selected{background:#f3eefc;border-color:#e9def9;color:#7b5bb8}.layer-type{width:25px;height:25px;border-radius:5px;background:#f4f1f8;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;overflow:hidden}.selected .layer-type{background:#e9defa;color:#8d6ec7}.layer-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;flex:1}.selected-indicator{width:5px;height:5px;border-radius:50%;background:#9b7bd2}.inspector-footer{padding:11px 16px;border-top:1px solid #f0ecf5;color:#aaa0b5;font-size:9px;display:flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0}.inspector-footer kbd{font-size:8px;min-width:0;padding:2px 4px;border-width:1px;color:#a297ae;background:#faf8fc}.inspector-footer>span{margin:0 4px}.mosaic-symbol{display:flex;align-items:center;gap:12px;padding:9px 0 18px;color:#9882b9}.mosaic-symbol strong{font-size:12px;font-weight:500;color:#71627f}.mosaic-symbol p{font-size:10px;color:#afa0be;margin:4px 0 0}.strength-label{flex-direction:row;justify-content:space-between;margin-bottom:6px}.strength-label strong{font-size:11px;color:#8a6ebb;font-weight:500}.range-labels{display:flex;justify-content:space-between;color:#b6a9c4;font-size:9px;margin-top:-3px;margin-bottom:18px}.statusbar{height:39px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #eae5ef;background:#fff;padding:0 18px;color:#aaa0b4;font-size:10px;gap:12px}.image-status{display:flex;align-items:center;gap:7px;white-space:nowrap}.status-dot{width:5px;height:5px;border-radius:50%;background:#68b497}.status-dot.unsaved{background:#c6b3d9}.status-divider{margin:0 5px;color:#e4deeb}.zoom-controls{display:flex;align-items:center;gap:1px}.zoom-controls .icon-button{width:25px;height:25px;color:#9c8eaf}.zoom-value{border:0;background:transparent;font-size:10px;display:flex;align-items:center;gap:6px;color:#8d7c9d;min-width:53px;justify-content:center}.zoom-controls i{height:13px;margin:0 8px}.fit-button{display:flex;align-items:center;gap:6px;border:0;border-radius:4px;background:transparent;font-size:10px;color:#a496b5;padding:4px 6px}.fit-button.active{color:#9274bc;background:#f5f0fb}@media(max-width:900px){.preview-topbar{padding:0 17px}.primary-actions{gap:5px}.primary-actions :deep(.ant-btn){padding:0 9px}.action-label{display:none}.inspector{width:230px}.properties{padding:0 13px 15px}.editor-toolbar{padding:0 15px}.tool-button{padding:0 8px}.tool-button kbd{display:none}.image-status>span:last-child{display:none}}@media(max-width:650px){.file-icon{display:none}.file-identity h1{font-size:14px}.file-identity p{font-size:9px}.inspector{width:205px}.properties{padding:0 10px 14px}.statusbar{padding:0 9px}.tool-button{gap:4px;padding:0 6px}.tool-button>span{font-size:10px}.style-row{gap:5px}.style-row>.field-label:first-child{width:87px}.custom-color span{display:none}.history-actions .icon-button{width:27px}.preview-note{font-size:9px;padding:8px;max-width:90%;white-space:normal}.image-stage{padding:24px}}
</style>
