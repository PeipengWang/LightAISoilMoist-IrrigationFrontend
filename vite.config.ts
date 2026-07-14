import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      '/api/decision-logs': {
        target: 'http://localhost:8086',
        changeOrigin: true,
      },
      '/api/decision': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/api/chat': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/api/memory': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/api/asr': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8086',
        changeOrigin: true,
      },
    },
  },
})