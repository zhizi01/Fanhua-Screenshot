<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button as AButton, Modal as AModal, Select as ASelect, Textarea as ATextarea, message } from 'ant-design-vue'
import { Copy, Languages, LoaderCircle, ScanText } from 'lucide-vue-next'
import type { OcrCapabilities, OcrResult } from '../shared'
import { translationAvailable } from '../services/translation'

const props = defineProps<{ open: boolean; imageDataUrl: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const text = ref('')
const busy = ref(false)
const error = ref('')
const language = ref('auto')
const capabilities = ref<OcrCapabilities>()
const result = ref<OcrResult>()
const copying = ref(false)
let revision = 0
const languageOptions = computed(() => [{ value: 'auto', label: '自动识别（中英文）' }, ...(capabilities.value?.languages || []).filter(item => item.tag !== 'auto').map(item => ({ value: item.tag, label: item.name }))])

async function recognize() {
  const current = ++revision
  error.value = ''
  text.value = ''
  result.value = undefined
  if (!window.fanhua) { error.value = '文字识别需在桌面版运行。'; return }
  if (!props.imageDataUrl) { error.value = '图片尚未准备完成，请关闭后重试。'; return }
  busy.value = true
  try {
    const available = await window.fanhua.getOcrCapabilities()
    if (current !== revision || !props.open) return
    capabilities.value = available
    if (!available.available) throw new Error(available.reason || '当前系统无法使用文字识别。')
    const recognized = await window.fanhua.recognizeText(props.imageDataUrl, language.value)
    if (current !== revision || !props.open) return
    result.value = recognized
    text.value = recognized.text
  } catch (cause) {
    if (current === revision) error.value = cause instanceof Error ? cause.message : '文字识别失败，请重试。'
  } finally { if (current === revision) busy.value = false }
}
async function copy() {
  copying.value = true
  try {
    if (window.fanhua) await window.fanhua.copyText(text.value)
    else await navigator.clipboard.writeText(text.value)
    message.success('已复制文字')
  } catch { message.error('复制失败，请选中文字后按 Ctrl+C。') }
  finally { copying.value = false }
}
watch(() => props.open, open => {
  if (open) void recognize()
  else { revision++; busy.value = false }
})
</script>

<template>
  <AModal :open="open" title="识别图片文字" :width="580" :style="{ top: '16px' }"
    :body-style="{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }" @cancel="emit('update:open', false)">
    <div class="ocr-panel">
      <div class="ocr-options">
        <ASelect v-model:value="language" aria-label="识别语言" :options="languageOptions" :disabled="busy" />
        <AButton :disabled="busy || !capabilities?.available" @click="recognize"><ScanText :size="14" />重新识别</AButton>
      </div>
      <div v-if="busy" class="ocr-status" role="status"><LoaderCircle :size="16" class="spin" />正在本机识别，较大的图片需要一些时间…</div>
      <div v-else-if="error" class="ocr-error" role="alert">{{ error }}</div>
      <div v-else-if="result" class="ocr-status" role="status">{{ text.trim() ? `识别完成 · ${result.lines.length} 行文字` : '没有识别到文字，可更换语言后重试' }}</div>
      <ATextarea v-model:value="text" aria-label="识别结果" placeholder="识别结果会显示在这里，可直接修改文字" :disabled="busy" :rows="11" :spellcheck="false" />
    </div>
    <template #footer><div class="ocr-footer">
        <span>本机离线处理 · 不上传图片</span>
        <div class="ocr-actions">
          <AButton :disabled="!translationAvailable" title="翻译功能预留，暂未开放"><Languages :size="14" />翻译</AButton>
          <AButton type="primary" :disabled="busy || !text.trim()" :loading="copying" @click="copy"><Copy :size="14" />复制文字</AButton>
        </div>
      </div></template>
  </AModal>
</template>

<style scoped>
.ocr-panel{display:flex;flex-direction:column;gap:12px;padding-top:12px}.ocr-options{display:flex;gap:8px}.ocr-options>.ant-select{flex:1;min-width:0}.ocr-panel :deep(.ant-btn){display:inline-flex;align-items:center;justify-content:center;gap:6px}.ocr-status{display:flex;align-items:center;gap:7px;font-size:12px;color:#767080;min-height:22px}.ocr-error{color:#b94455;background:#fff2f3;padding:9px 11px;border-radius:5px;font-size:12px;white-space:pre-wrap}.ocr-panel textarea{resize:vertical;min-height:160px;max-height:45vh;font-size:13px;line-height:1.8;user-select:text}.ocr-footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.ocr-footer>span{font-size:11px;color:#8d8595}.ocr-actions{display:flex;gap:8px}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:470px){.ocr-footer{align-items:flex-start;flex-direction:column}.ocr-actions{align-self:flex-end}}
</style>
