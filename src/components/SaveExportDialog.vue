<script setup lang="ts">
import { computed, ref } from 'vue'
import { Modal as AModal, Select as ASelect, Slider as ASlider } from 'ant-design-vue'
import type { ImageFormat, ImageSaveOptions } from '../shared'

defineProps<{ open: boolean; width: number; height: number; busy: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; confirm: [options: ImageSaveOptions] }>()
const format = ref<ImageFormat>('png')
const quality = ref(92)
const lossy = computed(() => format.value === 'jpeg' || format.value === 'webp')
const descriptions: Record<ImageFormat, string> = {
  png: '无损画质，支持透明背景，适合文字和界面截图。',
  jpeg: '文件更小，透明背景会填充为白色，适合照片。',
  webp: '支持透明背景，可以调整画质与文件大小。',
  bmp: '未压缩位图，文件较大，透明背景会填充为白色。',
}
const options = [
  { value: 'png', label: 'PNG · 无损图片' }, { value: 'jpeg', label: 'JPEG · 照片图片' },
  { value: 'webp', label: 'WebP · 轻量图片' }, { value: 'bmp', label: 'BMP · 位图图片' },
]
function confirm() { emit('confirm', { format: format.value, ...(lossy.value ? { quality: quality.value } : {}) }) }
</script>

<template>
  <AModal :open="open" title="保存图片" :width="410" ok-text="确认保存" cancel-text="取消"
    :style="{ top: '16px' }" :body-style="{ maxHeight: 'calc(100vh - 150px)', overflowY: 'auto' }"
    :confirm-loading="busy" :closable="!busy" :mask-closable="!busy" :keyboard="!busy"
    :cancel-button-props="{ disabled: busy }" @ok="confirm" @cancel="emit('update:open', false)">
    <div class="export-form">
      <div class="export-size">原始尺寸 {{ width }} × {{ height }} 像素</div>
      <label>图片格式</label>
      <ASelect v-model:value="format" aria-label="保存格式" :options="options" :disabled="busy" />
      <p>{{ descriptions[format] }}</p>
      <template v-if="lossy">
        <label class="quality-label">图片质量 <span>{{ quality }}%</span></label>
        <ASlider v-model:value="quality" :min="10" :max="100" :disabled="busy" :aria-label-for-handle="'图片质量'" />
      </template>
      <small>保存会包含当前标注和水印，画面缩放不会改变图片尺寸。</small>
    </div>
  </AModal>
</template>

<style scoped>
.export-form{display:flex;flex-direction:column;gap:10px;padding:12px 0 6px}.export-size{color:#777180;font-size:12px;margin-bottom:4px}.export-form label{font-size:12px;font-weight:600;color:#4d4856}.export-form p{font-size:12px;color:#756e7e;margin:0 0 6px;line-height:1.6}.export-form small{font-size:11px;line-height:1.7;color:#89828f}.quality-label{display:flex;justify-content:space-between}.quality-label span{font-variant-numeric:tabular-nums;font-weight:400}
</style>
