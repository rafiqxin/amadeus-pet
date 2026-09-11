/* Keyword memory: persists user statements, recalls related ones by
   keyword overlap. Used both by the LLM context and as a local fallback
   ("我记得你说过……"). Pure original code, stored in localStorage. */

const KEY = 'ama-memory-v1'
const MAX = 120

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || []
  } catch {
    return []
  }
}

function tokens(text) {
  const t = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
  const out = []
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2))
  return out
}

export function remember(text) {
  if (!text || text.length < 4) return
  const list = load()
  list.push({ text: text.slice(0, 200), ts: Date.now() })
  while (list.length > MAX) list.shift()
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* full */ }
}

export function recall(text, limit = 2) {
  const list = load()
  if (!list.length) return []
  const qt = new Set(tokens(text))
  const scored = list.map((e) => {
    let hit = 0
    for (const t of tokens(e.text)) if (qt.has(t)) hit++
    return { e, hit }
  })
  scored.sort((a, b) => b.hit - a.hit || b.e.ts - a.e.ts)
  return scored.filter((s) => s.hit >= 2).slice(0, limit).map((s) => s.e.text)
}
