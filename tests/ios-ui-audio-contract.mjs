import assert from 'node:assert/strict'
import fs from 'node:fs'

// These remain fast unit/source-contract tests only. Real WKWebView interaction
// lives in ios-tests/ and is executed on an iOS Simulator by GitHub Actions.
const scrollSource = fs.readFileSync(new URL('../src/ui/ios-call-scroll.js', import.meta.url), 'utf8')
const scrollCss = fs.readFileSync(new URL('../src/ui/ios-call-fixes.css', import.meta.url), 'utf8')
assert.match(scrollSource, /call-scroll-track/)
assert.match(scrollSource, /call-scroll-thumb/)
assert.match(scrollSource, /document\.body\.appendChild\(track\)/,
  'CALL scrollbar must be portaled to document.body outside pointer-events:none HUD ancestors')
assert.match(scrollSource, /rect\.right - 30/,
  '44px hit target must preserve the previous visible rail center')
assert.match(scrollSource, /const next = Math\.max\(0, Math\.min\(max, thumbDrag\.scrollTop/,
  'thumb drag must calculate a bounded scrollTop from the drag origin')
assert.match(scrollSource, /el\.scrollTop = next/,
  'thumb drag must write the calculated value to the transcript scrollTop')
assert.match(scrollSource, /thumb\.addEventListener\('pointerdown'/)
assert.match(scrollSource, /document\.addEventListener\('pointerdown', onDocumentPointerDown, \{ capture: true, passive: false \}\)/,
  'WKWebView thumb ownership must begin from document capture')
assert.match(scrollSource, /document\.addEventListener\('touchstart', onDocumentTouchStart, \{ capture: true, passive: false \}\)/,
  'WKWebView touch-start fallback must begin from document capture using geometry hit-testing')
assert.match(scrollSource, /window\.addEventListener\('pointermove', onWindowPointerMove, \{ capture: true, passive: false \}\)/,
  'pointer drag ownership must continue at window capture level')
assert.match(scrollSource, /window\.addEventListener\('touchmove', onWindowTouchMove, \{ capture: true, passive: false \}\)/,
  'touch drag ownership must continue at window capture level')
assert.match(scrollCss, /\.call-scroll-track\s*\{[\s\S]*?width:\s*44px/,
  'real track hit-test box must be finger-sized')
assert.match(scrollCss, /\.call-scroll-thumb\s*\{[\s\S]*?width:\s*44px/,
  'real thumb hit-test box must be finger-sized')
assert.match(scrollCss, /\.call-scroll-track::before\s*\{[\s\S]*?width:\s*6px/,
  'visible rail must remain 6px')
assert.match(scrollCss, /\.call-scroll-thumb::after\s*\{[\s\S]*?width:\s*14px/,
  'visible amber thumb must remain 14px')

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

console.log('PASS custom CALL thumb body-portal 44px native hit-target contract')
console.log('PASS media playback remains independent from suspended WebAudio')
