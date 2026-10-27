import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { createBuildInfo } from './server/build-info'

const build = createBuildInfo()

export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify(build) },
  plugins: [react(), {
    name: 'worttrainer-build-info',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(build) }) },
  }],
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
