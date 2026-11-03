<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Button as AButton, Switch as ASwitch, message } from 'ant-design-vue'
import { ChevronDown, ImagePlus, Keyboard, LogOut, ScanLine, X } from 'lucide-vue-next'
import FlowerLogo from '../components/FlowerLogo.vue'
import type { AppState } from '../shared'

const state = ref<AppState | null>(null)
const captureBusy = ref(false)
const loginBusy = ref(false)
const connectionError = ref('')
const native = Boolean(window.fanhua)
let disposed = false
let stateRequest = 0

const shortcutState = computed(() => {
  if (!native) return '网页演示'
  if (connectionError.value) return '后台连接失败'
  if (!state.value) return '正在连接后台'
  return state.value.shortcutRegistered ? '快捷键可用' : '快捷键被占用'
})
const shortcutWarning = computed(() => native && state.value && !state.value.shortcutRegistered)

async function refreshState() {
  if (!window.fanhua) return
  const request = ++stateRequest
  try {
    const next = await window.fanhua.getAppState()
    if (disposed || request !== stateRequest) return
    state.value = next
    connectionError.value = ''
  } catch {
    if (!disposed && request === stateRequest) connectionError.value = '无法连接后台，请重新启动繁花有图。'
  }
}

async function startCapture() {
  if (captureBusy.value) return
  captureBusy.value = true
  try {
    if (window.fanhua) await window.fanhua.startCapture()
    else location.search = '?view=capture'
  } catch (error) {
    message.error(error instanceof Error ? error.message : '暂时无法截图，请重试')
  } finally {
    captureBusy.value = false
  }
}

async function openImage() {
  try {
    if (window.fanhua) await window.fanhua.openImage()
    else {
      sessionStorage.removeItem('fanhua:demo-screenshot')
      location.search = '?view=preview'
    }
  } catch {
    message.error('图片打开失败，请选择 PNG、JPEG 或 WebP 图片')
  }
}

async function setLogin(value: boolean | string | number) {
  if (!window.fanhua) return
  loginBusy.value = true
  try {
    const enabled = await window.fanhua.setLaunchAtLogin(Boolean(value))
    if (state.value) state.value.launchAtLogin = enabled
  } catch (error) {
    // Keep the previous switch value when development mode or the OS rejects it.
    message.error(error instanceof Error ? error.message : '无法修改开机启动设置')
  } finally {
    loginBusy.value = false
  }
}

async function hideWindow() {
  if (!window.fanhua) {
    message.info('桌面版可收起到系统托盘')
    return
  }
  try { await window.fanhua.hideWindow() }
  catch { message.error('收起窗口失败，请重试') }
}

async function quitApp() {
  try { await window.fanhua?.quitApp() }
  catch { message.error('退出程序失败，请重试') }
}

onMounted(() => {
  void refreshState()
  window.addEventListener('focus', refreshState)
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('focus', refreshState)
})
</script>

<template>
  <div class="utility-window">
    <header class="titlebar drag-region">
      <div class="app-title">
        <FlowerLogo :size="24" />
        <h1>繁花有图</h1>
        <span class="version">{{ state?.version || '1.1.0' }}</span>
      </div>
      <button class="icon-button danger no-drag" aria-label="隐藏到系统托盘" title="关闭设置，继续在后台运行" @click="hideWindow">
        <X :size="17" />
      </button>
    </header>

    <main class="settings-body">
      <section aria-label="截图快捷键">
        <div class="shortcut-row">
          <div>
            <h2>截图快捷键</h2>
            <div :class="['shortcut-status', { warning: shortcutWarning || connectionError, ready: state?.shortcutRegistered }]" role="status">
              <span class="status-dot"></span>{{ shortcutState }}
            </div>
          </div>
          <div class="key-combination" aria-label="Alt 加 A"><kbd>Alt</kbd><span>+</span><kbd>A</kbd></div>
        </div>
        <p v-if="shortcutWarning" class="inline-warning">Alt + A 已被其他应用占用。解除冲突后，右键托盘图标重试；也可点击下方按钮截图。</p>
        <p v-if="connectionError" class="inline-warning">{{ connectionError }}</p>
        <div class="capture-actions">
          <AButton type="primary" :loading="captureBusy" @click="startCapture"><template #icon><ScanLine :size="17" /></template>开始截图</AButton>
          <AButton @click="openImage"><template #icon><ImagePlus :size="17" /></template>{{ native ? '打开图片' : '打开演示图片' }}</AButton>
        </div>
      </section>

      <section class="startup-setting" aria-label="启动设置">
        <div>
          <label id="launch-label">开机时自动启动</label>
          <p>启动后驻留系统托盘，不打开窗口。</p>
        </div>
        <ASwitch aria-labelledby="launch-label" aria-label="开机时自动启动" :checked="state?.launchAtLogin || false" :loading="loginBusy" :disabled="!native || !state || state.platform !== 'win32'" @change="setLogin" />
      </section>

      <details class="operation-help">
        <summary><Keyboard :size="16" /><span>快捷键与操作</span><ChevronDown class="disclosure-icon" :size="14" /></summary>
        <dl>
          <div><dt>截取窗口 / 区域</dt><dd>单击窗口 / 按住鼠标拖动</dd></div>
          <div><dt>取消截图</dt><dd><kbd>Esc</kbd> 或鼠标右键</dd></div>
          <div><dt>保存 / 复制</dt><dd><kbd>Ctrl S</kbd> / <kbd>Ctrl C</kbd></dd></div>
          <div><dt>撤销 / 重做</dt><dd><kbd>Ctrl Z</kbd> / <kbd>Ctrl Y</kbd></dd></div>
          <div><dt>删除标注</dt><dd>选中后按 <kbd>Delete</kbd></dd></div>
        </dl>
      </details>
      <p class="background-note">关闭此窗口后仍可截图。双击托盘图标可再次打开设置。</p>
    </main>

    <footer class="window-footer">
      <button class="exit-button" :disabled="!native" @click="quitApp"><LogOut :size="14" />退出程序</button>
      <AButton class="tray-button" @click="hideWindow">收起到托盘</AButton>
    </footer>
  </div>
</template>

<style scoped>
.utility-window {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #fafafa;
  color: #303039;
}

.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 47px;
  padding: 0 10px 0 16px;
  background: #fff;
  border-bottom: 1px solid #e9e8ed;
}

.app-title {
  display: flex;
  align-items: center;
  gap: 9px;
}

h1 { margin: 0; font-size: 13px; font-weight: 600; }
.version { margin-left: 2px; color: #95919d; font-size: 10px; }
.titlebar .icon-button { width: 30px; height: 28px; border-radius: 5px; }

.settings-body {
  flex: 1;
  min-height: 0;
  padding: 24px 24px 14px;
  overflow-y: auto;
}

.shortcut-row,
.startup-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

h2 { margin: 0 0 9px; font-size: 14px; font-weight: 600; }

.shortcut-status {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #77737e;
  font-size: 11px;
}

.status-dot { width: 5px; height: 5px; border-radius: 50%; background: #a7a1b1; }
.ready .status-dot { background: #4e9b74; }
.warning { color: #9b6c2c; }
.warning .status-dot { background: #c28b39; }

.key-combination { display: flex; align-items: center; gap: 8px; color: #9b96a2; font-size: 12px; }
.key-combination kbd { min-width: 38px; height: 34px; border-radius: 6px; font-size: 14px; color: #514b5c; }

.capture-actions { display: flex; gap: 10px; margin-top: 19px; }
.capture-actions :deep(.ant-btn) { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 37px; font-size: 12px; box-shadow: none; }
.capture-actions :deep(.ant-btn-icon) { display: flex; margin: 0; }
.inline-warning { margin: 12px 0 0; padding: 9px 10px; border-radius: 5px; background: #fff4e3; color: #8e692f; font-size: 11px; line-height: 1.7; }

.startup-setting { margin-top: 23px; padding: 20px 0; border-top: 1px solid #e9e7ed; border-bottom: 1px solid #e9e7ed; }
.startup-setting label { font-size: 12px; font-weight: 500; }
.startup-setting p { margin: 6px 0 0; color: #85808e; font-size: 11px; }

.operation-help { margin-top: 15px; font-size: 11px; }
.operation-help summary { display: flex; align-items: center; gap: 7px; padding: 5px 0; color: #77717f; list-style: none; cursor: pointer; }
.operation-help summary::-webkit-details-marker { display: none; }
.operation-help summary:hover { color: #574572; }
.disclosure-icon { margin-left: auto; transition: transform .15s; }
.operation-help[open] .disclosure-icon { transform: rotate(180deg); }
.operation-help dl { margin: 11px 0 2px; color: #6d6676; }
.operation-help dl>div { display: flex; align-items: center; justify-content: space-between; min-height: 29px; gap: 15px; }
.operation-help dt { font-weight: 400; }
.operation-help dd { margin: 0; color: #837b8e; }
.operation-help kbd { min-width: 0; padding: 1px 4px; font-size: 10px; border-width: 1px; }
.background-note { margin: 13px 0 0; color: #8b8593; font-size: 10px; line-height: 1.7; }

.window-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 59px; padding: 10px 24px; border-top: 1px solid #e9e7ed; background: #f5f4f7; }
.exit-button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 0; color: #807887; background: none; border: 0; font-size: 11px; }
.exit-button:hover:not(:disabled) { color: #b64e59; }
.exit-button:disabled { color: #b5afbd; }
.tray-button { height: 32px; font-size: 11px; box-shadow: none; }

@media (max-width: 500px) {
  .settings-body { padding: 20px 20px 12px; }
  .window-footer { padding: 10px 20px; }
  .startup-setting { margin-top: 19px; padding: 17px 0; }
}
</style>
