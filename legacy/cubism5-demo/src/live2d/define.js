/* App constants (port of LAppDefine) */

// Canvas logical size (CSS px)
export const CanvasSize = { width: 480, height: 640 }

export const ViewScale = 1.0
export const ViewMaxScale = 2.0
export const ViewMinScale = 0.8

export const ViewLogicalLeft = -1.0
export const ViewLogicalRight = 1.0
export const ViewLogicalBottom = -1.0
export const ViewLogicalTop = 1.0

export const ViewLogicalMaxLeft = -2.0
export const ViewLogicalMaxRight = 2.0
export const ViewLogicalMaxBottom = -2.0
export const ViewLogicalMaxTop = 2.0

// Shader path served from public/
export const ShaderPath = './Shaders/WebGL/'

// Motion groups (defined in model3.json)
export const MotionGroupIdle = 'Idle'
export const MotionGroupTapBody = 'TapBody'

// Hit area names (defined in model3.json)
export const HitAreaNameHead = 'Head'
export const HitAreaNameBody = 'Body'

// Motion priorities
export const PriorityNone = 0
export const PriorityIdle = 1
export const PriorityNormal = 2
export const PriorityForce = 3
