<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button as AButton, InputNumber as AInputNumber, Select as ASelect, Slider as ASlider, Switch as ASwitch, TabPane as ATabPane, Tabs as ATabs } from 'ant-design-vue'
import { Check, FolderOpen, LoaderCircle, RefreshCw, Save, Settings2, Share2, Type, X } from 'lucide-vue-next'
import FlowerLogo from '../components/FlowerLogo.vue'
import type { AppSettings, AppState, EditorPreferences, SettingsPatch } from '../shared'

const api = window.fanhua
const state = ref<AppState>()
const settings = ref<AppSettings>()
const editorDraft = ref<Partial<EditorPreferences>>({})
const activeTab = ref('general')
const loading = ref(true)
const savingKey = ref('')
const error = ref('')
const saved = ref(false)
const fonts = ref<string[]>([])
const fontsLoading = ref(false)
const fontsError = ref('')
const ocrReason = ref('')
const ocrLanguages = ref([{ tag: 'auto', name: '自动（中文 / 英文优先）' }, { tag: 'zh-Hans-CN', name: '简体中文 + 英文' }, { tag: 'en-US', name: '英语' }])
const localSendPath = ref<string | null>(null)
const localSendError = ref('')
const localSendReadFailed = ref(false)
const busy = computed(() => loading.value || !!savingKey.value || !api)
const fontOptions = computed(() => [...new Set([...(settings.value ? [settings.value.editor.font] : []), ...fonts.value])].map(value => ({ value, label: value })))
const languageOptions = computed(() => {
  const values = ocrLanguages.value.map(item => ({ value: item.tag, label: item.name }))
  if (settings.value && !values.some(item => item.value === settings.value!.ocrLanguage)) values.push({ value: settings.value.ocrLanguage, label: `${settings.value.ocrLanguage}（当前不可用）` })
  return values
})
const lossy = computed(() => settings.value?.imageFormat === 'jpeg' || settings.value?.imageFormat === 'webp')
const formatOptions = [{ value: 'png', label: 'PNG · 无损图片' }, { value: 'jpeg', label: 'JPEG · 照片图片' }, { value: 'webp', label: 'WebP · 轻量图片' }, { value: 'bmp', label: 'BMP · 位图图片' }, { value: 'pdf', label: 'PDF · 文档' }]
const markerOptions = [{ value: 'number', label: '1、2、3 · 阿拉伯数字' }, { value: 'letter', label: 'A、B、C · 字母' }, { value: 'chinese', label: '壹、贰、叁 · 中文大写' }]
const borderOptions = [{ value: 'solid', label: '实线' }, { value: 'dashed', label: '虚线' }, { value: 'dotted', label: '点线' }]
const filterFonts = (input: string, option?: { value?: unknown }) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())
let disposed = false
let loadRequest = 0
let stateRequest = 0
let unsubscribe: (() => void) | undefined

function reason(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : fallback
}
function accept(value: AppSettings) {
  settings.value = { ...value, editor: { ...value.editor } }
}
watch(() => settings.value?.editor, value => { if (value) editorDraft.value = { ...value } }, { immediate: true })

async function refreshState() {
  if (!api) return
  const request = ++stateRequest
  try {
    const value = await api.getAppState()
    if (!disposed && request === stateRequest) state.value = value
  } catch (cause) { if (!disposed && request === stateRequest) error.value = reason(cause, '无法读取应用状态，请重试') }
}
async function refreshFonts(refresh = false) {
  if (!api || fontsLoading.value) return
  fontsLoading.value = true; fontsError.value = ''
  try {
    const value = await api.getFonts(refresh)
    if (!disposed) fonts.value = [...new Set(value)].sort((a, b) => a.localeCompare(b))
  } catch (cause) { if (!disposed) fontsError.value = reason(cause, '系统字体读取失败，可以重试') }
  finally { if (!disposed) fontsLoading.value = false }
}
async function refreshOcr() {
  if (!api) return
  try {
    const result = await api.getOcrCapabilities()
    if (disposed) return
    if (result.languages.length) ocrLanguages.value = result.languages
    ocrReason.value = result.available ? '' : result.reason || '本地文字识别暂不可用'
  } catch (cause) { if (!disposed) ocrReason.value = reason(cause, '暂时无法读取识别语言') }
}
async function refreshLocalSend() {
  if (!api) return
  try {
    const result = await api.getLocalSendSettings()
    if (!disposed) { localSendPath.value = result.executable; localSendError.value = ''; localSendReadFailed.value = false }
  } catch (cause) { if (!disposed) { localSendReadFailed.value = true; localSendError.value = reason(cause, '无法读取 LocalSend 路径') } }
}
async function load() {
  if (!api) { loading.value = false; error.value = '请在 Windows 桌面版中打开设置。'; return }
  const request = ++loadRequest
  loading.value = true; error.value = ''
  void refreshFonts(); void refreshOcr(); void refreshLocalSend()
  try {
    const [preferences, appState] = await Promise.all([api.getSettings(), api.getAppState()])
    if (disposed || request !== loadRequest) return
    accept(preferences); state.value = appState
    if (appState.settingsError) error.value = appState.settingsError
  } catch (cause) { if (!disposed && request === loadRequest) error.value = reason(cause, '设置读取失败，请重试') }
  finally { if (!disposed && request === loadRequest) loading.value = false }
}

async function update(patch: SettingsPatch, key: string) {
  if (!api || !settings.value || busy.value) return
  const previous = settings.value
  savingKey.value = key; error.value = ''; saved.value = false
  accept({ ...previous, ...patch, editor: { ...previous.editor, ...patch.editor } })
  try {
    const result = await api.updateSettings(patch)
    if (!disposed) { accept(result); saved.value = true }
  } catch (cause) {
    if (!disposed) {
      // Read back the committed preferences if a system operation rejected the
      // change; this also preserves any newer changes received from the tray.
      try { accept(await api.getSettings()) } catch { accept(previous) }
      error.value = reason(cause, '保存失败，已恢复原设置')
    }
  } finally {
    if (!disposed) { savingKey.value = ''; void refreshState() }
  }
}
function updateEditor<K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) {
  if (settings.value?.editor[key] === value) return
  void update({ editor: { [key]: value } }, `editor.${key}`)
}
function commitNumber(key: keyof EditorPreferences) {
  const value = editorDraft.value[key]
  if (typeof value === 'number' && Number.isFinite(value)) updateEditor(key, Math.round(value))
  else if (settings.value) editorDraft.value = { ...settings.value.editor }
}
async function setLogin(value: boolean | string | number) {
  if (!api || !state.value || busy.value) return
  savingKey.value = 'login'; error.value = ''; saved.value = false
  ++stateRequest
  try {
    const enabled = await api.setLaunchAtLogin(Boolean(value))
    if (!disposed && state.value) { state.value.launchAtLogin = enabled; saved.value = true }
  } catch (cause) { if (!disposed) error.value = reason(cause, '开机启动设置失败，已保留原设置') }
  finally { if (!disposed) { savingKey.value = ''; void refreshState() } }
}
async function retryShortcut() {
  if (!api || busy.value) return
  savingKey.value = 'shortcut'; error.value = ''
  try {
    const value = await api.retryShortcut()
    if (!disposed) state.value = value
  } catch (cause) { if (!disposed) error.value = reason(cause, '快捷键注册失败，请重试') }
  finally { if (!disposed) savingKey.value = '' }
}
async function changeLocalSend(reset = false) {
  if (!api || busy.value) return
  savingKey.value = 'localsend'; localSendError.value = ''; saved.value = false
  try {
    const result = reset ? await api.resetLocalSendExecutable() : await api.chooseLocalSendExecutable()
    if (!disposed && result) { localSendPath.value = result.executable; localSendReadFailed.value = false; saved.value = true }
  } catch (cause) {
    if (!disposed) {
      const failure = reason(cause, 'LocalSend 路径设置失败，已保留原设置')
      await refreshLocalSend(); localSendError.value = failure
    }
  } finally { if (!disposed) savingKey.value = '' }
}
async function hide() {
  if (savingKey.value) return
  try { await api?.closeWindow() }
  catch (cause) { error.value = reason(cause, '关闭设置窗口失败，请重试') }
}
onMounted(() => {
  unsubscribe = api?.onSettingsChanged(value => { if (!disposed) accept(value) })
  void load()
  window.addEventListener('focus', refreshState)
})
onBeforeUnmount(() => { disposed = true; loadRequest++; stateRequest++; unsubscribe?.(); window.removeEventListener('focus', refreshState) })
</script>

<template>
  <div class="settings-window" data-testid="settings-window">
    <header class="titlebar drag-region">
      <div class="app-title"><FlowerLogo :size="22" /><h1>繁花有图 <span>设置</span></h1><small v-if="state">{{ state.version }}</small></div>
      <button type="button" class="icon-button danger no-drag" aria-label="关闭设置" title="关闭设置，继续在系统托盘运行" :disabled="!!savingKey" @click="hide"><X :size="17" /></button>
    </header>
    <div v-if="error" class="error-banner" role="alert"><span>{{ error }}</span><button type="button" aria-label="关闭错误提示" @click="error = ''"><X :size="14" /></button></div>
    <div v-if="!settings" class="load-state"><LoaderCircle v-if="loading" :size="22" class="spinning" /><p>{{ loading ? '正在读取设置…' : '设置暂不可用' }}</p><AButton v-if="api && !loading" size="small" @click="load">重新读取设置</AButton></div>
    <ATabs v-else v-model:active-key="activeTab" class="settings-tabs" size="small" :animated="false">
      <ATabPane key="general">
        <template #tab><span class="tab-title"><Settings2 :size="14" />常规</span></template>
        <div class="tab-content">
          <div class="setting-row">
            <div><label>开机时自动启动</label><p>{{ state?.isPackaged ? '登录 Windows 后驻留托盘，不打开窗口。' : '安装后的 Windows 版本可启用此设置。' }}</p><p v-if="state?.launchAtLoginReason" class="inline-warning">{{ state.launchAtLoginReason }}</p></div>
            <ASwitch aria-label="开机时自动启动" :checked="state?.launchAtLogin || false" :disabled="busy || !state?.isPackaged || state.platform !== 'win32'" :loading="savingKey === 'login'" @change="setLogin" />
          </div>
          <div class="setting-row">
            <div><label>启动时显示通知</label><p>提醒你截图工具已在后台准备就绪。</p></div>
            <ASwitch aria-label="启动时显示通知" :checked="settings.startupNotification" :disabled="busy" :loading="savingKey === 'startupNotification'" @change="value => update({ startupNotification: Boolean(value) }, 'startupNotification')" />
          </div>
          <details class="notification-preview"><summary>查看通知内容</summary><div><strong>繁花有图</strong><p>Hello，现在繁花有图已经在你的设备中完成了准备，随时可以通过Alt + A 发起截图。在不需要我的时候，我会一直休眠哦~</p></div></details>
          <div class="setting-row">
            <div><label>图片和 PDF 右键入口</label><p>在资源管理器中显示“使用繁花有图编辑”。</p><p v-if="state?.contextMenu.available">已注册 {{ state.contextMenu.registered }} / {{ state.contextMenu.total }} 种文件格式</p><p v-if="state?.contextMenu.reason" class="muted">{{ state.contextMenu.reason }}</p></div>
            <ASwitch aria-label="启用资源管理器右键菜单" :checked="savingKey === 'contextMenuEnabled' ? settings.contextMenuEnabled : state?.contextMenu.enabled || false" :disabled="busy || !state?.contextMenu.available" :loading="savingKey === 'contextMenuEnabled'" @change="value => update({ contextMenuEnabled: Boolean(value) }, 'contextMenuEnabled')" />
          </div>
          <AButton v-if="state?.contextMenu.available && state.contextMenu.registered > 0 && !state.contextMenu.enabled && !state.contextMenu.legacyMachine && !state.contextMenu.conflict" size="small" :disabled="busy" aria-label="清理残留右键菜单" @click="update({ contextMenuEnabled: false }, 'contextMenuEnabled')">关闭残留右键入口</AButton>
          <p v-if="state?.contextMenu.conflict" class="inline-warning">检测到同名右键菜单冲突，请先处理其他安装版本的菜单。</p>
          <p v-if="state?.contextMenu.legacyMachine" class="inline-note">检测到旧版为所有用户安装的右键菜单，请通过对应范围的新版本安装程序清理旧注册。</p>
          <div class="setting-row">
            <div><label>截图后直接进入编辑</label><p>关闭时先预览，再按需添加标注。</p></div>
            <ASwitch aria-label="截图后直接进入编辑" :checked="settings.captureOpenEditor" :disabled="busy" :loading="savingKey === 'captureOpenEditor'" @change="value => update({ captureOpenEditor: Boolean(value) }, 'captureOpenEditor')" />
          </div>
          <div class="setting-row shortcut-row">
            <div><label>截图快捷键</label><p :class="{ 'inline-warning': state && !state.shortcutRegistered }">{{ state?.shortcutRegistered ? '快捷键已就绪。' : 'Alt + A 暂时无法启用，请解除冲突后重试。' }}</p></div>
            <div class="shortcut-control"><span class="key-combination" aria-label="Alt 加 A"><kbd>Alt</kbd><span>+</span><kbd>A</kbd></span><AButton v-if="state && !state.shortcutRegistered" size="small" :disabled="busy" :loading="savingKey === 'shortcut'" aria-label="重试注册截图快捷键" @click="retryShortcut">重试注册</AButton></div>
          </div>
          <p class="page-note">截图和打开文件都从系统托盘进入；双击托盘图标可打开设置。</p>
        </div>
      </ATabPane>
      <ATabPane key="editor">
        <template #tab><span class="tab-title"><Type :size="14" />编辑默认</span></template>
        <div class="tab-content">
          <p class="page-note first-note">这些默认值用于之后新打开的图片和 PDF 窗口，不改变现有窗口或标注。编辑时仍可逐图调整。</p>
          <h2>文字与说明</h2>
          <label class="field full-width"><span class="field-heading">字体 <small>{{ fontsLoading ? '读取中…' : `${fonts.length} 种系统字体` }}</small><button type="button" class="font-refresh" aria-label="刷新系统字体" :disabled="busy || fontsLoading" @click="refreshFonts(true)"><RefreshCw :size="13" :class="{ spinning: fontsLoading }" /></button></span>
            <ASelect :value="settings.editor.font" show-search aria-label="默认标注字体" :options="fontOptions" :filter-option="filterFonts" :loading="fontsLoading" :disabled="busy" @change="value => updateEditor('font', String(value))"><template #option="{ value }"><span :style="{ fontFamily: String(value) }">{{ value }}</span></template></ASelect>
          </label>
          <p v-if="fontsError" class="inline-warning">{{ fontsError }}</p>
          <div class="setting-grid">
            <label class="field"><span>字号</span><AInputNumber v-model:value="editorDraft.size" aria-label="默认标注字号" :min="8" :max="200" :precision="0" addon-after="px" :disabled="busy" @blur="commitNumber('size')" @press-enter="commitNumber('size')" /></label>
            <label class="field"><span>颜色</span><div class="color-field"><input type="color" aria-label="默认标注颜色" :value="settings.editor.color" :disabled="busy" @change="updateEditor('color', ($event.target as HTMLInputElement).value)" /><span>{{ settings.editor.color.toUpperCase() }}</span></div></label>
          </div>
          <h2>顺序标识</h2>
          <div class="setting-grid">
            <label class="field"><span>序号方式</span><ASelect aria-label="默认序号方式" :value="settings.editor.markerStyle" :options="markerOptions" :disabled="busy" @change="value => updateEditor('markerStyle', value as EditorPreferences['markerStyle'])" /></label>
            <label class="field"><span>序号头大小</span><AInputNumber v-model:value="editorDraft.markerHeadSize" aria-label="默认序号头大小" :min="16" :max="240" :precision="0" addon-after="px" :disabled="busy" @blur="commitNumber('markerHeadSize')" @press-enter="commitNumber('markerHeadSize')" /></label>
          </div>
          <h2>箭头</h2>
          <div class="setting-grid">
            <label class="field"><span>线宽</span><AInputNumber v-model:value="editorDraft.arrowLineWidth" aria-label="默认箭头线宽" :min="1" :max="40" :precision="0" addon-after="px" :disabled="busy" @blur="commitNumber('arrowLineWidth')" @press-enter="commitNumber('arrowLineWidth')" /></label>
            <label class="field"><span>箭头头大小</span><AInputNumber v-model:value="editorDraft.arrowHeadSize" aria-label="默认箭头头大小" :min="6" :max="160" :precision="0" addon-after="px" :disabled="busy" @blur="commitNumber('arrowHeadSize')" @press-enter="commitNumber('arrowHeadSize')" /></label>
          </div>
          <h2>方框与圆形</h2>
          <div class="setting-grid">
            <label class="field"><span>边框类型</span><ASelect aria-label="默认边框类型" :value="settings.editor.shapeBorderStyle" :options="borderOptions" :disabled="busy" @change="value => updateEditor('shapeBorderStyle', value as EditorPreferences['shapeBorderStyle'])" /></label>
            <label class="field"><span>边框粗细</span><AInputNumber v-model:value="editorDraft.shapeLineWidth" aria-label="默认边框粗细" :min="1" :max="40" :precision="0" addon-after="px" :disabled="busy" @blur="commitNumber('shapeLineWidth')" @press-enter="commitNumber('shapeLineWidth')" /></label>
          </div>
          <h2>马赛克</h2>
          <label class="field"><span class="field-heading">打码强度 <small>{{ settings.editor.mosaicStrength }} px</small></span><ASlider :value="settings.editor.mosaicStrength" :min="4" :max="64" :step="2" :disabled="busy" aria-label-for-handle="默认打码强度" @after-change="value => updateEditor('mosaicStrength', Number(value))" /></label>
        </div>
      </ATabPane>
      <ATabPane key="output">
        <template #tab><span class="tab-title"><Save :size="14" />保存与识别</span></template>
        <div class="tab-content">
          <p class="page-note first-note">用于之后新打开的图片和 PDF 窗口，现有窗口及正在进行的识别不受影响。</p>
          <h2>保存默认值</h2>
          <label class="field"><span>截图和图片的保存格式</span><ASelect aria-label="默认保存格式" :value="settings.imageFormat" :options="formatOptions" :disabled="busy" @change="value => update({ imageFormat: value as AppSettings['imageFormat'] }, 'imageFormat')" /></label>
          <label class="field"><span class="field-heading">JPEG / WebP 质量 <small>{{ settings.imageQuality }}%</small></span><ASlider :value="settings.imageQuality" :min="10" :max="100" :disabled="busy || !lossy" aria-label-for-handle="默认图片质量" @after-change="value => update({ imageQuality: Number(value) }, 'imageQuality')" /></label>
          <p class="inline-note">质量用于 JPEG 和 WebP；PNG 无损保存。DeskFlow 复制固定使用 JPG 60%。</p>
          <label class="field"><span>PDF 默认保存范围</span><ASelect aria-label="默认PDF保存范围" :value="settings.pdfScope" :options="[{ value: 'all', label: '全部页面' }, { value: 'current', label: '当前页' }]" :disabled="busy" @change="value => update({ pdfScope: value as AppSettings['pdfScope'] }, 'pdfScope')" /></label>
          <p class="inline-note">打开 PDF 原稿时默认保存为 PDF；图片格式仅保存当前页。保存前仍可更改格式和范围。</p>
          <h2>文字识别与翻译</h2>
          <label class="field"><span>识别语言</span><ASelect aria-label="默认OCR语言" :value="settings.ocrLanguage" :options="languageOptions" :disabled="busy" @change="value => update({ ocrLanguage: String(value) }, 'ocrLanguage')" /></label>
          <p v-if="ocrReason" class="inline-warning">{{ ocrReason }}</p>
          <label class="field"><span>翻译方向</span><ASelect aria-label="默认翻译方向" :value="settings.translationDirection" :options="[{ value: 'en-zh', label: '英文 → 中文' }, { value: 'zh-en', label: '中文 → 英文' }]" :disabled="busy" @change="value => update({ translationDirection: value as AppSettings['translationDirection'] }, 'translationDirection')" /></label>
          <p class="page-note">识别和翻译在本机完成。图片中的识别框和译文仅用于预览，不写入保存文件。</p>
        </div>
      </ATabPane>
      <ATabPane key="sharing">
        <template #tab><span class="tab-title"><Share2 :size="14" />共享</span></template>
        <div class="tab-content">
          <h2>LocalSend</h2>
          <p class="page-note">将编辑后的图片交给 LocalSend，再选择接收设备。</p>
          <label class="field"><span>程序位置</span><div class="program-path" data-testid="localsend-executable" :title="localSendReadFailed ? '位置读取失败' : localSendPath || '自动查找 LocalSend'">{{ localSendReadFailed ? '位置读取失败' : localSendPath || '自动查找 LocalSend' }}</div></label>
          <div class="path-actions"><AButton :disabled="busy" :loading="savingKey === 'localsend'" aria-label="选择LocalSend程序" @click="changeLocalSend()"><template #icon><FolderOpen :size="14" /></template>选择程序</AButton><AButton :disabled="busy || (!localSendPath && !localSendError)" aria-label="恢复自动查找LocalSend" @click="changeLocalSend(true)">恢复自动查找</AButton></div>
          <p v-if="localSendError" class="inline-warning" role="alert">{{ localSendError }}</p>
          <p class="inline-note">自动查找适合常规安装；使用便携版时，可选择 LocalSend.exe。取消文件选择不会改变已有路径。</p>
          <h2>图片复制</h2>
          <dl class="copy-notes"><div><dt>复制到剪贴板</dt><dd>PNG，保留编辑后的画质与透明背景。</dd></div><div><dt>复制到 DeskFlow 剪贴板</dt><dd>JPG · 60%。由于DeskFlow传输有限制，会造成质量压缩。</dd></div></dl>
        </div>
      </ATabPane>
    </ATabs>
    <footer class="settings-footer"><span class="save-status" role="status"><LoaderCircle v-if="savingKey" :size="13" class="spinning" /><Check v-else-if="saved && !error" :size="13" />{{ savingKey ? '正在保存…' : error ? '请检查上方提示' : saved ? '已保存' : '更改会自动保存' }}</span><span class="tray-note">关闭后继续在托盘运行</span><AButton size="small" aria-label="完成设置并关闭" :disabled="!!savingKey" @click="hide">关闭设置</AButton></footer>
  </div>
</template>

<style scoped>
.settings-window{display:flex;flex-direction:column;width:100%;height:100%;background:#faf9fc;color:#41394a;font-size:12px}.titlebar{display:flex;align-items:center;justify-content:space-between;min-height:45px;flex-shrink:0;padding:0 10px 0 16px;background:#fff;border-bottom:1px solid #e8e3ee}.app-title{display:flex;align-items:center;gap:8px}.app-title h1{margin:0;font-size:13px;font-weight:600}.app-title h1 span{margin-left:8px;color:#83738e;font-weight:400}.app-title small{margin-left:2px;color:#a296ac;font-size:10px}.titlebar .icon-button{width:29px;height:28px;border-radius:4px}.settings-tabs{flex:1;min-height:0}.settings-tabs :deep(.ant-tabs-nav){flex-shrink:0;margin:0;padding:0 20px;background:#fff}.settings-tabs :deep(.ant-tabs-tab){padding:12px 0;font-size:12px}.settings-tabs :deep(.ant-tabs-tab + .ant-tabs-tab){margin-left:25px}.settings-tabs :deep(.ant-tabs-content-holder){overflow:auto;min-height:0}.tab-title{display:inline-flex;align-items:center;gap:6px}.tab-content{padding:7px 22px 20px}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:70px;padding:14px 0;border-bottom:1px solid #ece7f0}.setting-row>div:first-child{min-width:0}.setting-row label{font-size:12px;font-weight:500}.setting-row p{margin:5px 0 0;color:#8b7f94;font-size:11px;line-height:1.6}.setting-row :deep(.ant-switch){flex-shrink:0}.tab-content h2{margin:20px 0 11px;font-size:12px;font-weight:600;color:#665075}.tab-content h2:first-child{margin-top:14px}.page-note,.inline-note{color:#8b7f94;font-size:11px;line-height:1.7;margin:11px 0}.first-note{margin:6px 0 15px}.inline-warning,.setting-row p.inline-warning{color:#a66c2e;font-size:11px;line-height:1.7;margin:8px 0}.notification-preview{margin:9px 0 2px;color:#8b7a99;font-size:11px}.notification-preview summary{cursor:pointer;width:fit-content}.notification-preview>div{padding:8px 10px;margin-top:7px;background:#f2eef7;border-left:2px solid #c8b7dc;line-height:1.7}.notification-preview strong{font-size:11px;font-weight:500}.notification-preview p{margin:4px 0 0;color:#817289}.shortcut-control{display:flex;align-items:center;gap:12px;flex-shrink:0}.key-combination{display:flex;align-items:center;gap:6px;color:#9a8aa7;font-size:11px}.key-combination kbd{font-size:11px;height:27px;min-width:29px;padding:0 5px;border-radius:4px}.field{display:flex;flex-direction:column;gap:7px;min-width:0;margin-bottom:13px;color:#75677e;font-size:11px}.field>span{line-height:1.5}.field :deep(.ant-select),.field :deep(.ant-input-number-group-wrapper),.field :deep(.ant-input-number){width:100%;font-size:12px}.field :deep(.ant-select-selector),.field :deep(.ant-input-number),.field :deep(.ant-input-number-group-addon){border-radius:4px!important}.field :deep(.ant-select-selector){height:31px!important;min-height:31px}.field :deep(.ant-select-selection-item),.field :deep(.ant-select-selection-placeholder){line-height:29px!important}.field :deep(.ant-input-number-input){height:29px}.field :deep(.ant-input-number-group-addon){font-size:11px;color:#9a8ca5;padding:0 8px}.field :deep(.ant-slider){margin:4px 6px 2px}.setting-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 16px}.field-heading{display:flex;align-items:center;gap:7px}.field-heading small{color:#a093aa;font-size:10px;font-weight:400}.font-refresh{display:flex;align-items:center;justify-content:center;width:22px;height:19px;margin-left:auto;padding:0;background:none;border:0;border-radius:3px;color:#8b729f;cursor:pointer}.font-refresh:disabled{opacity:.45;cursor:default}.font-refresh:hover:not(:disabled){background:#eee6f5}.color-field{height:31px;display:flex;align-items:center;gap:10px;padding:3px 8px;border:1px solid #d9d2e1;border-radius:4px;background:#fff;font-size:11px}.color-field input{width:31px;height:23px;padding:0;border:0;background:transparent;cursor:pointer}.color-field input:disabled{cursor:default;opacity:.5}.color-field span{color:#8b7a95}.program-path{padding:11px 12px;border:1px solid #e0d8e8;border-radius:4px;background:#fff;min-height:41px;line-height:1.7;overflow-wrap:anywhere;color:#74647f;font:11px/1.7 'Segoe UI','Microsoft YaHei UI',sans-serif}.path-actions{display:flex;flex-wrap:wrap;gap:8px}.path-actions :deep(.ant-btn){display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 11px;border-radius:4px;font-size:11px;box-shadow:none}.path-actions :deep(.ant-btn-icon){display:flex;margin:0}.copy-notes{margin:0;font-size:11px;line-height:1.7}.copy-notes>div{padding:9px 0;border-bottom:1px solid #eee8f2}.copy-notes dt{font-weight:500;color:#7b678a}.copy-notes dd{margin:3px 0 0;color:#9a8aa5}.settings-footer{display:flex;align-items:center;gap:12px;flex-shrink:0;min-height:48px;padding:9px 16px;border-top:1px solid #e7e0ed;background:#f5f1f8;color:#9a8ba5;font-size:10px}.save-status{display:flex;align-items:center;gap:5px;color:#8a7799}.tray-note{margin-left:auto}.settings-footer :deep(.ant-btn){height:28px;font-size:11px;border-radius:4px;box-shadow:none}.error-banner{display:flex;align-items:flex-start;gap:12px;padding:9px 16px;background:#fff0ed;color:#a75555;font-size:11px;line-height:1.6;flex-shrink:0}.error-banner span{flex:1;min-width:0;overflow-wrap:anywhere}.error-banner button{display:flex;padding:2px;border:0;background:none;color:inherit;cursor:pointer}.load-state{display:flex;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:5px;color:#9a8aa6;font-size:12px}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:480px){.tab-content{padding:6px 15px 16px}.settings-tabs :deep(.ant-tabs-nav){padding:0 14px}.settings-tabs :deep(.ant-tabs-tab + .ant-tabs-tab){margin-left:17px}.tab-title{gap:4px}.tab-title svg{display:none}.setting-row{gap:12px}.shortcut-control{gap:6px;flex-direction:column;align-items:flex-end}.tray-note{display:none}.settings-footer .save-status{margin-right:auto}.setting-grid{gap:0 10px}.settings-footer{padding:9px 14px}.app-title small{display:none}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}
</style>
