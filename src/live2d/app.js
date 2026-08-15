/* Pet application delegate: Cubism framework startup, GL context, render loop,
   pointer handling and look-at (eye tracking). Port of LAppDelegate +
   LAppSubdelegate + LAppView merged for a single fixed-size canvas. */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44'
import { CubismViewMatrix } from '@framework/math/cubismviewmatrix'

import * as Define from './define'
import { LAppPal } from './pal'
import { Live2DManager } from './manager'
import { TextureManager } from './texturemanager'

export async function createPetApp(canvas, hooks = {}) {
  const { onTap = () => {}, onLoaded = () => {} } = hooks

  const { CubismFramework, Option, LogLevel } = await import('@framework/live2dcubismframework')

  /* ---- Cubism framework ------------------------------------- */
  const option = new Option()
  option.logFunction = LAppPal.printMessage
  option.loggingLevel = LogLevel.LogLevel_Warning
  CubismFramework.startUp(option)
  CubismFramework.initialize()

  /* ---- GL context ------------------------------------------- */
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  if (!gl) throw new Error('WebGL 不可用，无法启动 Live2D 渲染')

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  let viewW = Define.CanvasSize.width   // CSS px of the canvas box (fluid)
  let viewH = Define.CanvasSize.height
  let width = viewW * dpr   // device px — used for ALL matrix math (like the demo)
  let height = viewH * dpr
  canvas.width = width
  canvas.height = height

  const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING)
  gl.enable(gl.BLEND)
  // Premultiplied-alpha compositing for the transparent Electron window.
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  /* ---- managers --------------------------------------------- */
  const textureManager = new TextureManager()
  textureManager.setGl(gl)
  const manager = new Live2DManager()
  manager.initialize({ canvas, gl, framebuffer, textureManager })

  /* ---- view matrix (same as official demo) ------------------ */
  const deviceToScreen = new CubismMatrix44()
  const viewMatrix = new CubismViewMatrix()
  {
    const ratio = width / height
    const left = -ratio
    const right = ratio
    const bottom = Define.ViewLogicalLeft
    const top = Define.ViewLogicalRight
    viewMatrix.setScreenRect(left, right, bottom, top)
    viewMatrix.scale(Define.ViewScale, Define.ViewScale)

    viewMatrix.setMaxScale(Define.ViewMaxScale)
    viewMatrix.setMinScale(Define.ViewMinScale)
    viewMatrix.setMaxScreenRect(
      Define.ViewLogicalMaxLeft, Define.ViewLogicalMaxRight,
      Define.ViewLogicalMaxBottom, Define.ViewLogicalMaxTop
    )
  }
  // Device-px → logical mapping for hit tests; rebuilt on backing-store resize.
  function rebuildDeviceToScreen() {
    const ratio = width / height
    const left = -ratio
    const right = ratio
    deviceToScreen.loadIdentity()
    if (width > height) {
      const screenW = Math.abs(right - left)
      deviceToScreen.scaleRelative(screenW / width, -screenW / width)
    } else {
      const screenH = Math.abs(Define.ViewLogicalRight - Define.ViewLogicalLeft)
      deviceToScreen.scaleRelative(screenH / height, -screenH / height)
    }
    deviceToScreen.translateRelative(-width * 0.5, -height * 0.5)
  }
  rebuildDeviceToScreen()

  const transformViewX = (dx) => viewMatrix.invertTransformX(deviceToScreen.transformX(dx))
  const transformViewY = (dy) => viewMatrix.invertTransformY(deviceToScreen.transformY(dy))

  /* ---- look-at (eye tracking) ------------------------------- */
  const look = { x: 0, y: 0, tx: 0, ty: 0 }

  /* ---- pointer handling ------------------------------------- */
  let captured = false
  let moved = false
  let hoverX = width / 2
  let hoverY = height / 2

  const localPoint = (e) => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr,
    }
  }

  const onPointerBegan = (e) => {
    captured = true
    moved = false
    const p = localPoint(e)
    manager.setDragging(transformViewX(p.x), transformViewY(p.y))
  }

  const onPointerMoved = (e) => {
    const p = localPoint(e)
    hoverX = p.x / dpr
    hoverY = p.y / dpr
    if (captured) {
      moved = true
      manager.setDragging(transformViewX(p.x), transformViewY(p.y))
    }
  }

  const onPointerEnded = (e) => {
    manager.setDragging(0, 0)
    const p = localPoint(e)
    if (!moved) {
      const x = transformViewX(p.x)
      const y = transformViewY(p.y)
      onTap({ x, y, hit: manager.onTap(x, y) })
    }
    captured = false
  }

  canvas.addEventListener('pointerdown', onPointerBegan, { passive: true })
  canvas.addEventListener('pointermove', onPointerMoved, { passive: true })
  canvas.addEventListener('pointerup', onPointerEnded, { passive: true })

  // Mouse leaves window → reset hover target so eyes relax.
  canvas.addEventListener('pointerleave', () => {
    hoverX = width / 2
    hoverY = height / 2
  })

  /* ---- render loop ------------------------------------------ */
  let rafId = 0
  let running = true
  const loop = () => {
    if (!running) return
    LAppPal.updateTime()

    gl.clearColor(0.0, 0.0, 0.0, 0.0)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.clearDepth(1.0)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    // Hover → smooth look target (logical coords, y up).
    const nx = (hoverX / viewW) * 2 - 1
    const ny = -((hoverY / viewH) * 2 - 1)
    look.tx = Math.max(-1, Math.min(1, nx))
    look.ty = Math.max(-1, Math.min(1, ny))
    look.x += (look.tx - look.x) * 0.12
    look.y += (look.ty - look.y) * 0.12

    const model = manager.getModel()
    if (model && model.getModel() && !captured) {
      const m = model.getModel()
      m.setParameterValueById(model._idParamAngleX, look.y * 30, 1)
      m.setParameterValueById(model._idParamAngleY, look.x * 30, 1)
      m.setParameterValueById(model._idParamEyeBallX, look.x, 1)
      m.setParameterValueById(model._idParamEyeBallY, look.y, 1)
      m.setParameterValueById(model._idParamBodyAngleX, look.x * 10, 1)
    }

    manager.setViewMatrix(viewMatrix)
    manager.onUpdate()

    rafId = requestAnimationFrame(loop)
  }
  loop()

  /* ---- public API ------------------------------------------- */
  return {
    loadModel(dir, fileName) {
      const m = manager.loadModel(dir, fileName)
      m.onLoaded(() => {
        const model = m.getModel()
        console.log(
          '[ama-pet] model loaded:', fileName,
          `(canvas ${model.getCanvasWidth()}x${model.getCanvasHeight()})`
        )
        onLoaded(m)
      })
      return m
    },
    getManager: () => manager,
    setMouthOpen(v) {
      manager.getModel()?.setMouthOpen(v)
    },
    /* Fluid-layout support: the backing store follows the window size and
       the device→logical mapping is rebuilt so hit tests stay correct.
       The logical view matrix needs no rebuild (it is aspect-independent:
       the projection in the manager re-derives from canvas size each frame). */
    resize(w, h) {
      viewW = Number(w) || viewW
      viewH = Number(h) || viewH
      width = Math.round(viewW * dpr)
      height = Math.round(viewH * dpr)
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
      rebuildDeviceToScreen()
      hoverX = width / 2
      hoverY = height / 2
    },
    gl,
    dispose() {
      running = false
      cancelAnimationFrame(rafId)
      canvas.removeEventListener('pointerdown', onPointerBegan)
      canvas.removeEventListener('pointermove', onPointerMoved)
      canvas.removeEventListener('pointerup', onPointerEnded)
      manager.release()
      textureManager.releaseTextures()
      CubismFramework.dispose()
    },
  }
}
