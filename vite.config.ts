import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/gemini': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/api/grok': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/api/ollama': {
        target: 'http://127.0.0.1:11434',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/ollama/, '/api'),
      },
    },
  },
})
