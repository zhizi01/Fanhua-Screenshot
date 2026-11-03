<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Aperture, Check, Crosshair, LoaderCircle, Maximize2, MousePointer2, X } from 'lucide-vue-next'
import type { CaptureContext, Rect, Screenshot, WindowRegion } from '../shared'
import { getDemoCaptureContext } from '../demo'
import { clampPoint, dragRect, isDrag, pixelRect, pixelSize, windowAtPoint } from '../capture/geometry'
import type { Point } from '../capture/geometry'

const context = ref<CaptureContext | null>(null)
const stage = ref<HTMLElement>()
const pointer = ref<Point | null>(null)
const start = ref<Point | null>(null)
const dragged = ref(false)
const busy = ref(false)
const error = ref('')
const activePointerId = ref<number | null>(null)
const hoveredWindow = ref<WindowRegion | null>(null)
const selected = ref<Rect | null>(null)
const isDemo = !window.fanhua
let unmounted = false

const fullRect = computed<Rect | null>(() => context.value
  ? { x: 0, y: 0, width: context.value.width, height: context.value.height }
  : null)
const currentRect = computed(() => selected.value || hoveredWindow.value || (pointer.value ? fullRect.value : null))
const selectionStyle = computed(() => currentRect.value ? rectStyle(currentRect.value) : {})
const size = computed(() => {
  const c = context.value
  return c && currentRect.value ? pixelSize(currentRect.value, c.width, c.height, c.pixelWidth, c.pixelHeight) : null
})
const label = computed(() => dragged.value ? '自由框选' : hoveredWindow.value?.title || '整个屏幕')
const labelStyle = computed(() => {
  if (!currentRect.value || !context.value) return {}
  const rect = currentRect.value
  return {
    left: `${Math.max(1, Math.min(80, rect.x / context.value.width * 100))}%`,
    top: `${Math.max(8, rect.y / context.value.height * window.innerHeight - 38)}px`,
  }
})
const shades = computed<Rect[]>(() => {
  if (!context.value) return []
  const { width, height } = context.value
  const r = currentRect.value
  if (!r) return [{ x: 0, y: 0, width, height }]
  return [
    { x: 0, y: 0, width, height: r.y },
    { x: 0, y: r.y, width: r.x, height: r.height },
    { x: r.x + r.width, y: r.y, width: width - r.x - r.width, height: r.height },
    { x: 0, y: r.y + r.height, width, height: height - r.y - r.height },
  ]
})

function rectStyle(rect: Rect) {
  const c = context.value!
  return { left: `${rect.x / c.width * 100}%`, top: `${rect.y / c.height * 100}%`, width: `${rect.width / c.width * 100}%`, height: `${rect.height / c.height * 100}%` }
}

function eventPoint(event: PointerEvent): Point {
  const bounds = stage.value!.getBoundingClientRect()
  const c = context.value!
  return clampPoint({ x: (event.clientX - bounds.left) / bounds.width * c.width, y: (event.clientY - bounds.top) / bounds.height * c.height }, c.width, c.height)
}

function updateHover(point: Point) {
  const c = context.value!
  hoveredWindow.value = windowAtPoint(c.windows, point, c.width, c.height) || null
}

function onPointerMove(event: PointerEvent) {
  if (!context.value || busy.value) return
  const point = eventPoint(event)
  pointer.value = point
  if (start.value) {
    if (event.pointerId !== activePointerId.value || !(event.buttons & 1)) return
    if (isDrag(start.value, point)) dragged.value = true
    if (dragged.value) selected.value = dragRect(start.value, point, context.value.width, context.value.height)
  } else {
    selected.value = null
    updateHover(point)
  }
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !context.value || busy.value) return
  error.value = ''
  pointer.value = eventPoint(event)
  start.value = pointer.value
  dragged.value = false
  selected.value = null
  updateHover(pointer.value)
  activePointerId.value = event.pointerId
  stage.value?.setPointerCapture(event.pointerId)
}

async function onPointerUp(event: PointerEvent) {
  if (event.button !== 0 || event.pointerId !== activePointerId.value || !start.value || !context.value || busy.value) return
  const point = eventPoint(event)
  const wasDrag = dragged.value || isDrag(start.value, point)
  const rect = wasDrag
    ? dragRect(start.value, point, context.value.width, context.value.height)
    : hoveredWindow.value || fullRect.value!
  clearPointer()
  if (rect.width < 1 || rect.height < 1) {
    selected.value = null
    dragged.value = false
    return
  }
  selected.value = rect
  await capture(rect)
}

function clearPointer() {
  const id = activePointerId.value
  activePointerId.value = null
  start.value = null
  if (id !== null && stage.value?.hasPointerCapture(id)) stage.value.releasePointerCapture(id)
}

function onPointerCancel() {
  clearPointer()
  selected.value = null
  dragged.value = false
}

async function capture(rect: Rect) {
  if (busy.value || !context.value) return
  busy.value = true
  error.value = ''
  try {
    if (window.fanhua) {
      // A hovered window comes from a Vue reactive proxy. Electron's context
      // bridge can only clone plain data, so explicitly copy the numeric fields.
      await window.fanhua.completeCapture({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    } else {
      const c = context.value
      const img = new Image()
      img.src = c.dataUrl
      await img.decode()
      const pixels = pixelRect(rect, c.width, c.height, img.naturalWidth, img.naturalHeight)
      if (pixels.width < 1 || pixels.height < 1) throw new Error('请选择至少 1 × 1 的截图区域')
      const canvas = document.createElement('canvas')
      canvas.width = pixels.width
      canvas.height = pixels.height
      canvas.getContext('2d')!.drawImage(img, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, canvas.width, canvas.height)
      const screenshot: Screenshot = { id: crypto.randomUUID(), dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, createdAt: new Date().toISOString() }
      sessionStorage.setItem('fanhua:demo-screenshot', JSON.stringify(screenshot))
      location.search = '?view=preview'
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '截图未完成，请重试'
    busy.value = false
  }
}

async function cancel() {
  if (busy.value) return
  clearPointer()
  try {
    if (window.fanhua) await window.fanhua.cancelCapture()
    else location.search = ''
  } catch {
    error.value = '暂时无法关闭截图，请按 Esc 重试'
  }
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void cancel()
  } else if (event.key === 'Enter' && context.value) {
    event.preventDefault()
    clearPointer()
    void capture(currentRect.value || fullRect.value!)
  }
}

onMounted(async () => {
  document.addEventListener('keydown', keydown)
  try {
    const result = window.fanhua ? await window.fanhua.getCaptureContext() : await getDemoCaptureContext()
    if (unmounted) return
    const image = new Image()
    image.src = result.dataUrl
    await image.decode()
    if (unmounted) return
    context.value = result
    await nextTick()
    if (window.fanhua) await window.fanhua.captureReady()
    stage.value?.focus()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取屏幕，请取消后重试'
  }
})
onBeforeUnmount(() => {
  unmounted = true
  document.removeEventListener('keydown', keydown)
  clearPointer()
})
</script>

<template>
  <main ref="stage" class="capture-stage" tabindex="-1" aria-label="截图框选区域" data-testid="capture-stage"
    @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerCancel" @contextmenu.prevent="cancel">
    <img v-if="context" class="screen-image" :src="context.dataUrl" alt="当前屏幕的冻结画面" draggable="false" />
    <div v-for="(shade, index) in shades" :key="index" class="shade" :style="rectStyle(shade)" />
    <div v-if="currentRect" class="selection" :style="selectionStyle" data-testid="capture-selection">
      <span v-for="handle in ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br']" :key="handle" class="handle" :class="handle" />
    </div>
    <div v-if="size && !busy" class="selection-label" :style="labelStyle" aria-live="polite">
      <Crosshair :size="13" />
      <span class="window-title">{{ label }}</span>
      <span class="label-divider" />
      <span class="dimensions">{{ size.width }} × {{ size.height }}</span>
    </div>

    <div v-if="!context && !error" class="center-notice"><LoaderCircle :size="23" class="spin" />正在准备屏幕…</div>
    <div v-if="busy" class="center-notice"><LoaderCircle :size="23" class="spin" />正在生成截图…</div>

    <div v-if="error" class="capture-error" role="alert" @pointerdown.stop @pointermove.stop @pointerup.stop>
      {{ error }}
      <button type="button" @click="cancel">取消截图</button>
    </div>

    <footer class="capture-toolbar" @pointerdown.stop @pointermove.stop @pointerup.stop>
      <div class="capture-brand"><Aperture :size="19" /><span>繁花有图</span><span v-if="isDemo" class="demo-badge">演示</span></div>
      <span class="toolbar-divider" />
      <div class="capture-hint"><MousePointer2 :size="15" /><span>{{ context?.windowDetectionAvailable ? '单击截取窗口 · 拖动自由框选' : '拖动自由框选 · 单击截取全屏' }}</span></div>
      <span class="toolbar-divider" />
      <button type="button" class="toolbar-action" aria-label="截取整个屏幕" title="截取整个屏幕" :disabled="!context || busy" @click="fullRect && capture(fullRect)"><Maximize2 :size="16" /></button>
      <button type="button" class="toolbar-action confirm" aria-label="确认当前截图" title="确认当前截图（Enter）" :disabled="!context || busy" @click="(currentRect || fullRect) && capture((currentRect || fullRect)!)"><Check :size="17" /></button>
      <button type="button" class="toolbar-action" aria-label="取消截图" title="取消截图（Esc / 右键）" :disabled="busy" @click="cancel"><X :size="17" /></button>
      <kbd>Esc</kbd>
    </footer>
    <div v-if="context && !context.windowDetectionAvailable" class="detection-note" role="status">窗口识别暂不可用，仍可拖动框选截图</div>
  </main>
</template>

<style scoped>
.capture-stage{position:relative;width:100%;height:100%;overflow:hidden;outline:0;cursor:crosshair;touch-action:none;user-select:none;background:#25232b;color:#fff;font-family:'Segoe UI','Microsoft YaHei UI',sans-serif}
.screen-image{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;object-fit:fill}
.shade{position:absolute;background:rgba(14,12,24,.48);pointer-events:none}
.selection{position:absolute;border:2px solid #b59bff;box-shadow:inset 0 0 0 1px rgba(23,16,45,.22);pointer-events:none}
.handle{position:absolute;width:6px;height:6px;border:1px solid #8c6cdd;background:#fff;border-radius:1px}
.tl{top:-4px;left:-4px}.tc{top:-4px;left:calc(50% - 3px)}.tr{top:-4px;right:-4px}.ml{top:calc(50% - 3px);left:-4px}.mr{top:calc(50% - 3px);right:-4px}.bl{bottom:-4px;left:-4px}.bc{bottom:-4px;left:calc(50% - 3px)}.br{bottom:-4px;right:-4px}
.selection-label{position:absolute;display:flex;align-items:center;gap:9px;padding:7px 11px;max-width:min(480px,90vw);border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(31,27,42,.94);box-shadow:0 3px 12px rgba(0,0,0,.1);font-size:11px;white-space:nowrap;pointer-events:none}
.window-title{overflow:hidden;text-overflow:ellipsis;max-width:260px}.dimensions{font-variant-numeric:tabular-nums;color:#e8dcff}.label-divider{width:1px;height:12px;background:rgba(255,255,255,.22)}
.capture-toolbar{position:absolute;bottom:26px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:calc(100% - 32px);padding:11px 13px 11px 17px;background:rgba(30,27,39,.96);border:1px solid rgba(255,255,255,.15);border-radius:13px;box-shadow:0 12px 36px rgba(0,0,0,.2);cursor:default;white-space:nowrap}
.capture-brand{display:flex;align-items:center;gap:8px;color:#f0eafa;font-size:12px;font-weight:600}.capture-brand>svg{color:#c2aaff}.capture-hint{display:flex;align-items:center;gap:7px;color:#d3cbdc;font-size:11px}.toolbar-divider{width:1px;height:19px;background:rgba(255,255,255,.15);margin:0 3px}.toolbar-action{display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;background:transparent;border:0;border-radius:6px;color:#e2d9ec;cursor:pointer}.toolbar-action:hover{background:#4d435f;color:#fff}.toolbar-action:disabled{opacity:.4;cursor:not-allowed}.toolbar-action.confirm{color:#c4a8ff}.toolbar-action.confirm:hover{background:#645083}.capture-toolbar kbd{min-width:24px;background:#3b3546;color:#c5bcd0;border-color:#574f63;font-size:10px;padding:2px 5px}.demo-badge{padding:2px 5px;border-radius:4px;border:1px solid #61546f;color:#cdb5ef;font-size:9px;font-weight:400}
.center-notice{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:12px;padding:20px 24px;border-radius:12px;background:#211c2fea;font-size:14px;box-shadow:0 8px 40px #0003;pointer-events:none}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.capture-error{position:absolute;left:50%;bottom:100px;transform:translateX(-50%);max-width:calc(100% - 40px);padding:12px 16px;border:1px solid #a65e62;border-radius:9px;background:#39282cf5;color:#ffe4e8;font-size:12px;cursor:default}.capture-error button{margin-left:16px;border:0;border-radius:4px;background:#613d48;color:#fff;padding:4px 8px;cursor:pointer}.detection-note{position:absolute;bottom:6px;left:50%;transform:translateX(-50%);font-size:10px;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none}
@media(max-width:650px){.capture-hint{font-size:10px}.capture-brand>span:not(.demo-badge){display:none}.capture-toolbar{gap:5px;padding:9px}.toolbar-divider{margin:0}.capture-toolbar kbd{display:none}}
</style>
