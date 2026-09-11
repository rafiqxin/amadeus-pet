import assert from 'node:assert/strict'
import fs from 'node:fs'

// These remain fast unit/source-contract tests only. Real WKWebView interaction
// lives in ios-tests/ and is executed on an iOS Simulator by GitHub Actions.
const scrollSource = fs.readFileSync(new URL('../src/ui/ios-call-scroll.js', import.meta.url), 'utf8')
const scrollCss = fs.readFileSync(new URL('../src/ui/ios-call-fixes.css', import.meta.url), 'utf8')
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
assert.match(scrollCss, /\.call-subtitle\s*\{[\s\S]*?touch-action:\s*pan-y/,
  'WKWebView only routes a vertical pan to the transcript when it advertises pan-y')
assert.match(scrollCss, /\.call-subtitle\s*\{[\s\S]*?overflow-y:\s*auto\s*!important/,
  'the transcript must remain a real scroll container')
assert.match(scrollCss, /\.call-subtitle\s*\{[\s\S]*?-webkit-overflow-scrolling:\s*touch/,
  'momentum scrolling is part of the finger-scroll contract')
assert.match(scrollCss, /\.call-subtitle::-webkit-scrollbar\s*\{[\s\S]*?width:\s*0/,
  'no scrollbar may be painted over the CALL frame')

assert.match(scrollSource, /el\.addEventListener\('touchmove', onTouchMove, \{ passive: false \}\)/,
  'the transcript must translate a finger drag itself: WKWebView does not reliably deliver the gesture past a pointer-events:none HUD')
assert.match(scrollSource, /const next = Math\.max\(0, Math\.min\(max, touchTop \+ delta\)\)/,
  'finger scrolling must clamp to the scrollable range')
assert.match(scrollSource, /el\.addEventListener\('wheel', onWheel, \{ passive: false \}\)/,
  'desktop wheel support drives the same markup in the Electron harness')

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
