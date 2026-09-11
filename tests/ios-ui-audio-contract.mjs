import assert from 'node:assert/strict'
import fs from 'node:fs'

// These remain fast unit/source-contract tests only. Real WKWebView interaction
// lives in ios-tests/ and is executed on an iOS Simulator by GitHub Actions.
const scrollSource = fs.readFileSync(new URL('../src/ui/ios-call-scroll.js', import.meta.url), 'utf8')
const scrollCss = fs.readFileSync(new URL('../src/ui/ios-call-fixes.css', import.meta.url), 'utf8')
const mainJs = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')

// The reply text must appear WITH its audio, not before it. Synthesis takes
// seconds (translate -> synthesise -> decode), so rendering as soon as the LLM
// answered put the text on screen ~11s ahead of the voice, and the voice then
// read out something the reader had already finished. Measured after the fix:
//   t=0      waiting indicator
//   t=4663   translate done
//   t=11643  synth done
//   t=11653  audio started AND reply text shown
{
  const start = mainJs.indexOf('async function speakReply')
  const end = mainJs.indexOf('async function brain')
  assert.ok(start > 0 && end > start, 'speakReply must exist in src/main.js')
  const speakReply = mainJs.slice(start, end)
  const voiceBranch = speakReply.indexOf("if (settings.get('voice') === false)")
  assert.ok(voiceBranch > 0, 'speakReply must branch on the voice setting')
  assert.doesNotMatch(speakReply.slice(0, voiceBranch), /presentLine\(line/,
    'the reply must not be rendered before the voice setting is even consulted; deferring it is the point')
  assert.match(speakReply, /const showLine = \(\) => presentLine\(line/,
    'showLine must be the deferred renderer')
  assert.match(speakReply, /onStart: showLine/,
    'the single-shot audio path must reveal the text when playback starts')
  assert.match(speakReply, /onSegmentStart: showLine/,
    'the chunked path must reveal the text on its first segment, not before synthesis')
  assert.match(speakReply.slice(voiceBranch, speakReply.indexOf('await routeAndSpeak')), /presentLine\(line/,
    'with voice disabled the text must still be shown immediately')
}
assert.match(scrollSource, /ama-transcript-scroll/,
  'the transcript must still report its scroll state')
assert.match(scrollSource, /el\.dataset\.scrollable/,
  'the transcript must still expose whether it has overflow to scroll')
assert.match(scrollSource, /el\.scrollTop = 0/,
  'a new transcript must start at the top')

// The transcript is scrolled by finger. There is no drawn rail or thumb: a
// custom scrollbar over the hand-drawn CALL frame read as a foreign widget on
// device, and what actually makes the gesture work is the touch handling below.
assert.doesNotMatch(scrollSource, /call-scroll-track/,
  'the custom scroll rail was removed on purpose; do not reintroduce it')
assert.doesNotMatch(scrollSource, /call-scroll-thumb/,
  'the custom scroll thumb was removed on purpose; do not reintroduce it')
assert.doesNotMatch(scrollCss, /\.call-scroll-track/,
  'scroll rail styling must not come back')
assert.doesNotMatch(scrollCss, /\.call-scroll-thumb/,
  'scroll thumb styling must not come back')
assert.match(scrollCss, /\.call-subtitle\s*\{[\s\S]*?touch-action:\s*none/,
  'WKWebView must not claim the pan: with pan-y it swallows touchmove and its own scrolling does not move this element')
assert.match(scrollCss, /\.call-subtitle\s*\{[\s\S]*?overflow-y:\s*auto\s*!important/,
  'the transcript must remain a real scroll container')
assert.match(scrollCss, /\.call-subtitle\s*\{[\s\S]*?-webkit-overflow-scrolling:\s*touch/,
  'momentum scrolling is part of the finger-scroll contract')
assert.match(scrollCss, /\.call-subtitle::-webkit-scrollbar\s*\{[\s\S]*?width:\s*0/,
  'no scrollbar may be painted over the CALL frame')

assert.match(scrollSource, /document\.addEventListener\('touchstart', onDocumentTouchStart, \{ capture: true, passive: true \}\)/,
  'WKWebView does not deliver the touch to the transcript itself, so the gesture is claimed at document capture level and hit-tested by geometry')
assert.match(scrollSource, /window\.addEventListener\('touchmove', onWindowTouchMove, \{ capture: true, passive: false \}\)/,
  'drag ownership must continue at window capture level so the scroll is not dropped mid-gesture')
assert.match(scrollSource, /const next = Math\.max\(0, Math\.min\(max, touchTop \+ delta\)\)/,
  'finger scrolling must clamp to the scrollable range')
assert.match(scrollSource, /el\.addEventListener\('wheel', onWheel, \{ passive: false \}\)/,
  'desktop wheel support drives the same markup in the Electron harness')

// Lip sync must never route the element through the Web Audio graph again.
// createMediaElementSource() removes the element's direct output, and on this
// device the routed path was silent — which is why the mouth ended up driven by
// model motion instead of the voice. The envelope is decoded offline and sampled
// by the element's own currentTime, so playback stays on the audible path.
const playerJs = fs.readFileSync(new URL('../src/voice/player.js', import.meta.url), 'utf8')
// Assertions about what the code does must not trip over the comments that
// explain why the forbidden approach was removed.
const playerCode = playerJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
assert.doesNotMatch(playerCode, /createMediaElementSource/,
  'rerouting the audio element through WebAudio silences playback on WKWebView; lip sync must stay offline')
assert.doesNotMatch(playerCode, /getByteTimeDomainData/,
  'a live AnalyserNode requires the reroute that silences playback')
assert.match(playerCode, /parseWavChannels/,
  'the TTS WAVs are parsed directly, which needs no decoding API')
assert.match(playerCode, /decodeAudioData/,
  'the bundled Ogg clips are decoded offline, which does not touch the output path')
assert.match(playerCode, /audio\.currentTime \|\| 0\) \* ENVELOPE_FPS/,
  'the envelope must be sampled by the element clock so the mouth follows the voice')
assert.match(playerCode, /typeof requestAnimationFrame !== 'function'\) return false/,
  'lip sync must degrade quietly where rAF is unavailable instead of throwing')

let playCalls = 0
class SuspendedAudioContext {
  constructor() { this.state = 'suspended'; this.sampleRate = 44100 }
}
class FakeAudio {
  constructor() {
    this.volume = 1
    this.preload = ''
    this.playsInline = false
    this.src = ''
    this.duration = 1.25
    this.ended = false
    this.paused = true
    this.error = null
    this.onended = null
    this.onerror = null
    this.onloadedmetadata = null
  }
  async play() { playCalls += 1; this.paused = false }
  pause() { this.paused = true }
}

globalThis.window = {
  AudioContext: SuspendedAudioContext,
  webkitAudioContext: null,
  speechSynthesis: { cancel() {} },
  dispatchEvent() {},
}
globalThis.Audio = FakeAudio
globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail } }
globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}

const { playAudioUrl, stopVoicePlayback } = await import('../src/voice/player.js')
const result = await playAudioUrl('capacitor://localhost/Resources/amadeus-voices/hello.ogg', { onLevel() {} })
assert.equal(playCalls, 1, 'HTMLMediaElement.play() must execute even with suspended WebAudio')
assert.equal(result.played, true)
assert.equal(result.lipsyncActive, false)
stopVoicePlayback('unit-test-finished')

console.log('PASS CALL transcript scrolls by finger with no drawn scrollbar')
console.log('PASS media playback remains independent from suspended WebAudio')
