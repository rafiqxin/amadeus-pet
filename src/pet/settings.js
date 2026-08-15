/* Settings persistence (localStorage) + application to the stage. */

const DEFAULTS = {
  scale: 0.92,       // pet render scale (applied to stage transform)
  idleChat: true,    // occasional idle chatter bubbles
  opacity: 1.0,
  voice: true,       // speak lines via Web Speech API when a voice exists
}

const KEY = 'amadeus-pet-settings-v1'

export function createSettings() {
  let data = { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) data = { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* keep defaults */ }

  const listeners = new Set()

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* ignore */ }
    for (const fn of listeners) fn(data)
  }

  return {
    get(k) { return data[k] },
    set(k, v) {
      data[k] = v
      save()
    },
    all() { return { ...data } },
    onChange(fn) { listeners.add(fn) },
    save,
  }
}

/* Apply scale/opacity to the pet stage canvas wrapper. */
export function applyVisualSettings(stage, canvasWrap, settings) {
  function apply() {
    const s = settings.get('scale') || 1
    const o = settings.get('opacity') ?? 1
    if (canvasWrap) {
      canvasWrap.style.transformOrigin = '50% 92%'
      canvasWrap.style.transform = `scale(${s})`
      canvasWrap.style.opacity = String(o)
    }
  }
  settings.onChange(apply)
  apply()
}
