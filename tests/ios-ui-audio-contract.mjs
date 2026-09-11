import assert from 'node:assert/strict'
import fs from 'node:fs'

// These remain fast unit/source-contract tests only. Real WKWebView interaction
// lives in ios-tests/ and is executed on an iOS Simulator by GitHub Actions.
const scrollSource = fs.readFileSync(new URL('../src/ui/ios-call-scroll.js', import.meta.url), 'utf8')
assert.match(scrollSource, /call-scroll-track/)
assert.match(scrollSource, /call-scroll-thumb/)
assert.match(scrollSource, /const next = Math\.max\(0, Math\.min\(max, thumbDrag\.scrollTop/,
  'thumb drag must calculate a bounded scrollTop from the drag origin')
assert.match(scrollSource, /el\.scrollTop = next/,
  'thumb drag must write the calculated value to the transcript scrollTop')
assert.match(scrollSource, /thumb\.addEventListener\('pointerdown'/)
assert.match(scrollSource, /document\.addEventListener\('pointerdown', onDocumentPointerDown, \{ capture: true, passive: false \}\)/,
  'WKWebView thumb ownership must begin from document capture, not only the narrow thumb target')
assert.match(scrollSource, /document\.addEventListener\('touchstart', onDocumentTouchStart, \{ capture: true, passive: false \}\)/,
  'WKWebView touch-start fallback must begin from document capture using geometry hit-testing')
assert.match(scrollSource, /window\.addEventListener\('pointermove', onWindowPointerMove, \{ capture: true, passive: false \}\)/,
  'pointer drag ownership must continue at window capture level')
assert.match(scrollSource, /window\.addEventListener\('touchmove', onWindowTouchMove, \{ capture: true, passive: false \}\)/,
  'touch drag ownership must continue at window capture level')
assert.match(scrollSource, /const padX = Math\.max\(8, \(44 - rect\.width\) \/ 2\)/,
  'visible thumb must retain a finger-sized invisible hit target without changing the UI')

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

console.log('PASS custom CALL thumb document-capture pointer/touch contract')
console.log('PASS media playback remains independent from suspended WebAudio')
