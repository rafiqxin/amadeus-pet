/* Original synthesized ring tone (WebAudio, no external assets).
   Played when the user CONNECTs in the boot screen — mirrors the
   "ring tone → call page" flow of the Amadeus app concept. */

let ctx = null

function getCtx() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function playRingTone() {
  const ac = getCtx()
  if (!ac) return
  try {
    const t0 = ac.currentTime
    const beat = (start, freq) => {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      g.gain.setValueAtTime(0, t0 + start)
      g.gain.linearRampToValueAtTime(0.1, t0 + start + 0.03)
      g.gain.setValueAtTime(0.1, t0 + start + 0.34)
      g.gain.linearRampToValueAtTime(0, t0 + start + 0.4)
      o.connect(g)
      g.connect(ac.destination)
      o.start(t0 + start)
      o.stop(t0 + start + 0.45)
    }
    // double-ring pattern, two cycles ≈ 1.4s (matches the connecting bar)
    for (let i = 0; i < 2; i++) {
      beat(i * 0.7, 660)
      beat(i * 0.7 + 0.2, 660)
    }
    setTimeout(() => { if (ctx) { ctx.close(); ctx = null } }, 2200)
  } catch {
    /* no audio */
  }
}
