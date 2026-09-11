/* Settings persistence (localStorage) + application to the stage. */

const DEFAULTS = {
  scale: 0.92,
  idleChat: true,
  opacity: 1.0,
  // On iOS this enables only the bundled reference OGG reaction bank.
  // Arbitrary LLM output still remains silent when no line matches.
  voice: true,
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
    set(k, v) { data[k] = v; save() },
    all() { return { ...data } },
    onChange(fn) { listeners.add(fn) },
    save,
  }
}

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
