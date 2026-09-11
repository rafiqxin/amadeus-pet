import assert from 'node:assert/strict'

// ---- CALL transcript scrolling -------------------------------------------
globalThis.requestAnimationFrame = (cb) => { cb(); return 1 }
globalThis.cancelAnimationFrame = () => {}
globalThis.MutationObserver = class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} }
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} }

class FakeElement {
  constructor() {
    this.listeners = new Map()
    this.scrollTop = 0
    this.scrollHeight = 1000
    this.clientHeight = 200
    this.textContent = 'long reply'
    this.dataset = {}
  }
  addEventListener(type, fn) { this.listeners.set(type, fn) }
  removeEventListener(type) { this.listeners.delete(type) }
  emit(type, event) { this.listeners.get(type)?.(event) }
}

const transcript = new FakeElement()
const root = { querySelector: (selector) => selector === '.call-subtitle' ? transcript : null }
const { mountIosCallTranscriptScroll } = await import('../src/ui/ios-call-scroll.js')
const unmount = mountIosCallTranscriptScroll(root)

let prevented = false
transcript.emit('wheel', { deltaY: 120, preventDefault() { prevented = true } })
assert.equal(transcript.scrollTop, 120, 'wheel must move the existing CALL transcript')
assert.equal(prevented, true, 'wheel must be consumed when the transcript actually scrolls')

transcript.emit('touchstart', { touches: [{ clientY: 300 }] })
prevented = false
transcript.emit('touchmove', { touches: [{ clientY: 220 }], preventDefault() { prevented = true } })
assert.equal(transcript.scrollTop, 200, 'touch drag must move the existing CALL transcript')
assert.equal(prevented, true, 'touch drag must be consumed while scrolling')
unmount()

// ---- iOS audio fallback ---------------------------------------------------
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
    this.onended = null
    this.onerror = null
  }
  async play() { playCalls += 1; this.paused = false }
  pause() { this.paused = true }
}

globalThis.window = {
  AudioContext: SuspendedAudioContext,
  webkitAudioContext: null,
  speechSynthesis: { cancel() {} },
}
globalThis.Audio = FakeAudio

const { playAudioUrl, stopVoicePlayback } = await import('../src/voice/player.js')
const result = await playAudioUrl('capacitor://localhost/Resources/amadeus-voices/hello.ogg', {
  onLevel() {},
})
assert.equal(playCalls, 1, 'HTMLMediaElement.play() must run even when WebAudio is suspended')
assert.equal(result.played, true, 'audible media playback must not depend on lipsync AudioContext')
assert.equal(result.lipsyncActive, false, 'suspended WebAudio should disable only lipsync, not sound')
stopVoicePlayback()

console.log('PASS CALL transcript wheel/touch scrolling contract')
console.log('PASS iOS audio contract: media.play executes even with suspended WebAudio')
