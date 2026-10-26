import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5182,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3002', changeOrigin: false },
      '/.well-known': { target: 'http://127.0.0.1:3002', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    clearMocks: true,
    restoreMocks: true,
  },
})
