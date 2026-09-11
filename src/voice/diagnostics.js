const MAX_STEPS = 18

let traceId = 0
let state = {
  id: 0,
  kind: 'IDLE',
  stage: 'IDLE',
  status: 'OK',
  detail: '',
  steps: [],
  updatedAt: Date.now(),
}
const listeners = new Set()

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function emit() {
  const snapshot = getVoiceDiagnostics()
  for (const listener of listeners) {
    try { listener(snapshot) } catch {}
  }
  try {
    window.dispatchEvent(new CustomEvent('ama-voice-diagnostics', { detail: snapshot }))
  } catch {}
}

export function beginVoiceTrace(kind = 'VOICE') {
  traceId += 1
  state = {
    id: traceId,
    kind: clean(kind) || 'VOICE',
    stage: 'START',
    status: 'OK',
    detail: '',
    steps: [],
    updatedAt: Date.now(),
  }
  emit()
  return traceId
}

export function voiceDiagnostic(stage, status = 'OK', detail = '') {
  const step = {
    stage: clean(stage).toUpperCase() || 'UNKNOWN',
    status: clean(status).toUpperCase() || 'OK',
    detail: clean(detail),
    at: Date.now(),
  }
  state = {
    ...state,
    stage: step.stage,
    status: step.status,
    detail: step.detail,
    steps: [...state.steps, step].slice(-MAX_STEPS),
    updatedAt: step.at,
  }
  emit()
  return step
}

export function getVoiceDiagnostics() {
  return {
    ...state,
    steps: state.steps.map((step) => ({ ...step })),
  }
}

export function subscribeVoiceDiagnostics(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  try { listener(getVoiceDiagnostics()) } catch {}
  return () => listeners.delete(listener)
}

export function formatVoiceDiagnostics(snapshot = state) {
  const prefix = snapshot.kind && snapshot.kind !== 'IDLE' ? `${snapshot.kind}: ` : ''
  if (!snapshot.steps?.length) return `${prefix}${snapshot.stage || 'IDLE'}`
  return prefix + snapshot.steps.map((step) => {
    const mark = step.status === 'OK' ? '✓' : step.status === 'WORK' ? '…' : step.status === 'SKIP' ? '–' : '✕'
    return `${step.stage} ${mark}${step.detail ? ` ${step.detail}` : ''}`
  }).join(' → ')
}
