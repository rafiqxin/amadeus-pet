/* Fetch the 45 original Kurisu reaction clips into public/Resources/amadeus-voices.
 *
 * They are not committed: they are the author's own material hosted alongside
 * the Android app, and THIRD_PARTY_NOTICES forbids redistributing them through
 * this repository. The iOS workflows download them the same way, with the same
 * file list — keep the two in step.
 *
 *     node tools/fetch-voices.mjs
 *     node tools/fetch-voices.mjs --verify-only
 *
 * Idempotent: an existing non-empty file is left alone.
 */
import { mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BASE = 'https://raw.githubusercontent.com/rafiqxin/Amadeus/master/app/src/main/res/raw'

/** Must stay in step with VOICE_CATALOG in src/voice/catalog.js. */
const CLIPS = [
  'hello', 'daga_kotowaru', 'devilish_pervert', 'i_guess', 'nice', 'pervert_confirmed',
  'sorry', 'sounds_tough', 'this_guy_hopeless', 'christina', 'gah', 'dont_add_tina',
  'why_christina', 'who_the_hell_christina', 'ask_me_whatever', 'could_i_help',
  'what_do_you_want', 'what_is_it', 'heheh', 'huh_why_say', 'you_sure',
  'nice_to_meet_okabe', 'look_forward_to_working', 'senpai_question', 'senpai_questionmark',
  'senpai_what_we_talkin', 'senpai_who_is_this', 'senpai_please_dont_tell', 'still_not_happy',
  'dont_call_me_like_that', 'tm_nonsense', 'tm_scientist_no_evidence', 'tm_we_dont_know',
  'tm_you_said', 'humans_software', 'memory_complex', 'secret_diary',
  'modifying_memories_impossible', 'memories_christina', 'gah_extended', 'should_christina',
  'ok', 'tm_not_possible', 'pleased_to_meet_you', 'pervert_idot_wanttodie',
]

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'public', 'Resources', 'amadeus-voices')
const verifyOnly = process.argv.includes('--verify-only')

function present(name) {
  const file = path.join(outDir, `${name}.ogg`)
  return existsSync(file) && statSync(file).size > 0
}

if (verifyOnly) {
  const missing = CLIPS.filter((name) => !present(name))
  console.log(`${CLIPS.length - missing.length}/${CLIPS.length} clips present`)
  if (missing.length) {
    console.log('missing:', missing.join(', '))
    process.exit(1)
  }
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })

let fetched = 0
let skipped = 0
const failed = []

for (const name of CLIPS) {
  if (present(name)) { skipped++; continue }
  const url = `${BASE}/${name}.ogg`
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) throw new Error('empty response')
    writeFileSync(path.join(outDir, `${name}.ogg`), bytes)
    fetched++
    process.stdout.write(`  ok   ${name} (${(bytes.length / 1024).toFixed(0)} kB)\n`)
  } catch (error) {
    failed.push(`${name}: ${error.message}`)
  }
}

console.log(`\n${fetched} fetched, ${skipped} already present, ${failed.length} failed`)
if (failed.length) {
  console.log(failed.join('\n'))
  process.exit(1)
}
if (fetched) console.log('run `npm run build:render` to copy them into dist/')
