import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 개발 중에는 /api 요청을 관리자 백엔드(:8001)로 넘긴다 (CORS 없이 같은 출처처럼 동작)
const apiTarget = process.env.ADMIN_API_URL ?? 'http://127.0.0.1:8001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: { '/api': apiTarget },
  },
})
