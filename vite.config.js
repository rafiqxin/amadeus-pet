import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'

function copyTreeIfPresent(src, dst) {
  if (!fs.existsSync(src)) return false
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.cpSync(src, dst, { recursive: true })
  return true
}

function copyActiveAssets() {
  return {
    name: 'copy-active-amadeus-assets',
    closeBundle() {
      const root = __dirname
      const out = path.resolve(root, 'dist')

      // Cubism 2 is the only renderer used by the production entry.
      copyTreeIfPresent(path.resolve(root, 'public', 'live2d.min.js'), path.resolve(out, 'live2d.min.js'))

      // Only Kurisu belongs to the current product build. Haru/Mao/Wanko and
      // the Cubism 5 sample runtime are deliberately excluded.
      const kurisuSrc = path.resolve(root, 'models', 'kurisu')
      const kurisuDst = path.resolve(out, 'models', 'kurisu')
      fs.rmSync(path.resolve(out, 'models'), { recursive: true, force: true })
      copyTreeIfPresent(kurisuSrc, kurisuDst)
      fs.rmSync(path.resolve(kurisuDst, 'sounds'), { recursive: true, force: true })

      // Java-Amadeus reference UI assets used by boot/current shell.
      copyTreeIfPresent(
        path.resolve(root, 'public', 'Resources', 'amadeus-reference'),
        path.resolve(out, 'Resources', 'amadeus-reference'),
      )

      // CI creates this directory from the 45 legacy OGGs before Vite runs.
      copyTreeIfPresent(
        path.resolve(root, 'public', 'Resources', 'amadeus-voices'),
        path.resolve(out, 'Resources', 'amadeus-voices'),
      )

      const modelJson = path.resolve(kurisuDst, 'kurisu.model.json')
      if (!fs.existsSync(modelJson)) throw new Error('Kurisu model was not copied to dist')
      const modelText = fs.readFileSync(modelJson, 'utf8')
      if (/"sound"\s*:/.test(modelText)) throw new Error('Production Kurisu model still references embedded motion audio')
    },
  }
}

export default defineConfig({
  root: '.',
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome126',
    assetsInlineLimit: 0,
  },
  plugins: [copyActiveAssets()],
  server: { port: 5199, strictPort: true },
})
