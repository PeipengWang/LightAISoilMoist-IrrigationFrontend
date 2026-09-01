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
        target: 'http://127.0.0.1:8086',
        changeOrigin: true,
      },
      '/api/decision': {
        target: 'http://154.8.237.182:8001',
        changeOrigin: true,
      },
      '/api/chat': {
        target: 'http://154.8.237.182:8001',
        changeOrigin: true,
      },
      '/api/memory': {
        target: 'http://154.8.237.182:8001',
        changeOrigin: true,
      },
      // 语音链路统一经 YYA 网关转发，由网关再访问 ASR/TTS 服务
      '/api/asr': {
        target: 'http://154.8.237.182:8001',
        changeOrigin: true,
      },
      '/api/tts-stream': {
        target: 'http://154.8.237.182:8001',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:8086',
        changeOrigin: true,
      },
    },
  },
})