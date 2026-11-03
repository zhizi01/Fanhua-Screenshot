<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Aperture, Check, Crosshair, LoaderCircle, Maximize2, MousePointer2, X } from 'lucide-vue-next'
import type { CaptureContext, Rect, WindowRegion } from '../shared'
import { clampPoint, dragRect, isDrag, pixelSize, windowAtPoint } from '../capture/geometry'
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
const isDesktop = Boolean(window.fanhua)
let unmounted = false
let contextRevision = 0
let unsubscribe: (() => void) | undefined

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
  if (!r) return []
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
  const revision = contextRevision
  busy.value = true
  error.value = ''
  try {
    if (!window.fanhua) throw new Error('截图功能仅在 Windows 桌面版中可用，请启动繁花有图桌面应用。')
    // A hovered window comes from a Vue reactive proxy. Electron's context
    // bridge can only clone plain data, so explicitly copy the numeric fields.
    await window.fanhua.completeCapture({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, context.value.sessionId)
  } catch (cause) {
    if (revision !== contextRevision || unmounted) return
    error.value = cause instanceof Error ? cause.message : '截图未完成，请重试'
    busy.value = false
  }
}

async function cancel() {
  if (busy.value) return
  const revision = contextRevision
  clearPointer()
  try {
    if (window.fanhua) await window.fanhua.cancelCapture(context.value?.sessionId)
  } catch {
    if (revision !== contextRevision || unmounted) return
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

async function receiveContext(result: CaptureContext | null) {
  if (result?.sessionId && result.sessionId === context.value?.sessionId) return
  const revision = ++contextRevision
  clearPointer()
  busy.value = false
  error.value = ''
  selected.value = null
  hoveredWindow.value = null
  pointer.value = null
  dragged.value = false
  context.value = null
  if (!result || unmounted) return
  try {
    const image = new Image()
    image.src = result.dataUrl
    await image.decode()
    if (unmounted || revision !== contextRevision) return
    context.value = result
    if (result.cursor && result.cursor.x >= 0 && result.cursor.y >= 0 && result.cursor.x < result.width && result.cursor.y < result.height) {
      pointer.value = result.cursor
      updateHover(result.cursor)
    }
    await nextTick()
    if (unmounted || revision !== contextRevision) return
    if (window.fanhua) await window.fanhua.captureReady(result.sessionId)
    stage.value?.focus()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取屏幕，请取消后重试'
  }
}
onMounted(async () => {
  if (!window.fanhua) {
    error.value = '截图功能仅在 Windows 桌面版中可用，请启动繁花有图桌面应用。'
    return
  }
  document.addEventListener('keydown', keydown)
  unsubscribe = window.fanhua.onCaptureContext(receiveContext)
  try { await receiveContext(await window.fanhua.getCaptureContext()) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取屏幕' }
})
onBeforeUnmount(() => {
  unmounted = true
  contextRevision++
  unsubscribe?.()
  document.removeEventListener('keydown', keydown)
  clearPointer()
})
</script>

<template>
  <main ref="stage" class="capture-stage" tabindex="-1" aria-label="截图框选区域"
    @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerCancel" @contextmenu.prevent="cancel">
    <img v-if="context" class="screen-image" :src="context.dataUrl" alt="当前屏幕的冻结画面" draggable="false" />
    <div v-for="(shade, index) in shades" :key="index" class="shade" :style="rectStyle(shade)" />
    <div v-if="currentRect" class="selection" :style="selectionStyle">
      <span v-for="handle in ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br']" :key="handle" class="handle" :class="handle" />
    </div>
    <div v-if="size && !busy" class="selection-label" :style="labelStyle" aria-live="polite">
      <Crosshair :size="13" />
      <span class="window-title">{{ label }}</span>
      <span class="label-divider" />
      <span class="dimensions">{{ size.width }} × {{ size.height }}</span>
    </div>

    <div v-if="busy" class="capture-progress"><LoaderCircle :size="14" class="spin" />正在截取</div>

    <div v-if="error" class="capture-error" role="alert" @pointerdown.stop @pointermove.stop @pointerup.stop>
      {{ error }}
      <button v-if="isDesktop" type="button" @click="cancel">取消截图</button>
    </div>

    <footer v-if="context && !start" class="capture-toolbar" @pointerdown.stop @pointermove.stop @pointerup.stop>
      <div class="capture-brand"><Aperture :size="19" /><span>繁花有图</span></div>
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
.capture-stage{position:relative;width:100%;height:100%;overflow:hidden;outline:0;cursor:crosshair;touch-action:none;user-select:none;background:transparent;color:#fff;font-family:'Segoe UI','Microsoft YaHei UI',sans-serif}
.screen-image{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;object-fit:fill}
.shade{position:absolute;background:rgba(14,12,24,.15);pointer-events:none}
.selection{position:absolute;border:2px solid #b59bff;box-shadow:inset 0 0 0 1px rgba(23,16,45,.22);pointer-events:none}
.handle{position:absolute;width:6px;height:6px;border:1px solid #8c6cdd;background:#fff;border-radius:1px}
.tl{top:-4px;left:-4px}.tc{top:-4px;left:calc(50% - 3px)}.tr{top:-4px;right:-4px}.ml{top:calc(50% - 3px);left:-4px}.mr{top:calc(50% - 3px);right:-4px}.bl{bottom:-4px;left:-4px}.bc{bottom:-4px;left:calc(50% - 3px)}.br{bottom:-4px;right:-4px}
.selection-label{position:absolute;display:flex;align-items:center;gap:9px;padding:7px 11px;max-width:min(480px,90vw);border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(31,27,42,.94);box-shadow:0 3px 12px rgba(0,0,0,.1);font-size:11px;white-space:nowrap;pointer-events:none}
.window-title{overflow:hidden;text-overflow:ellipsis;max-width:260px}.dimensions{font-variant-numeric:tabular-nums;color:#e8dcff}.label-divider{width:1px;height:12px;background:rgba(255,255,255,.22)}
.capture-toolbar{position:absolute;bottom:26px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:calc(100% - 32px);padding:11px 13px 11px 17px;background:rgba(30,27,39,.96);border:1px solid rgba(255,255,255,.15);border-radius:13px;box-shadow:0 12px 36px rgba(0,0,0,.2);cursor:default;white-space:nowrap}
.capture-brand{display:flex;align-items:center;gap:8px;color:#f0eafa;font-size:12px;font-weight:600}.capture-brand>svg{color:#c2aaff}.capture-hint{display:flex;align-items:center;gap:7px;color:#d3cbdc;font-size:11px}.toolbar-divider{width:1px;height:19px;background:rgba(255,255,255,.15);margin:0 3px}.toolbar-action{display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;background:transparent;border:0;border-radius:6px;color:#e2d9ec;cursor:pointer}.toolbar-action:hover{background:#4d435f;color:#fff}.toolbar-action:disabled{opacity:.4;cursor:not-allowed}.toolbar-action.confirm{color:#c4a8ff}.toolbar-action.confirm:hover{background:#645083}.capture-toolbar kbd{min-width:24px;background:#3b3546;color:#c5bcd0;border-color:#574f63;font-size:10px;padding:2px 5px}
.capture-progress{position:absolute;bottom:12px;right:16px;display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:6px;background:#211c2fea;font-size:11px;pointer-events:none}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.capture-error{position:absolute;left:50%;bottom:100px;transform:translateX(-50%);max-width:calc(100% - 40px);padding:12px 16px;border:1px solid #a65e62;border-radius:9px;background:#39282cf5;color:#ffe4e8;font-size:12px;cursor:default}.capture-error button{margin-left:16px;border:0;border-radius:4px;background:#613d48;color:#fff;padding:4px 8px;cursor:pointer}.detection-note{position:absolute;bottom:6px;left:50%;transform:translateX(-50%);font-size:10px;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none}
@media(max-width:650px){.capture-hint{font-size:10px}.capture-brand>span{display:none}.capture-toolbar{gap:5px;padding:9px}.toolbar-divider{margin:0}.capture-toolbar kbd{display:none}}
</style>
