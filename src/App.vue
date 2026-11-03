<script setup lang="ts">
import { ConfigProvider as AConfigProvider } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { defineAsyncComponent } from 'vue'

const route = new URLSearchParams(location.search).get('view') || 'settings'
const views = {
  settings: defineAsyncComponent(() => import('./views/SettingsView.vue')),
  capture: defineAsyncComponent(() => import('./views/CaptureView.vue')),
  preview: defineAsyncComponent(() => import('./views/PreviewView.vue')),
}
const view = views[route as keyof typeof views] || views.settings
</script>

<template>
  <AConfigProvider :locale="zhCN" :theme="{ token: { colorPrimary: '#7860d2', colorText: '#2b2933', fontFamily: '&quot;Segoe UI&quot;, &quot;Microsoft YaHei UI&quot;, sans-serif', borderRadius: 9, controlHeight: 36 } }">
    <component :is="view" />
  </AConfigProvider>
</template>
