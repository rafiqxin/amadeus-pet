#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dest = path.join(root, 'public', 'Resources', 'amadeus-reference')
const force = process.argv.includes('--force')

const ASSETS = [
  'bg1.png',
  'amadeus_icon_smaller.png',
  'subtitle_frame_big.png',
  'logo39.png',
  'connect_unselect.png',
  'connect_select.png',
  'cancel_unselect.png',
  'cancel_select.png',
]

const localCandidates = [
  process.env.AMADEUS_ANDROID_RES,
  path.resolve(root, '..', 'Amadeus', 'app', 'src', 'main', 'res', 'drawable-xhdpi'),
].filter(Boolean)

const rawBase =
  process.env.AMADEUS_REFERENCE_BASE ||
  'https://raw.githubusercontent.com/rafiqxin/Amadeus/master/app/src/main/res/drawable-xhdpi'

async function exists(file) {
  try {
    const s = await fs.stat(file)
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
}

async function download(url, file, redirects = 0) {
  if (redirects > 5) throw new Error(`too many redirects for ${url}`)
  await new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        download(new URL(res.headers.location, url).toString(), file, redirects + 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', async () => {
        try {
          await fs.writeFile(file, Buffer.concat(chunks))
          resolve()
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
  })
}

await fs.mkdir(dest, { recursive: true })

for (const name of ASSETS) {
  const target = path.join(dest, name)
  if (!force && await exists(target)) {
    console.log(`[amadeus-ui] keep ${name}`)
    continue
  }

  let copied = false
  for (const srcRoot of localCandidates) {
    const source = path.join(srcRoot, name)
    if (await exists(source)) {
      await fs.copyFile(source, target)
      console.log(`[amadeus-ui] copy ${name} <- ${srcRoot}`)
      copied = true
      break
    }
  }
  if (copied) continue

  const url = `${rawBase}/${name}`
  await download(url, target)
  console.log(`[amadeus-ui] download ${name}`)
}

console.log(`[amadeus-ui] ready: ${dest}`)
