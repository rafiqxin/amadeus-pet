/* Verifies the app's real TTS client against a running Kurisu TTS server.
 *
 * This runs the SAME module the renderer uses (src/voice/tts-client.js), so it
 * proves the client/server contract without needing the Electron window or an
 * LLM. Run it whenever the voice backend changes:
 *
 *     node tools/verify-voice-client.mjs
 *     node tools/verify-voice-client.mjs --url http://10.14.62.86:9881
 *
 * Exits non-zero on the first contract violation.
 */

import { pathToFileURL } from 'node:url'
import path from 'node:path'

const args = process.argv.slice(2)
const urlIndex = args.indexOf('--url')
const endpoint = urlIndex >= 0 ? args[urlIndex + 1] : ''

const root = path.resolve(import.meta.dirname, '..')
const client = await import(pathToFileURL(path.join(root, 'src', 'voice', 'tts-client.js')).href)

if (endpoint) {
  client.setTtsConfig({ endpoint, enabled: true })
}

const PROBES = [
  ['normal', 'そうね、その通りだと思うわ。'],
  ['annoyed', 'だから、そういうのはやめてって言ってるでしょ。'],
  ['happy', 'まあ、悪くないんじゃない？'],
]

let failures = 0
function check(label, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

console.log('client config :', JSON.stringify(client.getTtsConfig()))
console.log('output lang   :', client.TTS_OUTPUT_LANGUAGE)
console.log('')
console.log('1. health')
const health = await client.checkTtsServer()
check('checkTtsServer()', health.ok === true, JSON.stringify(health).slice(0, 160))

console.log('')
console.log('2. synthesis (Japanese only)')
for (const [mood, text] of PROBES) {
  const started = Date.now()
  try {
    const result = await client.synthesizeTts(text, { language: 'ja', mood })
    const bytes = Buffer.from(await result.blob.arrayBuffer())
    const riff = bytes.subarray(0, 4).toString('latin1')
    const wave = bytes.subarray(8, 12).toString('latin1')
    const ok = bytes.length > 1000 && riff === 'RIFF' && wave === 'WAVE'
    check(
      `synthesize ${mood}`,
      ok,
      `${bytes.length} B, ${Date.now() - started} ms, ct=${result.contentType}, engine=${result.engine}, ${riff}/${wave}`,
    )
  } catch (error) {
    check(`synthesize ${mood}`, false, error?.message || String(error))
  }
}

console.log('')
console.log('3. language contract (Chinese must never reach the voice backend)')
try {
  await client.synthesizeTts('你好，红莉栖。', { language: 'zh' })
  check('Chinese rejected client-side', false, 'synthesizeTts accepted zh')
} catch (error) {
  check('Chinese rejected client-side', /Japanese/i.test(error?.message || ''), error?.message)
}

console.log('')
console.log(failures ? `${failures} failure(s)` : 'voice client contract: OK')
process.exit(failures ? 1 : 0)
