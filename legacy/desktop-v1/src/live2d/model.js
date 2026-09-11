/* Live2D model wrapper (port of the official LAppModel, Cubism 5). */

import { CubismDefaultParameterId } from '@framework/cubismdefaultparameterid'
import { CubismModelSettingJson } from '@framework/cubismmodelsettingjson'
import { CubismBreath, BreathParameterData } from '@framework/effect/cubismbreath'
import { CubismLook, LookParameterData } from '@framework/effect/cubismlook'
import { CubismEyeBlink } from '@framework/effect/cubismeyeblink'
import { CubismFramework } from '@framework/live2dcubismframework'
import { CubismUserModel } from '@framework/model/cubismusermodel'
import { ACubismMotion } from '@framework/motion/acubismmotion'
import { CubismMotion } from '@framework/motion/cubismmotion'
import { InvalidMotionQueueEntryHandleValue } from '@framework/motion/cubismmotionqueuemanager'
import { CubismUpdateScheduler } from '@framework/motion/cubismupdatescheduler'
import { CubismBreathUpdater } from '@framework/motion/cubismbreathupdater'
import { CubismLookUpdater } from '@framework/motion/cubismlookupdater'
import { CubismEyeBlinkUpdater } from '@framework/motion/cubismeyeblinkupdater'
import { CubismExpressionUpdater } from '@framework/motion/cubismexpressionupdater'
import { CubismPhysicsUpdater } from '@framework/motion/cubismphysicsupdater'
import { CubismPoseUpdater } from '@framework/motion/cubismposeupdater'
import { CubismLipSyncUpdater } from '@framework/motion/cubismlipsyncupdater'
import { CubismLogError } from '@framework/utils/cubismdebug'

import * as Define from './define'
import { LAppPal } from './pal'

const LoadStep = {
  LoadAssets: 0,
  LoadModel: 1,
  WaitLoadModel: 2,
  LoadExpression: 3,
  WaitLoadExpression: 4,
  LoadPhysics: 5,
  WaitLoadPhysics: 6,
  LoadPose: 7,
  WaitLoadPose: 8,
  SetupEyeBlink: 9,
  SetupBreath: 10,
  LoadUserData: 11,
  WaitLoadUserData: 12,
  SetupEyeBlinkIds: 13,
  SetupLipSyncIds: 14,
  SetupLook: 15,
  SetupLayout: 16,
  LoadMotion: 17,
  WaitLoadMotion: 18,
  LoadTexture: 19,
  WaitLoadTexture: 20,
  CompleteSetup: 21,
}

export class Live2DModel extends CubismUserModel {
  constructor() {
    super()

    this._state = LoadStep.LoadAssets
    this._modelSetting = null
    this._modelHomeDir = ''
    this._userTimeSeconds = 0

    this._eyeBlinkIds = []
    this._lipSyncIds = []
    this._motions = new Map()
    this._expressions = new Map()

    this._expressionCount = 0
    this._textureCount = 0
    this._motionCount = 0
    this._allMotionCount = 0
    this._motionUpdated = false

    this._look = null
    this._updateScheduler = new CubismUpdateScheduler()

    const idManager = CubismFramework.getIdManager()
    this._idParamAngleX = idManager.getId(CubismDefaultParameterId.ParamAngleX)
    this._idParamAngleY = idManager.getId(CubismDefaultParameterId.ParamAngleY)
    this._idParamAngleZ = idManager.getId(CubismDefaultParameterId.ParamAngleZ)
    this._idParamBodyAngleX = idManager.getId(CubismDefaultParameterId.ParamBodyAngleX)
    this._idParamEyeBallX = idManager.getId(CubismDefaultParameterId.ParamEyeBallX)
    this._idParamEyeBallY = idManager.getId(CubismDefaultParameterId.ParamEyeBallY)

    // Consistency validation off for this build.
    this._mocConsistency = false
    this._motionConsistency = false

    this._ctx = null
    this._onLoaded = null
  }

  setContext(ctx) {
    this._ctx = ctx
  }

  onLoaded(cb) {
    this._onLoaded = cb
  }

  getModelSetting() {
    return this._modelSetting
  }

  /* ---------------------------------------------------------- */
  loadAssets(dir, fileName) {
    this._modelHomeDir = dir
    fetch(`${dir}${fileName}`)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const setting = new CubismModelSettingJson(buf, buf.byteLength)
        this._state = LoadStep.LoadModel
        this.setupModel(setting)
      })
      .catch((e) => CubismLogError(`Failed to load ${dir}${fileName}: ${e}`))
  }

  /* ---------------------------------------------------------- */
  setupModel(setting) {
    this._updating = true
    this._initialized = false
    this._modelSetting = setting
    const home = this._modelHomeDir

    /* --- moc3 ------------------------------------------------- */
    if (setting.getModelFileName() !== '') {
      const f = setting.getModelFileName()
      fetch(`${home}${f}`)
        .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
        .then((buf) => {
          this.loadModel(buf, this._mocConsistency)
          this._state = LoadStep.LoadExpression
          loadExpressions()
        })
      this._state = LoadStep.WaitLoadModel
    }

    /* --- expressions ------------------------------------------ */
    const loadExpressions = () => {
      if (setting.getExpressionCount() > 0) {
        const count = setting.getExpressionCount()
        for (let i = 0; i < count; i++) {
          const name = setting.getExpressionName(i)
          const file = setting.getExpressionFileName(i)
          fetch(`${home}${file}`)
            .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
            .then((buf) => {
              const motion = this.loadExpression(buf, buf.byteLength, name)
              if (this._expressions.get(name)) ACubismMotion.delete(this._expressions.get(name))
              this._expressions.set(name, motion)
              this._expressionCount++
              if (this._expressionCount >= count) {
                if (this._expressionManager) {
                  this._updateScheduler.addUpdatableList(new CubismExpressionUpdater(this._expressionManager))
                }
                this._state = LoadStep.LoadPhysics
                loadPhysics()
              }
            })
        }
        this._state = LoadStep.WaitLoadExpression
      } else {
        this._state = LoadStep.LoadPhysics
        loadPhysics()
      }
    }

    /* --- physics ---------------------------------------------- */
    const loadPhysics = () => {
      if (setting.getPhysicsFileName() !== '') {
        const f = setting.getPhysicsFileName()
        fetch(`${home}${f}`)
          .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
          .then((buf) => {
            this.loadPhysics(buf, buf.byteLength)
            if (this._physics && !window.__AMA_SKIP_PHYSICS) {
              this._updateScheduler.addUpdatableList(new CubismPhysicsUpdater(this._physics))
            }
            this._state = LoadStep.LoadPose
            loadPose()
          })
        this._state = LoadStep.WaitLoadPhysics
      } else {
        this._state = LoadStep.LoadPose
        loadPose()
      }
    }

    /* --- pose ------------------------------------------------- */
    const loadPose = () => {
      if (setting.getPoseFileName() !== '') {
        const f = setting.getPoseFileName()
        fetch(`${home}${f}`)
          .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
          .then((buf) => {
            this.loadPose(buf, buf.byteLength)
            if (this._pose) {
              this._updateScheduler.addUpdatableList(new CubismPoseUpdater(this._pose))
            }
            this._state = LoadStep.SetupEyeBlink
            setupEyeBlink()
          })
        this._state = LoadStep.WaitLoadPose
      } else {
        this._state = LoadStep.SetupEyeBlink
        setupEyeBlink()
      }
    }

    /* --- eye blink -------------------------------------------- */
    const setupEyeBlink = () => {
      if (setting.getEyeBlinkParameterCount() > 0) {
        this._eyeBlink = CubismEyeBlink.create(setting)
        this._updateScheduler.addUpdatableList(
          new CubismEyeBlinkUpdater(() => this._motionUpdated, this._eyeBlink)
        )
      }
      this._state = LoadStep.SetupBreath
      setupBreath()
    }

    /* --- breath ----------------------------------------------- */
    const setupBreath = () => {
      this._breath = CubismBreath.create()
      this._breath.setParameters([
        new BreathParameterData(this._idParamAngleX, 0.0, 15.0, 6.5345, 0.5),
        new BreathParameterData(this._idParamAngleY, 0.0, 8.0, 3.5345, 0.5),
        new BreathParameterData(this._idParamAngleZ, 0.0, 10.0, 5.5345, 0.5),
        new BreathParameterData(this._idParamBodyAngleX, 0.0, 4.0, 15.5345, 0.5),
        new BreathParameterData(
          CubismFramework.getIdManager().getId(CubismDefaultParameterId.ParamBreath),
          0.5, 0.5, 3.2345, 1
        ),
      ])
      this._updateScheduler.addUpdatableList(new CubismBreathUpdater(this._breath))
      this._state = LoadStep.LoadUserData
      loadUserData()
    }

    /* --- user data -------------------------------------------- */
    const loadUserData = () => {
      if (setting.getUserDataFile() !== '') {
        const f = setting.getUserDataFile()
        fetch(`${home}${f}`)
          .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
          .then((buf) => {
            this.loadUserData(buf, buf.byteLength)
            this._state = LoadStep.SetupEyeBlinkIds
            setupEyeBlinkIds()
          })
        this._state = LoadStep.WaitLoadUserData
      } else {
        this._state = LoadStep.SetupEyeBlinkIds
        setupEyeBlinkIds()
      }
    }

    /* --- blink / lip sync ids --------------------------------- */
    const setupEyeBlinkIds = () => {
      const count = setting.getEyeBlinkParameterCount()
      this._eyeBlinkIds.length = count
      for (let i = 0; i < count; i++) this._eyeBlinkIds[i] = setting.getEyeBlinkParameterId(i)
      this._state = LoadStep.SetupLipSyncIds
      setupLipSyncIds()
    }

    const setupLipSyncIds = () => {
      const count = setting.getLipSyncParameterCount()
      this._lipSyncIds.length = count
      for (let i = 0; i < count; i++) this._lipSyncIds[i] = setting.getLipSyncParameterId(i)

      // Lip-sync updater driven by our own mouth-level provider
      // (additive, runs after breath — no conflict with motions).
      if (this._lipSyncIds.length > 0) {
        this._mouthProvider = {
          _level: 0,
          _target: 0,
          update(dt) {
            // Frame-rate independent exponential smoothing (τ≈0.08s).
            const k = 1 - Math.exp(-(dt || 0.016) / 0.08)
            this._level += (this._target - this._level) * k
            return true
          },
          getParameter() {
            return this._level
          },
        }
        this._updateScheduler.addUpdatableList(
          new CubismLipSyncUpdater(this._lipSyncIds, this._mouthProvider)
        )
      }
      this._state = LoadStep.SetupLook
      setupLook()
    }

    /* --- look (drag follow) ----------------------------------- */
    const setupLook = () => {
      this._look = CubismLook.create()
      this._look.setParameters([
        new LookParameterData(this._idParamAngleX, 30.0, 0.0, 0.0),
        new LookParameterData(this._idParamAngleY, 0.0, 30.0, 0.0),
        new LookParameterData(this._idParamAngleZ, 0.0, 0.0, -30.0),
        new LookParameterData(this._idParamBodyAngleX, 10.0, 0.0, 0.0),
        new LookParameterData(this._idParamEyeBallX, 1.0, 0.0, 0.0),
        new LookParameterData(this._idParamEyeBallY, 0.0, 1.0, 0.0),
      ])
      this._updateScheduler.addUpdatableList(new CubismLookUpdater(this._look, this._dragManager))
      this._updateScheduler.sortUpdatableList()
      this._state = LoadStep.SetupLayout
      setupLayout()
    }

    /* --- layout ----------------------------------------------- */
    const setupLayout = () => {
      const layout = new Map()
      setting.getLayoutMap(layout)
      this._modelMatrix.setupFromLayout(layout)
      this._state = LoadStep.LoadMotion
      loadMotions()
    }

    /* --- motions ---------------------------------------------- */
    const loadMotions = () => {
      this._state = LoadStep.WaitLoadMotion
      this._model.saveParameters()
      this._allMotionCount = 0
      this._motionCount = 0
      const groups = []
      const groupCount = setting.getMotionGroupCount()
      for (let i = 0; i < groupCount; i++) {
        groups[i] = setting.getMotionGroupName(i)
        this._allMotionCount += setting.getMotionCount(groups[i])
      }
      for (let i = 0; i < groupCount; i++) this.preLoadMotionGroup(groups[i])

      if (groupCount === 0) {
        this._state = LoadStep.LoadTexture
        this._motionManager.stopAllMotions()
        this._updating = false
        this._initialized = true
        this.createRenderer(this._ctx.canvas.width, this._ctx.canvas.height)
        this.setupTextures()
        this.getRenderer().startUp(this._ctx.gl)
        this.getRenderer().loadShaders(Define.ShaderPath)
      }
    }
  }

  /* ---------------------------------------------------------- */
  setupTextures() {
    const usePremultiply = true
    if (this._state !== LoadStep.LoadTexture) return

    const setting = this._modelSetting
    const count = setting.getTextureCount()
    for (let n = 0; n < count; n++) {
      if (setting.getTextureFileName(n) === '') continue
      const path = this._modelHomeDir + setting.getTextureFileName(n)
      this._ctx.textureManager.createTextureFromPngFile(path, usePremultiply, (info) => {
        this.getRenderer().bindTexture(n, info.id)
        this._textureCount++
        if (this._textureCount >= count) {
          this._state = LoadStep.CompleteSetup
          this._updating = false
          this._initialized = true
          if (this._onLoaded) this._onLoaded(this)
        }
      })
      this.getRenderer().setIsPremultipliedAlpha(usePremultiply)
    }
    this._state = LoadStep.WaitLoadTexture
  }

  /* ---------------------------------------------------------- */
  update() {
    if (this._state !== LoadStep.CompleteSetup) return

    const dt = LAppPal.getDeltaTime()
    this._userTimeSeconds += dt

    this._model.loadParameters()
    this._motionUpdated = false

    if (this._motionManager.isFinished()) {
      this.startRandomMotion(Define.MotionGroupIdle, Define.PriorityIdle)
    } else {
      this._motionUpdated = this._motionManager.updateMotion(this._model, dt)
    }
    this._model.saveParameters()

    this._updateScheduler.onLateUpdate(this._model, dt)
    this._model.update()
  }

  setMouthOpen(v) {
    if (this._mouthProvider) this._mouthProvider._target = Math.max(0, Math.min(1, v))
  }

  /* ---------------------------------------------------------- */
  startMotion(group, no, priority, onFinished, onBegan) {
    if (priority === Define.PriorityForce) {
      this._motionManager.setReservePriority(priority)
    } else if (!this._motionManager.reserveMotion(priority)) {
      return InvalidMotionQueueEntryHandleValue
    }

    const name = `${group}_${no}`
    let motion = this._motions.get(name)

    if (!motion) {
      const fileName = this._modelSetting.getMotionFileName(group, no)
      fetch(`${this._modelHomeDir}${fileName}`)
        .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
        .then((buf) => {
          const m = this.loadMotion(
            buf, buf.byteLength, null,
            onFinished, onBegan,
            this._modelSetting, group, no, this._motionConsistency
          )
          if (m) {
            m.setEffectIds(this._eyeBlinkIds, this._lipSyncIds)
            this._motions.set(name, m)
          }
        })
      this._motionManager.setReservePriority(Define.PriorityNone)
      return InvalidMotionQueueEntryHandleValue
    }

    motion.setBeganMotionHandler(onBegan)
    motion.setFinishedMotionHandler(onFinished)
    return this._motionManager.startMotionPriority(motion, false, priority)
  }

  startRandomMotion(group, priority, onFinished, onBegan) {
    if (this._modelSetting.getMotionCount(group) === 0) {
      return InvalidMotionQueueEntryHandleValue
    }
    const no = Math.floor(Math.random() * this._modelSetting.getMotionCount(group))
    return this.startMotion(group, no, priority, onFinished, onBegan)
  }

  /* ---------------------------------------------------------- */
  setExpression(expressionId) {
    const motion = this._expressions.get(expressionId)
    if (motion) this._expressionManager.startMotion(motion, false)
  }

  setRandomExpression() {
    if (this._expressions.size === 0) return
    const entries = [...this._expressions.entries()]
    const no = Math.floor(Math.random() * entries.size)
    this.setExpression(entries[no][0])
  }

  /* ---------------------------------------------------------- */
  hitTest(name, x, y) {
    if (this._opacity < 1) return false
    const count = this._modelSetting.getHitAreasCount()
    for (let i = 0; i < count; i++) {
      if (this._modelSetting.getHitAreaName(i) === name) {
        const drawId = this._modelSetting.getHitAreaId(i)
        return this.isHit(drawId, x, y)
      }
    }
    return false
  }

  /* ---------------------------------------------------------- */
  preLoadMotionGroup(group) {
    for (let i = 0; i < this._modelSetting.getMotionCount(group); i++) {
      const name = `${group}_${i}`
      const fileName = this._modelSetting.getMotionFileName(group, i)
      fetch(`${this._modelHomeDir}${fileName}`)
        .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
        .then((buf) => {
          const motion = this.loadMotion(
            buf, buf.byteLength, name,
            null, null,
            this._modelSetting, group, i, this._motionConsistency
          )
          if (motion) {
            motion.setEffectIds(this._eyeBlinkIds, this._lipSyncIds)
            if (this._motions.get(name)) ACubismMotion.delete(this._motions.get(name))
            this._motions.set(name, motion)
            this._motionCount++
          } else {
            this._allMotionCount--
          }
          if (this._motionCount >= this._allMotionCount) {
            this._state = LoadStep.LoadTexture
            this._motionManager.stopAllMotions()
            this._updating = false
            this._initialized = true
            this.createRenderer(this._ctx.canvas.width, this._ctx.canvas.height)
            this.setupTextures()
            this.getRenderer().startUp(this._ctx.gl)
            this.getRenderer().loadShaders(Define.ShaderPath)
          }
        })
    }
  }

  /* ---------------------------------------------------------- */
  draw(matrix) {
    if (!this._model) return
    if (this._state !== LoadStep.CompleteSetup) return
    matrix.multiplyByMatrix(this._modelMatrix)
    this.getRenderer().setMvpMatrix(matrix)
    this.doDraw()
  }

  doDraw() {
    if (!this._model) return
    const canvas = this._ctx.canvas
    this.getRenderer().setRenderState(this._ctx.framebuffer, [0, 0, canvas.width, canvas.height])
    this.getRenderer().drawModel(Define.ShaderPath)
  }

  /* ---------------------------------------------------------- */
  release() {
    if (this._look) {
      CubismLook.delete(this._look)
      this._look = null
    }
    if (this._updateScheduler) this._updateScheduler.release()
    super.release()
  }
}
