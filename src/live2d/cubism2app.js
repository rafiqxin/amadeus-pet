import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism2'

Live2DModel.registerTicker(PIXI.Ticker)
let W = 480, H = 640

export async function createPetAppCubism2(canvas, hooks = {}) {
  const { onTap = () => {}, onLoaded = () => {} } = hooks
  const app = new PIXI.Application({ view: canvas, width: W, height: H, transparent: true, resolution: 1, antialias: true, autoStart: true })
  let model = null, nextIdleAt = 0, aabbData = null
  const look = { x: 0, y: 0, tx: 0, ty: 0 }
  let captured = false, moved = false, downX = 0, downY = 0

  canvas.style.touchAction = 'none'
  canvas.style.pointerEvents = 'auto'

  function setParam(name, v) { try { model?.internalModel.coreModel.setParamFloat(name, v, 1) } catch {} }
  function refit() {
    if (!model || !aabbData) return
    const s = Math.min((W * 0.96) / aabbData.w, (H * 0.96) / aabbData.h)
    model.anchor.set(0, 0); model.scale.set(s); model.x = W / 2 - aabbData.cx * s; model.y = H / 2 - aabbData.cy * s - 20
  }
  function localPoint(e) {
    const rect = canvas.getBoundingClientRect()
    return { x: (e.clientX - rect.left) * (W / Math.max(1, rect.width)), y: (e.clientY - rect.top) * (H / Math.max(1, rect.height)) }
  }
  function fallbackArea(p) { const y = p.y / Math.max(1, H); if (y < 0.40) return 'head'; if (y < 0.61) return 'mouth'; return 'body' }
  function onDown(e) { captured = true; moved = false; downX = e.clientX; downY = e.clientY; try { canvas.setPointerCapture?.(e.pointerId) } catch {} }
  function onMove(e) {
    const p = localPoint(e)
    if (captured && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 10) moved = true
    look.tx = Math.max(-1, Math.min(1, (p.x / W) * 2 - 1)); look.ty = Math.max(-1, Math.min(1, -((p.y / H) * 2 - 1)))
  }
  function onUp(e) {
    if (captured && !moved && model) {
      const p = localPoint(e); let area = false
      try { area = model.hitTest(p.x, p.y) } catch {}
      const resolved = area ? String(area).toLowerCase() : fallbackArea(p)
      onTap({ x: p.x, y: p.y, hit: { area: resolved, source: area ? 'live2d' : 'fallback', model: wrapper() } })
    }
    captured = false; try { canvas.releasePointerCapture?.(e.pointerId) } catch {}
  }
  function onCancel() { captured = false; moved = false }
  function onLeave() { if (!captured) { look.tx = 0; look.ty = 0 } }
  canvas.addEventListener('pointerdown', onDown, { passive: true }); canvas.addEventListener('pointermove', onMove, { passive: true }); canvas.addEventListener('pointerup', onUp, { passive: true }); canvas.addEventListener('pointercancel', onCancel, { passive: true }); canvas.addEventListener('pointerleave', onLeave, { passive: true })

  function expression(name) { if (!model) return; try { model.expression(String(name || 'f01').toLowerCase()) } catch {} }
  function randomMotion(group, priority = 3) { if (!model) return; const g = String(group || '').toLowerCase(), count = model.internalModel.motionManager.definitions?.[g]?.length || 0; if (count) model.motion(g, Math.floor(Math.random() * count), priority) }
  const wrapper = () => ({ isCubism2: true, setExpression: expression, setRandomExpression() { expression(`f0${1 + Math.floor(Math.random() * 4)}`) }, startRandomMotion: randomMotion, startMotion(group, no, priority) { model?.motion(String(group).toLowerCase(), no, priority || 3) }, hitTest(x, y) { return model ? model.hitTest(x, y) : false }, getModel() { return model } })

  app.ticker.add(() => {
    if (!model) return
    look.x += (look.tx - look.x) * 0.12; look.y += (look.ty - look.y) * 0.12
    if (!captured) { setParam('PARAM_ANGLE_X', look.y * 30); setParam('PARAM_ANGLE_Y', look.x * 30); setParam('PARAM_BODY_ANGLE_X', look.x * 10); setParam('PARAM_EYE_BALL_X', look.x); setParam('PARAM_EYE_BALL_Y', look.y) }
    const mm = model.internalModel.motionManager
    if (mm.isFinished() && Date.now() > nextIdleAt) { const defs = mm.definitions.idle || []; if (defs.length) { model.motion('idle', Math.floor(Math.random() * defs.length)); nextIdleAt = Date.now() + 3000 + Math.random() * 5000 } }
  })

  return {
    async loadModel(dir, fileName) {
      if (model) { model.destroy(); model = null }
      model = await Live2DModel.from(`${dir}${fileName}`, { autoInteract: false }); model.autoUpdate = true; app.stage.addChild(model)
      function computeAABB() {
        const core = model.internalModel.coreModel, count = core._$5S?._$aS?.length || 0
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (let i = 0; i < count; i++) { const pts = core.getTransformedPoints(i); if (!pts) continue; for (let k = 0; k + 1 < pts.length; k += 2) { const x = pts[k], y = pts[k + 1]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y } }
        return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY }
      }
      setTimeout(() => { const b = computeAABB(); if (isFinite(b.w) && b.w > 0) { aabbData = { w: b.w, h: b.h, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 }; refit() } else { model.anchor.set(0.5, 0.5); const s = Math.min((W * 0.96) / model.width, (H * 0.96) / model.height); model.scale.set(s); model.x = W / 2; model.y = H / 2 } }, 400)
      onLoaded(model); nextIdleAt = Date.now() + 2000; return model
    },
    setMouthOpen(v) { setParam('PARAM_MOUTH_OPEN_Y', Math.max(0, Math.min(1, v))) },
    setExpression: expression,
    setRandomExpression() { expression(`f0${1 + Math.floor(Math.random() * 4)}`) },
    startRandomMotion: randomMotion,
    startMotion(group, no, priority) { model?.motion(String(group).toLowerCase(), no, priority || 3) },
    resize(w, h) { W = Math.round(Number(w) || 480); H = Math.round(Number(h) || 640); app.renderer.resize(W, H); canvas.style.width = '100%'; canvas.style.height = '100%'; refit() },
    getManager: () => wrapper(), gl: null,
    async dispose() { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onCancel); canvas.removeEventListener('pointerleave', onLeave); if (model) { model.destroy(); model = null }; app.destroy(true) },
  }
}
