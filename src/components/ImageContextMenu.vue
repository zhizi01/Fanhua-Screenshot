<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Copy, Download, Pencil, Redo2, Trash2, Undo2 } from 'lucide-vue-next'

type ImageContextCommand = 'edit' | 'finish' | 'copy' | 'save' | 'undo' | 'redo' | 'delete'
const props = defineProps<{ open: boolean; x: number; y: number; editing: boolean; hasSelection: boolean; canUndo: boolean; canRedo: boolean }>()
const emit = defineEmits<{ close: [restoreFocus: boolean]; command: [command: ImageContextCommand] }>()
const menu = ref<HTMLElement>()
const position = ref({ left: '0px', top: '0px' })
let request = 0

watch(() => [props.open, props.x, props.y], async () => {
  const current = ++request
  if (!props.open) return
  position.value = { left: `${Math.max(6, props.x)}px`, top: `${Math.max(6, props.y)}px` }
  await nextTick()
  if (current !== request || !menu.value) return
  const box = menu.value.getBoundingClientRect()
  position.value = {
    left: `${Math.max(6, Math.min(props.x, window.innerWidth - box.width - 6))}px`,
    top: `${Math.max(6, Math.min(props.y, window.innerHeight - box.height - 6))}px`,
  }
  menu.value.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
}, { flush: 'post' })

function dismiss(event: Event) {
  if (props.open && !menu.value?.contains(event.target as Node)) emit('close', false)
}
function hide() { if (props.open) emit('close', false) }
function execute(command: ImageContextCommand) { emit('close', false); emit('command', command) }
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close', true); return }
  if (event.key === 'Tab') { emit('close', false); return }
  const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
  if (!buttons.length) return
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'ArrowDown' ? (current + 1) % buttons.length
    : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
  if (index >= 0) { event.preventDefault(); buttons[index]?.focus() }
}
onMounted(() => {
  document.addEventListener('pointerdown', dismiss, true)
  window.addEventListener('resize', hide)
  window.addEventListener('blur', hide)
  window.addEventListener('wheel', hide, { passive: true })
})
onBeforeUnmount(() => {
  request++
  document.removeEventListener('pointerdown', dismiss, true)
  window.removeEventListener('resize', hide)
  window.removeEventListener('blur', hide)
  window.removeEventListener('wheel', hide)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="menu" class="image-context-menu" :style="position" role="menu" aria-label="图片右键菜单" data-testid="image-context-menu" @keydown.stop="keyboard" @contextmenu.prevent @pointerdown.stop>
      <button type="button" role="menuitem" @click="execute('edit')"><Pencil :size="14" />{{ hasSelection ? '编辑选中标注' : '编辑图片' }}</button>
      <button v-if="editing" type="button" role="menuitem" @click="execute('finish')"><Check :size="14" />完成编辑</button>
      <div class="menu-separator" role="separator"></div>
      <button type="button" role="menuitem" @click="execute('copy')"><Copy :size="14" />复制到剪贴板 <kbd>Ctrl+C</kbd></button>
      <button type="button" role="menuitem" @click="execute('save')"><Download :size="14" />保存图片 <kbd>Ctrl+S</kbd></button>
      <template v-if="editing">
        <div class="menu-separator" role="separator"></div>
        <button type="button" role="menuitem" :disabled="!canUndo" @click="execute('undo')"><Undo2 :size="14" />撤销</button>
        <button type="button" role="menuitem" :disabled="!canRedo" @click="execute('redo')"><Redo2 :size="14" />重做</button>
        <button type="button" role="menuitem" class="delete-action" :disabled="!hasSelection" @click="execute('delete')"><Trash2 :size="14" />删除选中标注 <kbd>Delete</kbd></button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.image-context-menu{position:fixed;z-index:1100;width:202px;max-width:calc(100vw - 12px);max-height:calc(100vh - 12px);overflow:auto;padding:5px;border:1px solid #e2dbe9;border-radius:6px;background:#fff;box-shadow:0 5px 22px #34244126;color:#60516e}
.image-context-menu button{width:100%;display:flex;align-items:center;gap:7px;border:0;background:transparent;border-radius:3px;padding:7px 8px;color:inherit;font:12px/1.4 'Segoe UI','Microsoft YaHei UI',sans-serif;text-align:left;cursor:pointer}
.image-context-menu button:hover,.image-context-menu button:focus-visible{outline:0;background:#f3edf9;color:#7655aa}.image-context-menu button:disabled{opacity:.35;cursor:default;background:transparent}.image-context-menu kbd{margin-left:auto;font-size:10px;color:#a195aa;font-family:inherit}.menu-separator{height:1px;margin:4px 5px;background:#ece7f1}.image-context-menu .delete-action:not(:disabled){color:#b45263}
</style>
