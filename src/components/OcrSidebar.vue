<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button as AButton, Select as ASelect, message } from 'ant-design-vue'
import { Copy, Languages, LoaderCircle, RefreshCw, ScanText, X } from 'lucide-vue-next'
import type { OcrParagraph } from '../shared'

const props = withDefaults(defineProps<{
  busy: boolean
  error: string
  paragraphs: OcrParagraph[]
  selectedId?: string
  languages: { tag: string; name: string }[]
  language: string
  available: boolean
  hasResult?: boolean
}>(), { hasResult: false })
const emit = defineEmits<{
  close: []
  recognize: []
  'update:language': [value: string]
  select: [id: string]
  'update:text': [id: string, text: string]
}>()
const list = ref<HTMLElement>()
const items = new Map<string, HTMLElement>()
const copying = ref<string>()
const languageOptions = computed(() => [
  { value: 'auto', label: '自动识别（中英文）' },
  ...props.languages.filter(item => item.tag !== 'auto').map(item => ({ value: item.tag, label: item.name })),
])
const allText = computed(() => props.paragraphs.map(item => item.text).join('\n\n'))
let scrollRequest = 0
let resizeObserver: ResizeObserver | undefined

function rememberItem(id: string, element: unknown) {
  if (element instanceof HTMLElement) items.set(id, element)
  else items.delete(id)
}
async function revealSelection() {
  const current = ++scrollRequest
  await nextTick()
  if (current !== scrollRequest || !props.selectedId) return
  const container = list.value
  const selected = items.get(props.selectedId)
  if (!container || !selected) return
  const viewport = container.getBoundingClientRect()
  const item = selected.getBoundingClientRect()
  // Only scroll this sidebar. Element.scrollIntoView would also move the
  // image workspace and window, breaking the pointer's location on the image.
  if (item.top < viewport.top + 7 || item.height > viewport.height - 14) container.scrollTop += item.top - viewport.top - 7
  else if (item.bottom > viewport.bottom - 7) container.scrollTop += item.bottom - viewport.bottom + 7
}
watch(() => props.selectedId, revealSelection, { flush: 'post', immediate: true })
watch(() => props.paragraphs.map(item => item.id).join('|'), revealSelection, { flush: 'post' })
watch(() => props.paragraphs.find(item => item.id === props.selectedId)?.text, revealSelection, { flush: 'post' })
onMounted(() => {
  resizeObserver = new ResizeObserver(revealSelection)
  if (list.value) resizeObserver.observe(list.value)
})
onBeforeUnmount(() => { scrollRequest++; resizeObserver?.disconnect(); items.clear() })
defineExpose({ revealSelection })

async function copy(text: string, id = 'all') {
  if (!text.trim() || copying.value) return
  copying.value = id
  try {
    if (window.fanhua) await window.fanhua.copyText(text)
    else await navigator.clipboard.writeText(text)
    message.success(id === 'all' ? '已复制全部文字' : '已复制本段文字')
  } catch { message.error('复制失败，请选中文字后按 Ctrl+C。') }
  finally { copying.value = undefined }
}
function updateText(id: string, event: Event) {
  emit('update:text', id, (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <aside class="ocr-sidebar" aria-label="文字识别面板" data-testid="ocr-sidebar" @keydown.stop>
    <header class="ocr-heading">
      <h2><ScanText :size="15" />识别文字 <span v-if="paragraphs.length">{{ paragraphs.length }} 段</span></h2>
      <button type="button" class="icon-button" aria-label="关闭文字识别" title="关闭文字识别与位置标记" @click="emit('close')"><X :size="15" /></button>
    </header>
    <div class="ocr-controls">
      <ASelect size="small" aria-label="识别语言" :value="language" :options="languageOptions" :disabled="busy || !available" @change="value => emit('update:language', String(value))" />
      <AButton size="small" :disabled="busy || !available" aria-label="重新识别" title="重新识别打开时的原图，不含本次标注、水印和打码" @click="emit('recognize')"><RefreshCw :size="13" />识别</AButton>
    </div>
    <p class="ocr-source-note">仅识别原图，不含本次标注、水印和打码。</p>
    <div v-if="busy" class="ocr-status" role="status"><LoaderCircle :size="14" class="spin" /><span>正在本机识别…</span></div>
    <div v-if="error" class="ocr-error" role="alert">{{ error }}</div>
    <p v-else-if="paragraphs.length && !busy" class="ocr-instruction">点击图片虚线框或段落可相互定位。</p>

    <div ref="list" class="paragraph-list" role="list" aria-label="识别段落" data-testid="ocr-paragraph-list" :aria-busy="busy">
      <article v-for="(paragraph, index) in paragraphs" :key="paragraph.id" :ref="element => rememberItem(paragraph.id, element)"
        class="paragraph" :class="{ selected: paragraph.id === selectedId }" role="listitem"
        :data-paragraph-id="paragraph.id" :aria-current="paragraph.id === selectedId ? 'true' : undefined">
        <div class="paragraph-heading">
          <button type="button" class="paragraph-location" :aria-label="`定位第 ${index + 1} 段文字`" :aria-pressed="paragraph.id === selectedId" @click="emit('select', paragraph.id)">
            <span class="paragraph-number">{{ index + 1 }}</span><span>段落 {{ index + 1 }}</span>
          </button>
          <button type="button" class="icon-button copy-paragraph" :aria-label="`复制第 ${index + 1} 段文字`" title="复制本段" :disabled="!!copying || !paragraph.text.trim()" @click="copy(paragraph.text, paragraph.id)"><Copy :size="13" /></button>
        </div>
        <textarea v-if="paragraph.id === selectedId" class="paragraph-editor" :aria-label="`编辑第 ${index + 1} 段文字`" :value="paragraph.text"
          :rows="Math.max(2, Math.min(8, paragraph.text.split('\n').length + Math.floor(paragraph.text.length / 24)))" :maxlength="100000" spellcheck="false" @input="updateText(paragraph.id, $event)" />
        <button v-else type="button" class="paragraph-text" :aria-label="`选择第 ${index + 1} 段：${paragraph.text.slice(0, 60)}`" @click="emit('select', paragraph.id)">{{ paragraph.text || '此段文字已清空' }}</button>
        <p v-if="paragraph.id === selectedId" class="edit-note">可修正文字，原图保持不变。</p>
      </article>
      <div v-if="!paragraphs.length && !busy && !error" class="ocr-empty">
        <ScanText :size="28" />
        <p>{{ hasResult ? '没有识别到文字' : '识别结果将显示在这里' }}</p>
        <span>{{ hasResult ? '可切换语言后重新识别。' : '文字会按段落排列，并标出对应位置。' }}</span>
      </div>
    </div>
    <footer class="ocr-footer">
      <div class="ocr-footer-actions">
        <AButton size="small" disabled title="翻译功能预留，暂未开放" aria-label="翻译"><Languages :size="13" />翻译</AButton>
        <AButton size="small" type="primary" aria-label="复制全部文字" :disabled="busy || !allText.trim() || !!copying" @click="copy(allText)"><Copy :size="13" />复制全部</AButton>
      </div>
      <p>本机离线处理 · 识别框不会保存到图片</p>
    </footer>
  </aside>
</template>

<style scoped>
.ocr-sidebar{width:292px;min-width:0;max-width:calc(100% - 80px);flex-shrink:0;display:flex;flex-direction:column;min-height:0;border-left:1px solid #ddd9e4;background:#fff;color:#47404f;font-size:12px;overflow:hidden}
.ocr-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px 7px 13px;flex-shrink:0}.ocr-heading h2{display:flex;align-items:center;gap:6px;margin:0;font-size:12px;font-weight:600}.ocr-heading h2>svg{color:#82708f}.ocr-heading h2>span{font-size:10px;color:#9b90a4;font-weight:400;margin-left:2px}.ocr-heading .icon-button{width:25px;height:25px;border-radius:4px}
.ocr-controls{display:flex;gap:6px;padding:0 11px 9px;flex-shrink:0}.ocr-controls>.ant-select{flex:1;min-width:0}.ocr-controls :deep(.ant-select-selector){font-size:11px!important;border-radius:4px!important}.ocr-sidebar :deep(.ant-btn){display:inline-flex;align-items:center;justify-content:center;gap:5px;border-radius:4px;font-size:11px;box-shadow:none}.ocr-controls :deep(.ant-btn){padding:0 7px}
.ocr-status,.ocr-error,.ocr-instruction,.ocr-source-note{margin:0 11px 9px;flex-shrink:0;font-size:11px;line-height:1.6}.ocr-status{display:flex;align-items:center;gap:6px;color:#82728f}.ocr-error{padding:7px 9px;border-radius:4px;background:#fff2f3;color:#ae4555;white-space:pre-wrap;overflow-wrap:anywhere;max-height:100px;overflow:auto}.ocr-source-note{font-size:10px;color:#8b7a9d}.ocr-instruction{font-size:10px;color:#a092aa}
.paragraph-list{position:relative;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 8px 8px;scrollbar-gutter:stable}.paragraph{border:1px solid #e6e1eb;border-radius:5px;margin-bottom:7px;background:#fdfcfe;overflow:hidden}.paragraph.selected{border-color:#b8a1dc;background:#faf7ff;box-shadow:0 0 0 1px #e9dff7}.paragraph-heading{display:flex;align-items:center;justify-content:space-between;padding:5px 6px 2px;gap:6px}.paragraph-location{display:flex;align-items:center;gap:6px;min-width:0;border:0;background:transparent;color:#8b7e99;padding:0;font-size:10px;line-height:22px;text-align:left}.paragraph-number{display:flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 3px;border-radius:3px;background:#eee9f4;color:#816b99;font-size:10px;font-variant-numeric:tabular-nums}.selected .paragraph-number{background:#e9def7;color:#7656aa}.copy-paragraph{width:22px;height:22px;border-radius:3px;flex-shrink:0}.copy-paragraph:disabled{opacity:.4}.paragraph-text{display:block;width:100%;padding:3px 10px 10px;border:0;background:transparent;text-align:left;font-size:12px;line-height:1.7;color:#61566c;white-space:pre-wrap;overflow-wrap:anywhere}.paragraph-text:hover{color:#7654ad;background:#f6f1fc}.paragraph-editor{display:block;width:calc(100% - 16px);margin:3px 8px 0;padding:5px 6px;resize:vertical;min-height:50px;max-height:250px;border:1px solid #ddd2ec;border-radius:3px;outline:0;background:#fff;color:#4f435b;font-size:12px;line-height:1.7;user-select:text}.paragraph-editor:focus{border-color:#a48bc7;box-shadow:0 0 0 2px #eee7f7}.edit-note{font-size:9px;line-height:1.4;color:#a18fae;margin:5px 9px 7px}.ocr-empty{display:flex;min-height:150px;height:100%;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:#b6a8c3;padding:15px 8px}.ocr-empty p{font-size:12px;color:#8f7fa0;margin:12px 0 5px}.ocr-empty span{font-size:10px;color:#aa9db6;line-height:1.6}
.ocr-footer{flex-shrink:0;padding:8px 10px 7px;border-top:1px solid #ebe7f0;background:#fdfcfe}.ocr-footer-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.ocr-footer p{margin:7px 0 0;text-align:center;font-size:9px;color:#a497ae;line-height:1.4}.spin{animation:ocr-spin 1s linear infinite}@keyframes ocr-spin{to{transform:rotate(360deg)}}
@media(max-width:760px){.ocr-sidebar{width:260px}.ocr-heading{padding-left:10px}.ocr-instruction{font-size:9px}}
@media(max-height:440px){.ocr-heading{padding-top:3px;padding-bottom:3px}.ocr-controls{padding-bottom:5px}.ocr-status,.ocr-error,.ocr-source-note{margin-bottom:5px}.ocr-error{max-height:36px;flex-shrink:1;padding:4px 6px;min-height:24px}.ocr-instruction{display:none}.ocr-footer{padding-top:5px;padding-bottom:5px}.ocr-footer p{display:none}}
</style>
