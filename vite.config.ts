import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'chrome132' },
  test: { include: ['tests/unit/**/*.test.ts'] },
})
