<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-vue-next'
import { InputNumber as AInputNumber } from 'ant-design-vue'

const props = defineProps<{ page: number; total: number; name: string; busy: boolean }>()
const emit = defineEmits<{ navigate: [page: number] }>()
const entered = ref<number | undefined>(props.page)
watch(() => props.page, value => { entered.value = value })
watch(() => props.busy, value => { if (!value) entered.value = props.page })
function navigate(value: number | null | undefined) {
  const page = Math.min(props.total, Math.max(1, Math.trunc(value || props.page)))
  entered.value = page
  if (!props.busy && page !== props.page) emit('navigate', page)
}
</script>

<template>
  <div class="pdf-page-bar" aria-label="PDF 页面导航">
    <div class="pdf-name" :title="name"><FileText :size="14" /><span>{{ name }}</span></div>
    <div class="pdf-navigation">
      <button type="button" aria-label="上一页" title="上一页" :disabled="busy || page <= 1" @click="navigate(page - 1)"><ChevronLeft :size="16" /></button>
      <AInputNumber v-model:value="entered" size="small" aria-label="PDF 页码" :min="1" :max="total" :precision="0" :controls="false" :disabled="busy" @press-enter="navigate(entered)" @blur="navigate(entered)" />
      <span class="pdf-total">/ {{ total }}</span>
      <button type="button" aria-label="下一页" title="下一页" :disabled="busy || page >= total" @click="navigate(page + 1)"><ChevronRight :size="16" /></button>
    </div>
  </div>
</template>

<style scoped>
.pdf-page-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:35px;flex-shrink:0;padding:4px 10px;background:#f9f7fc;border-bottom:1px solid #e7e1ee;color:#75667f;font-size:11px}.pdf-name{min-width:0;display:flex;align-items:center;gap:6px}.pdf-name svg{flex-shrink:0}.pdf-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pdf-navigation{display:flex;align-items:center;gap:5px;flex-shrink:0}.pdf-navigation button{display:flex;align-items:center;justify-content:center;width:24px;height:24px;background:transparent;border:0;border-radius:4px;color:#73558c;cursor:pointer}.pdf-navigation button:hover:not(:disabled){background:#eee7f7}.pdf-navigation button:disabled{opacity:.35;cursor:default}.pdf-navigation :deep(.ant-input-number){width:47px;font-size:11px}.pdf-navigation :deep(input){text-align:center;padding:0 4px}.pdf-total{font-variant-numeric:tabular-nums;min-width:24px;white-space:nowrap}
</style>
