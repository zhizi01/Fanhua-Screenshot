<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button as AButton, Input as AInput, InputNumber as AInputNumber, Modal as AModal, Select as ASelect, Slider as ASlider, Switch as ASwitch, message } from 'ant-design-vue'
import { Check, Grid3X3, ImagePlus, Save, Trash2, Type } from 'lucide-vue-next'
import type { WatermarkConfig, WatermarkPlacement, WatermarkPreset } from '../shared'
import { loadWatermarkImage } from '../watermark/render'
import { deletePreset, listPresets, plainWatermark, savePreset } from '../watermark/presets'

const props = defineProps<{ open: boolean; modelValue: WatermarkConfig; fonts: string[] }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; 'update:modelValue': [value: WatermarkConfig] }>()
const presets = ref<WatermarkPreset[]>([])
const presetId = ref<string>()
const presetName = ref('')
const loadingPresets = ref(false)
const savingPreset = ref(false)
const choosingImage = ref(false)
const imageInput = ref<HTMLInputElement>()
const presetError = ref('')
const fontOptions = computed(() => [...new Set([props.modelValue.font, ...props.fonts])].filter(Boolean).map(value => ({ value, label: value })))
const presetOptions = computed(() => presets.value.map(item => ({ value: item.id, label: item.name })))
const selectedPreset = computed(() => presets.value.find(item => item.id === presetId.value))
const positions: { value: WatermarkPlacement; name: string }[] = [
  { value: 'top-left', name: '左上' }, { value: 'top-center', name: '上中' }, { value: 'top-right', name: '右上' },
  { value: 'center-left', name: '左中' }, { value: 'center', name: '居中' }, { value: 'center-right', name: '右中' },
  { value: 'bottom-left', name: '左下' }, { value: 'bottom-center', name: '下中' }, { value: 'bottom-right', name: '右下' },
]

function update(patch: Partial<WatermarkConfig>) {
  emit('update:modelValue', plainWatermark({ ...props.modelValue, ...patch }))
}
function close() { emit('update:open', false) }
function remove() { update({ enabled: false }); close() }
function fontSearch(input: string, option?: { label?: unknown }) { return String(option?.label || '').toLocaleLowerCase().includes(input.toLocaleLowerCase()) }

async function refreshPresets() {
  loadingPresets.value = true
  presetError.value = ''
  try {
    presets.value = await listPresets()
    if (presetId.value && !presets.value.some(item => item.id === presetId.value)) presetId.value = undefined
  } catch (error) { presetError.value = error instanceof Error ? error.message : '无法读取水印存档' }
  finally { loadingPresets.value = false }
}

async function applyPreset(value: unknown) {
  const id = typeof value === 'string' ? value : undefined
  const preset = presets.value.find(item => item.id === id)
  if (!preset) { presetId.value = undefined; return }
  try {
    const config = plainWatermark({ ...preset.config, enabled: true })
    if (config.kind === 'image') {
      if (!config.imageDataUrl) throw new Error('此存档没有水印图片，请重新选择图片')
      await loadWatermarkImage(config.imageDataUrl)
    }
    emit('update:modelValue', config)
    presetId.value = preset.id
    presetName.value = preset.name
  } catch (error) { message.error(error instanceof Error ? error.message : '水印存档加载失败') }
}

async function archive(overwrite = false) {
  if (savingPreset.value) return
  if (!props.modelValue.enabled) { message.info('请先启用水印'); return }
  if (props.modelValue.kind === 'text' && !props.modelValue.text.trim()) { message.info('请输入水印文字'); return }
  if (props.modelValue.kind === 'image' && !props.modelValue.imageDataUrl) { message.info('请选择水印图片'); return }
  savingPreset.value = true
  try {
    const preset = await savePreset(presetName.value, props.modelValue, overwrite ? selectedPreset.value?.id : undefined)
    await refreshPresets()
    presetId.value = preset.id
    presetName.value = preset.name
    message.success(overwrite ? '已更新水印存档' : '水印已存档')
  } catch (error) { message.error(error instanceof Error ? error.message : '水印存档保存失败') }
  finally { savingPreset.value = false }
}

async function removePreset() {
  if (!selectedPreset.value || savingPreset.value) return
  savingPreset.value = true
  try {
    await deletePreset(selectedPreset.value.id)
    presetId.value = undefined
    await refreshPresets()
    message.success('水印存档已删除，当前图片中的水印仍保留')
  } catch (error) { message.error(error instanceof Error ? error.message : '无法删除水印存档') }
  finally { savingPreset.value = false }
}

async function chooseImage() {
  if (choosingImage.value) return
  if (!window.fanhua) { imageInput.value?.click(); return }
  choosingImage.value = true
  try {
    const chosen = await window.fanhua.chooseWatermarkImage()
    if (!chosen) return
    await loadWatermarkImage(chosen.dataUrl)
    update({ kind: 'image', enabled: true, imageDataUrl: chosen.dataUrl, imageWidth: chosen.width, imageHeight: chosen.height })
  } catch (error) { message.error(error instanceof Error ? error.message : '水印图片打开失败') }
  finally { choosingImage.value = false }
}

async function browserImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 16 * 1024 * 1024) { message.error('请选择小于 16 MB 的水印图片'); return }
  const url = URL.createObjectURL(file)
  choosingImage.value = true
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (image.naturalWidth * image.naturalHeight > 16000000) throw new Error('水印图片最多支持 1600 万像素')
    const scale = Math.min(1, 2048 / image.naturalWidth, 2048 / image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    await loadWatermarkImage(dataUrl)
    update({ kind: 'image', enabled: true, imageDataUrl: dataUrl, imageWidth: canvas.width, imageHeight: canvas.height })
  } catch (error) { message.error(error instanceof Error ? error.message : '水印图片打开失败') }
  finally { URL.revokeObjectURL(url); choosingImage.value = false }
}

watch(() => props.open, open => { if (open) void refreshPresets() }, { immediate: true })
</script>

<template>
  <AModal :open="open" title="水印" :width="600" :style="{ top: '24px' }" :body-style="{ maxHeight: 'calc(100vh - 164px)', overflowY: 'auto', paddingRight: '3px' }" :destroy-on-close="true" @cancel="close">
    <div class="watermark-panel" data-testid="watermark-panel">
      <div class="enable-row"><span>在图片上添加水印</span><ASwitch aria-label="启用水印" :checked="modelValue.enabled" @change="value => update({ enabled: Boolean(value) })" /></div>
      <div class="kind-row" role="group" aria-label="水印类型">
        <button :class="{ active: modelValue.kind === 'text' }" aria-label="文字水印" :aria-pressed="modelValue.kind === 'text'" @click="update({ kind: 'text' })"><Type :size="15" />文字水印</button>
        <button :class="{ active: modelValue.kind === 'image' }" aria-label="图片水印" :aria-pressed="modelValue.kind === 'image'" @click="update({ kind: 'image' })"><ImagePlus :size="15" />图片水印</button>
      </div>

      <div v-if="modelValue.kind === 'text'" class="text-settings">
        <label class="field">水印文字<textarea aria-label="水印文字内容" :value="modelValue.text" rows="2" maxlength="2000" placeholder="输入水印文字，可换行" @input="update({ text: ($event.target as HTMLTextAreaElement).value })" /></label>
        <div class="text-style-row">
          <label class="field font-field">字体<ASelect size="small" show-search aria-label="水印字体" :value="modelValue.font" :options="fontOptions" :filter-option="fontSearch" @change="value => update({ font: String(value) })"><template #option="option"><span :style="{ fontFamily: String(option.value) }">{{ option.label }}</span></template></ASelect></label>
          <label class="field size-field">字号<AInputNumber size="small" aria-label="水印字号" :value="modelValue.fontSize" :min="8" :max="240" :precision="0" @change="value => update({ fontSize: Number(value) || 28 })" /></label>
          <label class="field color-field">颜色<input type="color" aria-label="水印颜色" :value="modelValue.color" @input="update({ color: ($event.target as HTMLInputElement).value })" /></label>
        </div>
      </div>
      <div v-else class="image-settings">
        <div class="image-picker"><div class="image-thumbnail"><img v-if="modelValue.imageDataUrl" :src="modelValue.imageDataUrl" alt="当前水印图片" /><ImagePlus v-else :size="23" /></div><div><AButton size="small" :loading="choosingImage" aria-label="选择水印图片" @click="chooseImage">{{ modelValue.imageDataUrl ? '更换图片' : '选择图片' }}</AButton><p>{{ modelValue.imageDataUrl ? `${modelValue.imageWidth} × ${modelValue.imageHeight} px` : '支持透明 PNG、JPEG，源文件最大 16 MB' }}</p><p>最长边缩至 2048 px，存档图片最大 8 MB。</p></div></div>
        <input ref="imageInput" class="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" aria-label="浏览器选择水印图片" @change="browserImage" />
        <label class="field inline-field">图片大小<AInputNumber size="small" aria-label="图片水印缩放百分比" :value="Math.round(modelValue.scale * 100)" :min="5" :max="400" :precision="0" addon-after="%" @change="value => update({ scale: Number(value) / 100 })" /><span class="subtle">相对原图尺寸，过大时适应画面</span></label>
      </div>

      <div class="layout-section">
        <div class="placement-field"><span class="field-title">铺设位置</span><div class="anchor-grid" role="group" aria-label="单个水印位置"><button v-for="position in positions" :key="position.value" :class="{ active: modelValue.placement === position.value }" :aria-label="`水印位置 ${position.name}`" :aria-pressed="modelValue.placement === position.value" @click="update({ placement: position.value })">{{ position.name }}</button></div><button class="tile-button" :class="{ active: modelValue.placement === 'tile' }" aria-label="全图平铺水印" :aria-pressed="modelValue.placement === 'tile'" @click="update({ placement: 'tile' })"><Grid3X3 :size="14" />全图平铺</button></div>
        <div class="layout-controls">
          <label class="field opacity-field"><span>透明度 <strong>{{ Math.round(modelValue.opacity * 100) }}%</strong></span><ASlider aria-label-for-handle="水印透明度" :value="Math.round(modelValue.opacity * 100)" :min="0" :max="100" @change="value => update({ opacity: Number(value) / 100 })" /></label>
          <label class="field inline-field">旋转<AInputNumber size="small" aria-label="水印旋转角度" :value="modelValue.rotation" :min="-180" :max="180" :precision="0" addon-after="°" @change="value => update({ rotation: Number(value) })" /></label>
          <label class="field inline-field">{{ modelValue.placement === 'tile' ? '平铺间距' : '边距' }}<AInputNumber size="small" :aria-label="modelValue.placement === 'tile' ? '水印平铺间距' : '水印边距'" :value="modelValue.placement === 'tile' ? modelValue.spacing : modelValue.margin" :min="0" :max="1000" :precision="0" addon-after="px" @change="value => update(modelValue.placement === 'tile' ? { spacing: Number(value) } : { margin: Number(value) })" /></label>
        </div>
      </div>

      <section class="preset-section" aria-label="水印存档">
        <div class="preset-heading"><strong>水印存档</strong><span>文字和图片均可保存，下次直接使用</span></div>
        <div class="preset-load-row"><ASelect size="small" aria-label="选择水印存档" :value="presetId" :options="presetOptions" :loading="loadingPresets" :disabled="savingPreset || loadingPresets" allow-clear placeholder="选择已保存的水印" @change="applyPreset" /><AButton size="small" danger :disabled="!selectedPreset || savingPreset" aria-label="删除水印存档" title="仅删除已选存档，保留当前图片中的水印" @click="removePreset"><template #icon><Trash2 :size="14" /></template></AButton></div>
        <div class="preset-save-row"><AInput size="small" v-model:value="presetName" aria-label="水印存档名称" :maxlength="60" placeholder="存档名称" @press-enter="archive(false)" /><AButton size="small" :loading="savingPreset" aria-label="另存水印存档" @click="archive(false)"><template #icon><Save :size="13" /></template>另存</AButton><AButton size="small" :disabled="!selectedPreset || savingPreset" aria-label="更新水印存档" @click="archive(true)">更新</AButton></div>
        <p v-if="presetError" class="error-message" role="alert">{{ presetError }}</p>
      </section>
      <p class="preview-note"><Check :size="12" />更改实时应用于图片；保存图片时会合并水印。</p>
    </div>
    <template #footer><div class="footer-actions"><AButton size="small" danger :disabled="!modelValue.enabled" aria-label="移除当前水印" @click="remove">移除水印</AButton><AButton size="small" type="primary" aria-label="完成水印设置" @click="close">完成</AButton></div></template>
  </AModal>
</template>

<style scoped>
.watermark-panel { color: #47424e; font-size: 12px; }
.enable-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.kind-row { display: flex; gap: 7px; margin-bottom: 15px; }
.kind-row button, .anchor-grid button, .tile-button { border: 1px solid #dedbe4; background: #fff; border-radius: 5px; color: #736b7d; }
.kind-row button { display: flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 12px; }
.kind-row button:hover, .anchor-grid button:hover, .tile-button:hover { border-color: #b8a6dc; }
.kind-row button.active, .anchor-grid button.active, .tile-button.active { color: #7657bf; border-color: #bfa9e5; background: #f4effc; }
.field { display: flex; flex-direction: column; gap: 6px; margin: 0 0 12px; font-size: 11px; color: #84798f; }
.field textarea { width: 100%; resize: vertical; min-height: 54px; max-height: 120px; border: 1px solid #d9d3e2; border-radius: 5px; padding: 7px 9px; color: #423b4b; line-height: 1.5; outline: none; font-size: 12px; }
.field textarea:focus { border-color: #a78bd6; }
.text-style-row { display: flex; align-items: flex-start; gap: 12px; }
.font-field { flex: 1; min-width: 0; }
.size-field { width: 78px; }
.size-field :deep(.ant-input-number) { width: 100%; }
.color-field { width: 45px; }
.color-field input { width: 45px; height: 24px; border: 1px solid #d9d3e2; padding: 2px; background: #fff; border-radius: 4px; }
.field :deep(.ant-select), .field :deep(.ant-input-number) { font-size: 12px; }
.field :deep(.ant-select-selector), .preset-section :deep(.ant-select-selector) { font-size: 12px !important; }
.layout-section { display: flex; gap: 28px; padding: 14px 0; border-top: 1px solid #eeebf2; border-bottom: 1px solid #eeebf2; }
.placement-field { width: 154px; flex-shrink: 0; }
.field-title { font-size: 11px; color: #84798f; display: block; margin-bottom: 7px; }
.anchor-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.anchor-grid button { height: 29px; font-size: 10px; padding: 0; }
.tile-button { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; height: 28px; font-size: 11px; margin-top: 7px; }
.layout-controls { flex: 1; min-width: 0; }
.opacity-field > span { display: flex; justify-content: space-between; }
.opacity-field strong { font-weight: 500; color: #8062b7; }
.opacity-field :deep(.ant-slider) { margin: 5px 5px 8px; }
.inline-field { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 12px; }
.inline-field :deep(.ant-input-number-group-wrapper) { width: 112px; }
.inline-field :deep(.ant-input-number) { width: 100%; }
.inline-field :deep(.ant-input-number-group-addon) { font-size: 10px; padding: 0 8px; }
.image-settings .inline-field { justify-content: flex-start; }
.subtle { color: #a397af; font-size: 10px; }
.image-picker { display: flex; align-items: center; gap: 13px; margin-bottom: 13px; }
.image-thumbnail { width: 72px; height: 62px; border: 1px solid #ddd7e5; border-radius: 5px; display: flex; align-items: center; justify-content: center; color: #b5a7c4; background-color: #fff; background-image: linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%); background-size: 12px 12px; background-position: 0 0,0 6px,6px -6px,-6px 0; }
.image-thumbnail img { max-width: 64px; max-height: 54px; object-fit: contain; }
.image-picker p { margin: 5px 0 0; font-size: 10px; color: #a195af; }
.file-input { display: none; }
.preset-section { margin-top: 15px; }
.preset-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px; gap: 10px; }
.preset-heading strong { font-weight: 500; font-size: 12px; }
.preset-heading span { font-size: 10px; color: #a195ad; }
.preset-load-row, .preset-save-row { display: flex; gap: 7px; align-items: center; margin-bottom: 8px; }
.preset-load-row > :first-child, .preset-save-row > :first-child { flex: 1; min-width: 0; }
.preset-section :deep(.ant-btn) { display: inline-flex; align-items: center; justify-content: center; gap: 4px; font-size: 11px; }
.preset-section :deep(.ant-btn-icon) { display: flex; margin: 0; }
.error-message { font-size: 11px; color: #b94242; margin: 7px 0; }
.preview-note { display: flex; align-items: center; gap: 5px; font-size: 10px; color: #9a8ca9; margin: 14px 0 0; }
.footer-actions { display: flex; align-items: center; justify-content: space-between; }
.footer-actions :deep(.ant-btn) { font-size: 12px; }
@media(max-width: 480px) {
  .layout-section { gap: 15px; }
  .placement-field { width: 130px; }
  .text-style-row { gap: 8px; }
  .preset-heading span, .subtle { display: none; }
  .inline-field { gap: 6px; }
  .inline-field :deep(.ant-input-number-group-wrapper) { width: 95px; }
}
</style>
