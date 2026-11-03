import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { OcrParagraph, TranslationCapabilities, TranslationDirection, TranslationProgress, TranslationResult } from '../shared'

type TranslatedParagraph = TranslationResult['paragraphs'][number]
function failureMessage(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback
  return cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') || fallback
}
export interface TranslationViewState {
  open: boolean
  busy: boolean
  checking: boolean
  available: boolean
  reason: string
  direction: TranslationDirection
  error: string
  notice: string
  status: string
  completed: number
  total: number
  results: Record<string, TranslatedParagraph>
  activeIds: string[]
}

/** Translation is preview state only. It never enters image layers or exports. */
export function useParagraphTranslation(paragraphs: Ref<OcrParagraph[]>, imageId: () => string | undefined) {
  const open = ref(false)
  const running = ref(false)
  const checking = ref(false)
  const canceling = ref(false)
  const capabilities = ref<TranslationCapabilities>()
  const direction = ref<TranslationDirection>('en-zh')
  const error = ref('')
  const notice = ref('')
  const status = ref('')
  const completed = ref(0)
  const total = ref(0)
  const results = ref<Record<string, TranslatedParagraph>>({})
  const activeIds = ref<string[]>([])
  let active: { requestId: string; direction: TranslationDirection; imageId?: string; source: Map<string, string> } | undefined
  let generation = 0
  let capabilityRequest = 0
  let disposed = false
  let unsubscribe: (() => void) | undefined
  let cancelPromise: Promise<void> | undefined

  const state = computed<TranslationViewState>(() => ({
    open: open.value,
    busy: running.value || canceling.value,
    checking: checking.value,
    available: !!capabilities.value?.available && capabilities.value.directions.includes(direction.value),
    reason: !window.fanhua ? '本地翻译需在桌面版运行。' : capabilities.value?.reason || '本地中英翻译暂不可用。',
    direction: direction.value,
    error: error.value,
    notice: notice.value,
    status: canceling.value ? '正在停止翻译…' : status.value,
    completed: completed.value,
    total: total.value,
    results: results.value,
    activeIds: activeIds.value,
  }))

  async function refreshCapabilities() {
    const request = ++capabilityRequest
    checking.value = true
    try {
      const result = window.fanhua?.getTranslationCapabilities
        ? await window.fanhua.getTranslationCapabilities()
        : { available: false, directions: [], reason: '本地翻译需在桌面版运行。' }
      if (request === capabilityRequest && !disposed) capabilities.value = result
    } catch (cause) {
      if (request === capabilityRequest && !disposed) capabilities.value = {
        available: false, directions: [], reason: failureMessage(cause, '无法读取本地翻译模型，请重试。'),
      }
    } finally { if (request === capabilityRequest && !disposed) checking.value = false }
  }

  async function cancel(showNotice = true) {
    generation++
    const request = active
    active = undefined
    activeIds.value = []
    running.value = false
    if (request && showNotice) notice.value = '已取消，已完成的译文已保留。'
    if (!request) return cancelPromise
    canceling.value = true
    cancelPromise = Promise.resolve(window.fanhua?.cancelTranslation(request.requestId))
      .then(() => undefined)
      .catch(() => { if (!disposed) error.value = '停止翻译失败，请稍后重试。' })
      .finally(() => { canceling.value = false; cancelPromise = undefined })
    return cancelPromise
  }

  function reset() {
    void cancel(false)
    results.value = {}
    completed.value = 0
    total.value = 0
    error.value = ''
    notice.value = ''
  }

  function accepts(requestId: string, resultDirection: TranslationDirection) {
    return !disposed && !!active && active.requestId === requestId && active.direction === resultDirection
      && direction.value === resultDirection && active.imageId === imageId()
  }
  function acceptParagraph(paragraph: TranslatedParagraph) {
    if (active?.source.get(paragraph.id) !== paragraph.sourceText) return
    if (paragraphs.value.find(item => item.id === paragraph.id)?.text !== paragraph.sourceText) return
    results.value = { ...results.value, [paragraph.id]: { ...paragraph } }
  }
  function progress(event: TranslationProgress) {
    if (!accepts(event.requestId, event.direction)) return
    completed.value = event.completed
    total.value = event.total
    status.value = event.status === 'loading' ? '正在加载本地翻译模型…' : '正在本机翻译…'
    if (event.paragraph) acceptParagraph(event.paragraph)
  }

  async function translate(id?: string) {
    if (running.value || canceling.value || checking.value || disposed) return
    const token = ++generation
    error.value = ''; notice.value = ''
    if (!capabilities.value?.available) await refreshCapabilities()
    if (token !== generation || disposed || !open.value) return
    if (!state.value.available || !window.fanhua) { error.value = state.value.reason; return }
    const selected = paragraphs.value.filter(item => (!id || item.id === id) && item.text.trim()).map(item => ({ id: item.id, text: item.text }))
    if (!selected.length) return
    const request = { requestId: crypto.randomUUID(), direction: direction.value, paragraphs: selected }
    active = { requestId: request.requestId, direction: request.direction, imageId: imageId(), source: new Map(selected.map(item => [item.id, item.text])) }
    activeIds.value = selected.map(item => item.id)
    const retained = { ...results.value }
    for (const item of selected) delete retained[item.id]
    results.value = retained
    completed.value = 0; total.value = selected.length
    running.value = true; status.value = '正在准备本地翻译…'
    try {
      const result = await window.fanhua.translateParagraphs(request)
      if (!accepts(result.requestId, result.direction)) return
      result.paragraphs.forEach(acceptParagraph)
      completed.value = selected.length
      notice.value = `已完成 ${selected.length} 段翻译。`
    } catch (cause) {
      if (active?.requestId === request.requestId && !disposed) error.value = failureMessage(cause, '翻译失败，请重试。')
    } finally {
      if (active?.requestId === request.requestId) { active = undefined; activeIds.value = []; running.value = false }
    }
  }

  async function setOpen(value: boolean) {
    open.value = value
    if (!value) { await cancel(false); return }
    await refreshCapabilities()
  }
  function changeDirection(value: TranslationDirection) {
    if (value === direction.value) return
    reset()
    direction.value = value
  }
  watch(() => paragraphs.value.map(item => [item.id, item.text]), () => {
    const current = new Map(paragraphs.value.map(item => [item.id, item.text]))
    const retained = Object.fromEntries(Object.entries(results.value).filter(([id, result]) => current.get(id) === result.sourceText))
    if (Object.keys(retained).length !== Object.keys(results.value).length) results.value = retained
    if (active && [...active.source].some(([id, sourceText]) => current.get(id) !== sourceText)) {
      void cancel(false)
      notice.value = '原文已修改，已停止翻译；请重新翻译修改的段落。'
    }
  }, { flush: 'sync' })
  watch(imageId, reset)
  onMounted(() => { unsubscribe = window.fanhua?.onTranslationProgress?.(progress) })
  onBeforeUnmount(() => {
    disposed = true; capabilityRequest++
    void cancel(false)
    unsubscribe?.()
  })
  return { state, setOpen, translate, cancel, reset, changeDirection }
}
