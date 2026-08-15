import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'

// Copy the drop-in model directory into dist so the renderer can fetch it.
function copyModels() {
  return {
    name: 'copy-models',
    closeBundle() {
      const src = path.resolve(__dirname, 'models')
      const dst = path.resolve(__dirname, 'dist', 'models')
      fs.rmSync(dst, { recursive: true, force: true })
      fs.cpSync(src, dst, { recursive: true })
    },
  }
}

export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@framework': path.resolve(__dirname, 'vendor/Framework/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome126',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        demo: path.resolve(__dirname, 'demo.html'),
      },
    },
  },
  plugins: [copyModels()],
  server: { port: 5199, strictPort: true },
})
