import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  // PDF.js is lazy-loaded and uses the matching, unbundled offline worker.
  optimizeDeps: { exclude: ['pdfjs-dist'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/release/**', '**/public/pdf-assets/**'] } },
  build: { target: 'chrome132' },
})
