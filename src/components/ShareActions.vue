<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { Button as AButton, Dropdown as ADropdown, Menu as AMenu, MenuItem as AMenuItem, Tooltip as ATooltip } from 'ant-design-vue'
import { ChevronDown, Copy, MonitorUp, Share2 } from 'lucide-vue-next'

const props = defineProps<{
  disabled: boolean
  desktop: boolean
  copying: 'png' | 'deskflow' | null
  sharing: boolean
}>()
const emit = defineEmits<{
  copy: [mode: 'png' | 'deskflow']
  share: []
}>()
const open = ref(false)
const shareOpen = ref(false)
const shareTrigger = ref<{ $el?: HTMLElement }>()
const shareMenuId = useId()
let focusFrame = 0
const busy = computed(() => !!props.copying || props.sharing)
watch(() => props.disabled || busy.value, disabled => { if (disabled) { open.value = false; shareOpen.value = false } })
watch(open, value => { if (value) shareOpen.value = false })
watch(shareOpen, value => { if (value) open.value = false; else cancelAnimationFrame(focusFrame) })
watch(() => props.desktop, value => { if (!value) shareOpen.value = false })
function choose(mode: 'png' | 'deskflow') {
  if (props.disabled || busy.value || (mode === 'deskflow' && !props.desktop)) return
  open.value = false
  emit('copy', mode)
}
function chooseLocalSend() {
  if (props.disabled || busy.value || !props.desktop) return
  shareOpen.value = false
  emit('share')
}
function closeSharing(restoreFocus = false) {
  shareOpen.value = false
  if (restoreFocus) void nextTick(() => shareTrigger.value?.$el?.focus())
}
async function openSharingWithKeyboard() {
  if (props.disabled || busy.value || !props.desktop) return
  shareOpen.value = true
  await nextTick()
  cancelAnimationFrame(focusFrame)
  focusSharingItem()
}
function focusSharingItem() {
  if (!shareOpen.value || props.disabled || busy.value || !props.desktop) return
  // Ant's portal can still be hidden after nextTick. Focus its native menu
  // only once visible, rather than relying on the cloned component's ref.
  const item = document.getElementById(shareMenuId)?.querySelector<HTMLElement>('[role="menuitem"]')
  if (item?.getClientRects().length) item.focus()
  else focusFrame = requestAnimationFrame(focusSharingItem)
}
function shareMenuKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') { event.preventDefault(); closeSharing(true) }
}
onBeforeUnmount(() => cancelAnimationFrame(focusFrame))
</script>

<template>
  <div class="share-actions">
    <div class="copy-group">
      <AButton class="copy-primary" size="small" type="text" :disabled="disabled || busy" :loading="!!copying" aria-label="复制图片" title="复制到剪贴板（PNG） Ctrl+C" @click="choose('png')">
        <template #icon><Copy :size="15" /></template><span class="action-label">复制</span>
      </AButton>
      <ADropdown v-model:open="open" :trigger="['click']" placement="bottomRight" :disabled="disabled || busy">
        <AButton class="copy-options" size="small" type="text" :disabled="disabled || busy" aria-label="选择复制方式" aria-haspopup="menu" :aria-expanded="open" title="选择复制方式"><ChevronDown :size="11" /></AButton>
        <template #overlay>
          <AMenu class="copy-menu" @keydown.stop>
            <AMenuItem key="png" aria-label="复制到剪贴板" @click="choose('png')"><span class="copy-menu-content"><Copy :size="14" /><span>复制到剪贴板</span><small>PNG</small></span></AMenuItem>
            <AMenuItem key="deskflow" :disabled="!desktop" aria-label="复制到 DeskFlow 剪贴板" @click="choose('deskflow')">
              <ATooltip title="由于DeskFlow传输有限制，会造成质量压缩。" placement="bottomRight" :mouse-enter-delay="0.2">
                <span class="copy-menu-content"><MonitorUp :size="14" /><span>复制到 DeskFlow 剪贴板</span><small>JPG · 60%</small></span>
              </ATooltip>
            </AMenuItem>
          </AMenu>
        </template>
      </ADropdown>
    </div>
    <ADropdown v-model:open="shareOpen" :trigger="['click']" placement="bottomRight" :disabled="disabled || busy || !desktop">
      <AButton ref="shareTrigger" class="share-trigger" size="small" type="text" :disabled="disabled || busy || !desktop" :loading="sharing" aria-label="选择共享方式" aria-haspopup="menu" :aria-expanded="shareOpen" :title="desktop ? '选择共享方式' : '图片共享需在桌面版运行'" @keydown.down.prevent.stop="openSharingWithKeyboard" @keydown.esc.prevent.stop="closeSharing(true)">
        <template #icon><Share2 :size="15" /></template><span class="action-label">共享</span><ChevronDown :size="11" />
      </AButton>
      <template #overlay>
        <AMenu :id="shareMenuId" class="copy-menu share-menu" aria-label="共享方式" @keydown="shareMenuKeydown">
          <AMenuItem key="localsend" :disabled="disabled || busy || !desktop" aria-label="通过LocalSend共享" @click="chooseLocalSend"><span class="copy-menu-content"><Share2 :size="14" /><span>通过LocalSend共享</span></span></AMenuItem>
        </AMenu>
      </template>
    </ADropdown>
  </div>
</template>

<style scoped>
.share-actions,.copy-group{display:flex;align-items:center;flex-shrink:0;gap:0}
.share-actions{gap:2px}
.copy-group{border-radius:4px}
.copy-group:hover{background:#eee8f8}
.share-actions :deep(.ant-btn){display:inline-flex;align-items:center;justify-content:center;gap:4px;height:27px;padding:0 7px;color:#6c6078;border-radius:4px;font-size:11px;box-shadow:none}
.share-actions :deep(.ant-btn > .ant-btn-icon){display:inline-flex;margin:0}
.share-actions :deep(.ant-btn:not(:disabled):hover){color:#7655b6;background:#eee8f8}
.share-actions :deep(.ant-btn:disabled){opacity:.4}
.share-actions .copy-primary{border-radius:4px 0 0 4px;padding-right:4px}
.share-actions .copy-options{width:17px;min-width:17px;padding:0;border-radius:0 4px 4px 0}
.copy-menu{min-width:260px;padding:4px;border:1px solid #e8e0ef;border-radius:6px}
.share-menu{min-width:190px}
.copy-menu :deep(.ant-dropdown-menu-item){padding:7px 8px;font-size:12px;border-radius:3px}
.copy-menu-content{display:flex;align-items:center;gap:7px;width:100%;min-height:20px;color:#62536e;outline:none}
.copy-menu-content:focus-visible{outline:1px solid #9d82c9;outline-offset:2px}
.copy-menu-content small{margin-left:auto;padding-left:10px;color:#a093ad;font-size:10px;white-space:nowrap}
@media(max-width:600px){.action-label{display:none}.share-actions .copy-primary{width:29px;padding:0}.share-actions .share-trigger{width:34px;padding:0;gap:2px}.share-actions .copy-options{width:15px;min-width:15px}.share-actions{gap:1px}}
</style>
