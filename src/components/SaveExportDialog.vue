<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Modal as AModal, Select as ASelect, Slider as ASlider } from 'ant-design-vue'
import type { AppSettings, ExportOptions } from '../shared'

const props = defineProps<{ open: boolean; width: number; height: number; busy: boolean; pdf?: boolean; pageCount?: number; currentPage?: number; progress?: { completed: number; total: number; finalizing: boolean }; canceling?: boolean; defaults?: AppSettings }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; confirm: [options: ExportOptions]; cancelExport: [] }>()
const format = ref<ExportOptions['format']>('png')
const scope = ref<'current' | 'all'>('current')
const quality = ref(92)
const lossy = computed(() => format.value === 'jpeg' || format.value === 'webp')
const cancelButtonProps = computed(() => ({ disabled: props.busy && (!props.progress || !!props.canceling || props.progress.finalizing), 'aria-label': props.busy && props.progress ? '取消 PDF 导出' : '取消' }))
watch(() => props.open, value => {
  if (value) {
    format.value = props.pdf ? 'pdf' : props.defaults?.imageFormat || 'png'
    scope.value = props.pdf ? props.defaults?.pdfScope || 'all' : 'current'
    quality.value = props.defaults?.imageQuality || 92
  }
})
const descriptions: Record<ExportOptions['format'], string> = {
  png: '无损画质，支持透明背景，适合文字和界面截图。',
  jpeg: '文件更小，透明背景会填充为白色，适合照片。',
  webp: '支持透明背景，可以调整画质与文件大小。',
  bmp: '未压缩位图，文件较大，透明背景会填充为白色。',
  pdf: '保存为带标注的 PDF。页面会合并为图片，不保留可选文字、链接和表单。',
}
const options = [
  { value: 'png', label: 'PNG · 无损图片' }, { value: 'jpeg', label: 'JPEG · 照片图片' },
  { value: 'webp', label: 'WebP · 轻量图片' }, { value: 'bmp', label: 'BMP · 位图图片' },
  { value: 'pdf', label: 'PDF · 文档' },
]
function confirm() { if (!props.busy) emit('confirm', { format: format.value, ...(format.value === 'pdf' ? { scope: props.pdf ? scope.value : 'current' } : {}), ...(lossy.value ? { quality: quality.value } : {}) }) }
function cancel() {
  if (props.busy) { if (props.progress && !props.canceling && !props.progress.finalizing) emit('cancelExport') }
  else emit('update:open', false)
}
</script>

<template>
  <AModal :open="open" title="保存文件" :width="410" ok-text="确认保存" :cancel-text="busy && progress ? (canceling ? '正在取消…' : '取消导出') : '取消'"
    :style="{ top: '16px' }" :body-style="{ maxHeight: 'calc(100vh - 150px)', overflowY: 'auto' }"
    :confirm-loading="busy" :closable="!busy" :mask-closable="!busy" :keyboard="!busy"
    :cancel-button-props="cancelButtonProps" @ok="confirm" @cancel="cancel">
    <div class="export-form">
      <div class="export-size">原始尺寸 {{ width }} × {{ height }} 像素</div>
      <label>保存格式</label>
      <ASelect v-model:value="format" aria-label="保存格式" :options="options" :disabled="busy" />
      <p>{{ descriptions[format] }}</p>
      <template v-if="format === 'pdf' && pdf">
        <label>保存范围</label>
        <ASelect v-model:value="scope" aria-label="PDF 导出范围" :disabled="busy" :options="[{ value: 'all', label: '全部页面' }, { value: 'current', label: '当前页' }]" />
        <small>{{ scope === 'all' ? `按顺序保存全部 ${pageCount} 页` : `仅保存第 ${currentPage} 页` }}</small>
      </template>
      <p v-else-if="pdf">图片格式仅保存当前第 {{ currentPage }} 页。</p>
      <template v-if="lossy">
        <label class="quality-label">图片质量 <span>{{ quality }}%</span></label>
        <ASlider v-model:value="quality" :min="10" :max="100" :disabled="busy" :aria-label-for-handle="'图片质量'" />
      </template>
      <div v-if="busy && progress" class="export-progress" data-testid="pdf-export-progress" role="status" aria-live="polite">
        <progress :value="progress.completed" :max="progress.total" aria-label="PDF导出进度"></progress>
        <span>{{ canceling ? '正在取消导出…' : progress.finalizing ? '正在写入 PDF…' : `正在导出 ${progress.completed} / ${progress.total} 页` }}</span>
      </div>
      <small>保存包含标注和水印，不包含识别框和译文。缩放只影响预览。</small>
    </div>
  </AModal>
</template>

<style scoped>
.export-form{display:flex;flex-direction:column;gap:10px;padding:12px 0 6px}.export-size{color:#777180;font-size:12px;margin-bottom:4px}.export-form label{font-size:12px;font-weight:600;color:#4d4856}.export-form p{font-size:12px;color:#756e7e;margin:0 0 6px;line-height:1.6}.export-form small{font-size:11px;line-height:1.7;color:#89828f}.quality-label{display:flex;justify-content:space-between}.quality-label span{font-variant-numeric:tabular-nums;font-weight:400}
.export-progress{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7655aa}.export-progress progress{width:100%;height:6px;accent-color:#8063b2}
</style>
