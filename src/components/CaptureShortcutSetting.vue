<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { Button as AButton, Checkbox as ACheckbox, Select as ASelect } from 'ant-design-vue'
import { Keyboard } from 'lucide-vue-next'
import { buildCaptureShortcut, captureShortcutWarning, formatCaptureShortcut, shortcutKeyOptions, shortcutModifiers, splitCaptureShortcut } from '../settings/capture-shortcut'

const props = defineProps<{
  savedShortcut: string
  activeShortcut: string
  registered: boolean | undefined
  reason?: string
  busy: boolean
  applying: boolean
  retrying: boolean
}>()
const emit = defineEmits<{ apply: [shortcut: string]; retry: [] }>()
const modifiers = ref<string[]>([])
const mainKey = ref('A')
const keyInputId = useId()
const draft = computed(() => buildCaptureShortcut(modifiers.value, mainKey.value))
const warning = computed(() => captureShortcutWarning(modifiers.value, mainKey.value))
const unchanged = computed(() => draft.value === props.savedShortcut)
const activeLabel = computed(() => formatCaptureShortcut(props.activeShortcut))
const filterKeys = (input: string, option?: { label?: unknown; value?: unknown }) => `${option?.label || ''} ${option?.value || ''}`.toLowerCase().includes(input.toLowerCase())

function setDraft(value: string) {
  const parts = splitCaptureShortcut(value)
  modifiers.value = parts.modifiers
  mainKey.value = parts.key
}
// Only a committed change replaces the draft. A failed apply leaves the saved
// value unchanged, so the user's proposed combination remains ready to adjust.
watch(() => props.savedShortcut, setDraft, { immediate: true })
function toggleModifier(value: string, checked: boolean) {
  if (props.busy) return
  modifiers.value = checked ? [...modifiers.value, value] : modifiers.value.filter(item => item !== value)
}
function apply() {
  if (props.busy || warning.value || (unchanged.value && props.registered)) return
  emit('apply', draft.value)
}
function restore() {
  if (props.busy) return
  setDraft('Alt+A')
  if (props.savedShortcut !== 'Alt+A' || !props.registered) emit('apply', 'Alt+A')
}
</script>

<template>
  <section class="shortcut-setting" aria-label="截图快捷键" data-testid="capture-shortcut-setting">
    <div class="shortcut-heading"><label><Keyboard :size="14" />截图快捷键</label><span class="current-shortcut">当前：<kbd data-testid="capture-shortcut-current">{{ activeLabel }}</kbd></span></div>
    <p class="shortcut-state" :class="{ warning: registered === false }" role="status">{{ registered === undefined ? '正在读取快捷键状态…' : registered ? '快捷键已就绪。' : reason || `${activeLabel} 暂时无法启用，请解除冲突后重试。` }}</p>
    <div class="shortcut-fields">
      <div class="modifier-field"><span class="field-label">修饰键</span><div class="modifier-options" role="group" aria-label="截图快捷键修饰键"><ACheckbox v-for="item in shortcutModifiers" :key="item.value" :aria-label="item.label" :checked="modifiers.includes(item.value)" :disabled="busy" @change="event => toggleModifier(item.value, event.target.checked)">{{ item.label }}</ACheckbox></div></div>
      <div class="main-key-field"><label class="field-label" :for="keyInputId">主键</label><ASelect :id="keyInputId" v-model:value="mainKey" aria-label="截图快捷键主键" show-search :filter-option="filterKeys" :options="shortcutKeyOptions" :disabled="busy" /></div>
    </div>
    <p v-if="warning" class="shortcut-validation" role="status">{{ warning }}</p>
    <p v-else-if="!unchanged" class="shortcut-draft" data-testid="capture-shortcut-draft">待应用：{{ formatCaptureShortcut(draft) }}</p>
    <div class="shortcut-actions">
      <AButton size="small" type="primary" aria-label="应用快捷键" :disabled="busy || !!warning || (unchanged && !!registered)" :loading="applying" @click="apply">应用快捷键</AButton>
      <AButton size="small" aria-label="恢复Alt + A" :disabled="busy || (savedShortcut === 'Alt+A' && draft === 'Alt+A' && !!registered)" @click="restore">恢复 Alt + A</AButton>
      <AButton v-if="registered === false" size="small" aria-label="重试注册截图快捷键" :disabled="busy" :loading="retrying" @click="emit('retry')">重试注册</AButton>
    </div>
    <p class="shortcut-help">选择组合后应用即生效；若被占用，会保留原快捷键。</p>
  </section>
</template>

<style scoped>
.shortcut-setting{padding:15px 0 12px;border-bottom:1px solid #ece7f0}.shortcut-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px}.shortcut-heading>label{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500}.shortcut-heading svg{color:#8b729f}.current-shortcut{display:flex;align-items:center;gap:4px;min-width:0;color:#9a8aa7;font-size:10px}.current-shortcut kbd{display:inline-block;min-width:0;height:auto;padding:3px 6px;border-radius:4px;font:11px/1.5 'Segoe UI',sans-serif;color:#765c8a;overflow-wrap:anywhere;max-width:100%}.shortcut-state{margin:6px 0 13px;color:#8b7f94;font-size:11px;line-height:1.6}.shortcut-state.warning,.shortcut-validation{color:#a66c2e}.shortcut-fields{display:grid;grid-template-columns:minmax(0,1fr) 178px;align-items:end;gap:12px}.modifier-field,.main-key-field{display:flex;flex-direction:column;gap:7px;min-width:0}.field-label{color:#8b7f94;font-size:11px}.modifier-options{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;min-height:31px}.modifier-options :deep(.ant-checkbox-wrapper){margin:0;color:#75677e;font-size:11px}.modifier-options :deep(.ant-checkbox + span){padding-inline-start:5px;padding-inline-end:0}.main-key-field :deep(.ant-select){width:100%;font-size:12px}.main-key-field :deep(.ant-select-selector){height:31px!important;min-height:31px;border-radius:4px!important}.main-key-field :deep(.ant-select-selection-item){line-height:29px!important}.shortcut-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}.shortcut-actions :deep(.ant-btn){height:28px;padding:0 10px;border-radius:4px;font-size:11px;box-shadow:none}.shortcut-draft,.shortcut-validation,.shortcut-help{margin:9px 0 0;font-size:11px;line-height:1.7}.shortcut-draft{color:#8964a0}.shortcut-help{color:#9a8aa7}.shortcut-validation{margin-bottom:0}@media(max-width:560px){.shortcut-fields{grid-template-columns:1fr;gap:10px}.modifier-options{min-height:24px}.current-shortcut{max-width:100%}.main-key-field :deep(.ant-select){max-width:100%}}
</style>
