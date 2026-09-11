/* End-to-end check of the AMA-DEUS speech chain using the app's own modules.
 *
 *   Chinese input -> Chinese reply (LLM) -> Japanese (LLM) -> Kurisu TTS -> WAV
 *
 * It imports src/llm/client.js and src/voice/tts-client.js — the exact modules
 * the renderer uses — so a pass here means the only untested part left is the
 * Electron window itself.
 *
 * Credentials come from the environment so nothing is committed:
 *
 *   AMA_LLM_ENDPOINT=https://api.deepseek.com \
 *   AMA_LLM_MODEL=deepseek-flash \
 *   AMA_LLM_KEY=sk-... \
 *   node tools/verify-speech-chain.mjs
 */

import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const model = (name) => import(pathToFileURL(path.join(root, 'src', name)).href)

const endpoint = process.env.AMA_LLM_ENDPOINT || ''
const apiKey = process.env.AMA_LLM_KEY || ''
const modelName = process.env.AMA_LLM_MODEL || ''

const llm = await model('llm/client.js')
const tts = await model('voice/tts-client.js')

let failures = 0
function check(label, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
  return ok
}

console.log(`LLM  : ${endpoint || '(local 8090)'} ${modelName}`)
console.log(`TTS  : ${tts.getTtsConfig().endpoint} (speech=${tts.TTS_OUTPUT_LANGUAGE})`)
console.log('')

console.log('1. LLM reachable')
if (endpoint) llm.setRemoteConfig({ endpoint, model: modelName, apiKey })
check('checkServer()', await llm.checkServer())
if (failures) {
  console.log('\nLLM unreachable — aborting.')
  process.exit(1)
}

console.log('')
console.log('2. Chinese conversation (visible reply stays Chinese)')
const userInput = '红莉栖，时间机器真的存在吗？'
console.log(`  user> ${userInput}`)
const reply = await llm.chat(userInput)
const replyIsChinese = /[\u4e00-\u9fff]/.test(reply) && !/^[\u3040-\u30ff]+$/.test(reply)
check('Chinese reply', Boolean(reply) && replyIsChinese, `${reply.length} chars`)
console.log(`  kurisu> ${reply}`)

console.log('')
console.log('3. Chinese -> Japanese for speech')
const japanese = await llm.translateForKurisuTts(reply)
// Japanese uses kanji, which share the CJK ideograph range with Chinese, so a
// "no Chinese characters" test would false-positive on words like 物理学 or
// 相対論. The reliable signal is kana: Chinese output contains none, and normal
// Japanese prose runs roughly 40-60% kana.
const kana = (japanese.match(/[\u3040-\u30ff]/g) || []).length
const kanaRatio = japanese.length ? kana / japanese.length : 0
check(
  'Japanese translation',
  kanaRatio >= 0.15,
  `${japanese.length} chars, ${kana} kana (${(kanaRatio * 100).toFixed(0)}% kana)`,
)
console.log(`  音声> ${japanese}`)

console.log('')
console.log('4. Router classification (should offer a Japanese line either way)')
const route = await llm.classifyReferenceVoice(reply)
check('classifier returned', route !== null, route ? JSON.stringify(route).slice(0, 160) : 'null')

console.log('')
console.log('5. Kurisu TTS renders the LLM output')
const started = Date.now()
try {
  const audio = await tts.synthesizeTts(japanese, { language: 'ja', mood: 'normal' })
  const bytes = Buffer.from(await audio.blob.arrayBuffer())
  const ok = bytes.length > 1000 && bytes.subarray(0, 4).toString('latin1') === 'RIFF'
  check('WAV produced', ok, `${bytes.length} B in ${Date.now() - started} ms via ${audio.engine}`)
  const out = path.join(root, 'voice-server', 'out', 'chain-reply.wav')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, bytes)
  console.log(`  -> ${out}`)
} catch (error) {
  check('WAV produced', false, error?.message || String(error))
}

console.log('')
console.log(failures ? `${failures} failure(s)` : 'speech chain: OK')
process.exit(failures ? 1 : 0)
