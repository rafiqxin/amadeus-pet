/* Live2D manager: model lifecycle + per-frame update/draw (port of LAppLive2DManager). */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44'
import { CubismWebGLOffscreenManager } from '@framework/rendering/cubismoffscreenmanager'

import * as Define from './define'
import { Live2DModel } from './model'

export class Live2DManager {
  constructor() {
    this._models = []
    this._viewMatrix = new CubismMatrix44()
    this._ctx = null
  }

  initialize(ctx) {
    this._ctx = ctx
  }

  loadModel(dir, fileName) {
    this._models.length = 0
    const model = new Live2DModel()
    model.setContext(this._ctx)
    model.loadAssets(dir, fileName)
    this._models.push(model)
    return model
  }

  getModel() {
    return this._models[0] || null
  }

  onTap(x, y) {
    const model = this.getModel()
    if (!model) return
    if (model.hitTest(Define.HitAreaNameHead, x, y)) {
      return { area: 'head', model }
    }
    if (model.hitTest(Define.HitAreaNameBody, x, y)) {
      return { area: 'body', model }
    }
    return null
  }

  setDragging(x, y) {
    const model = this.getModel()
    if (model) model.setDragging(x, y)
  }

  onUpdate() {
    const gl = this._ctx.gl
    CubismWebGLOffscreenManager.getInstance().beginFrameProcess(gl)

    const { width, height } = this._ctx.canvas
    const projection = new CubismMatrix44()
    const model = this.getModel()

    if (model && model.getModel()) {
      if (model.getModel().getCanvasWidth() > 1.0 && width < height) {
        model.getModelMatrix().setWidth(2.0)
        projection.scale(1.0, width / height)
      } else {
        projection.scale(height / width, 1.0)
      }
      if (this._viewMatrix) projection.multiplyByMatrix(this._viewMatrix)
    }

    if (model) {
      model.update()
      model.draw(projection)
    }

    CubismWebGLOffscreenManager.getInstance().endFrameProcess(gl)
    CubismWebGLOffscreenManager.getInstance().releaseStaleRenderTextures(gl)
  }

  setViewMatrix(m) {
    for (let i = 0; i < 16; i++) this._viewMatrix.getArray()[i] = m.getArray()[i]
  }

  release() {
    for (const m of this._models) m.release()
    this._models.length = 0
  }
}
