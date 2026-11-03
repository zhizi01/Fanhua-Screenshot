<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ text: string; sourceLineHeight: number; scale: number }>()
const surface = ref<HTMLElement>()
const measure = ref<HTMLElement>()
const fontSize = ref(12)
const lineCount = ref(1)
const overflowing = ref(false)
let observer: ResizeObserver | undefined
let frame = 0
let disposed = false

function fitText() {
  const container = surface.value, probe = measure.value
  if (!container || !probe) return
  // Keep the minimum readable on screen. A small/very dense source region can
  // show an ellipsis; the complete translation remains in the linked sidebar.
  const width = Math.max(1, container.clientWidth - 8)
  const height = Math.max(1, container.clientHeight - 4)
  const minimum = 11
  const preferred = Math.min(48, Math.max(minimum, props.sourceLineHeight * props.scale * .78))
  probe.style.width = `${width}px`
  const fits = (size: number) => {
    probe.style.fontSize = `${size}px`
    return probe.scrollHeight <= height + .5 && probe.scrollWidth <= width + .5
  }
  let low = minimum, high = preferred
  if (!fits(minimum)) high = minimum
  else {
    for (let step = 0; step < 7; step++) {
      const middle = (low + high) / 2
      if (fits(middle)) low = middle
      else high = middle
    }
  }
  fontSize.value = Math.floor(low * 10) / 10
  overflowing.value = !fits(fontSize.value)
  lineCount.value = Math.max(1, Math.floor(height / (fontSize.value * 1.18)))
}
function scheduleFit() {
  if (disposed) return
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(fitText)
}
watch(() => [props.text, props.scale, props.sourceLineHeight], () => { void nextTick(scheduleFit) }, { flush: 'post' })
onMounted(() => {
  observer = new ResizeObserver(scheduleFit)
  if (surface.value) observer.observe(surface.value)
  scheduleFit()
  void document.fonts.ready.then(scheduleFit)
})
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); cancelAnimationFrame(frame) })
</script>

<template>
  <div ref="surface" class="translation-overlay" data-testid="translation-overlay" :data-overflow="overflowing" :title="text">
    <div class="overlay-copy" data-testid="translation-overlay-text" :style="{ fontSize: `${fontSize}px`, WebkitLineClamp: lineCount }">{{ text }}</div>
    <div ref="measure" class="overlay-measure" aria-hidden="true">{{ text }}</div>
  </div>
</template>

<style scoped>
.translation-overlay{position:absolute;inset:0;box-sizing:border-box;display:flex;align-items:center;padding:2px 4px;overflow:hidden;pointer-events:none;background:rgba(255,255,255,.97);color:#42364f;font-family:'Microsoft YaHei UI','Segoe UI',sans-serif;font-weight:500}
.overlay-copy,.overlay-measure{line-height:1.18;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;text-align:left;letter-spacing:normal}
.overlay-copy{display:-webkit-box;-webkit-box-orient:vertical;width:100%;max-height:100%;overflow:hidden}
.overlay-measure{position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;min-height:0;height:auto;font-size:12px}
</style>
