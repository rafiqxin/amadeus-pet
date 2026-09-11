/* Minimal PAL: delta-time source + logging (port of LAppPal). */

let s_currentFrame = 0.0
let s_lastFrame = 0.0
let s_deltaTime = 0.0

export const LAppPal = {
  updateTime() {
    s_currentFrame = performance.now()
    s_deltaTime = (s_currentFrame - s_lastFrame) / 1000.0
    s_lastFrame = s_currentFrame
  },
  getDeltaTime() {
    return s_deltaTime
  },
  printMessage(...args) {
    console.log('[ama-pet]', ...args)
  },
}
