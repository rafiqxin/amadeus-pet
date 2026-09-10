#!/usr/bin/env python3
from pathlib import Path


def replace_required(text: str, old: str, new: str, label: str, count: int = 1) -> str:
    if old not in text:
        raise SystemExit(f'{label} not found')
    return text.replace(old, new, count)


main = Path('src/main.js')
s = main.read_text()

s = replace_required(
    s,
    "import { speak, voiceAvailable, matchReferenceVoice } from './pet/voice.js'",
    "import { speak, voiceAvailable, matchReferenceVoice, playReferenceVoice } from './pet/voice.js'",
    'voice import',
)
s = replace_required(
    s,
    "import { mountMobileUi } from './ui/mobile.js'",
    "import { mountMobileUi } from './ui/mobile.js'\nimport { nextTouchReaction } from './pet/touch-reactions.js'",
    'touch reaction import',
)
s = replace_required(
    s,
    "const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)",
    "const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)\n  const isAndroid = /Android/i.test(navigator.userAgent)\n  const isMobile = isIOS || isAndroid",
    'mobile platform detection',
)
s = replace_required(
    s,
    "document.body.classList.toggle('mobile-ios', isIOS)",
    "document.body.classList.toggle('mobile-ios', isIOS)\n  document.body.classList.toggle('mobile-android', isAndroid)\n  document.body.classList.toggle('mobile-native', isMobile)",
    'mobile classes',
)
s = replace_required(
    s,
    "if (isIOS) {\n      const r = stage.getBoundingClientRect()",
    "if (isMobile) {\n      const r = stage.getBoundingClientRect()",
    'mobile viewport',
)
s = replace_required(
    s,
    "const mobileUi = isIOS ? mountMobileUi",
    "const mobileUi = isMobile ? mountMobileUi",
    'mobile UI mount',
)
s = replace_required(
    s,
    "onVoiceState() { hud.sysLog('iOS 语音输入已停用；将在 Android 版本接入') }",
    "onVoiceState(listening) { hud.sysLog(isAndroid ? (listening ? 'Android 语音识别：正在收音' : 'Android 语音识别：已停止') : 'iOS 语音输入已停用') }",
    'voice state hook',
)
s = replace_required(
    s,
    "hud.sysLog(isIOS ? 'iOS：仅匹配原版语音反应；未命中时保持纯文字' : '语音模块初始化完成')",
    "hud.sysLog(isAndroid ? 'Android：语音输入已启用；原版 OGG 反应可用' : (isIOS ? 'iOS：仅匹配原版语音反应；未命中时保持纯文字' : '语音模块初始化完成'))",
    'voice startup log',
)
s = replace_required(
    s,
    "if (isIOS) {\n    let resizeTimer",
    "if (isMobile) {\n    let resizeTimer",
    'mobile resize hook',
)

helper_needle = "  let modelTapHandled = false\n"
helper = """  function runTouchReaction(hit) {
    const touch = nextTouchReaction(hit?.area || 'body')
    if (!touch) return
    const target = hit?.model || pet
    try { target?.setExpression?.(touch.expression) } catch {}
    try { target?.startRandomMotion?.(touch.motion, Define.PriorityForce) } catch {}

    if (!consoleOpen) bubble.say(touch.text, 2800)
    hud.aiLog(touch.text)
    hud.setCallSubtitle(touch.text)
    hud.rineHer(touch.text, { read: true, quick: true })

    const voiceOn = settings.get('voice') !== false
    const res = voiceOn ? playReferenceVoice(touch.voice, {
      onLevel: (level) => pet?.setMouthOpen(level),
      onEnd: () => pet?.setMouthOpen(0),
    }) : { played: false }
    if (!res.played) pet?.setMouthOpen(0)
    window.__amaLastTouch = { ...touch, voicePlayed: !!res.played }
  }

  let modelTapHandled = false
"""
s = replace_required(s, helper_needle, helper, 'modelTapHandled hook')

old_tap = """    onTap({ hit }) {
      if (!hit) return
      modelTapHandled = true
      if (hit.area === 'head' || hit.area === 'mouth') hit.model.setRandomExpression()
      else hit.model.startRandomMotion(Define.MotionGroupTapBody, Define.PriorityNormal)
      sayLine(dialogue.clickLine())
    },
"""
new_tap = """    onTap({ hit }) {
      if (!hit) return
      modelTapHandled = true
      runTouchReaction(hit)
    },
"""
s = replace_required(s, old_tap, new_tap, 'Live2D tap handler')

old_fallback = """    onClick() {
      if (modelTapHandled) { modelTapHandled = false; return }
      sayLine(dialogue.clickLine())
    },
"""
new_fallback = """    onClick() {
      if (modelTapHandled) { modelTapHandled = false; return }
      runTouchReaction({ area: 'body', model: pet })
    },
"""
s = replace_required(s, old_fallback, new_fallback, 'stage click handler')
main.write_text(s)

mobile_css = Path('src/ui/mobile.css')
css = mobile_css.read_text()
if 'body.mobile-ios' not in css:
    raise SystemExit('mobile-ios CSS selector not found')
mobile_css.write_text(css.replace('body.mobile-ios', 'body.mobile-native'))

voice = Path('src/pet/voice.js')
v = voice.read_text()
v = replace_required(
    v,
    "const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)",
    "const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)\nconst isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)\nconst isNativeMobile = isIOS || isAndroid",
    'native mobile voice detection',
)
v = replace_required(v, 'if (isIOS) {', 'if (isNativeMobile) {', 'native OGG playback gate')
v = replace_required(v, 'return isIOS || ready', 'return isNativeMobile || ready', 'native voice availability')
if 'export function playReferenceVoice(' not in v:
    v += """

// Deterministic playback path for direct touch reactions. Unlike speak(),
// this uses the bundled OGG id directly and therefore never depends on
// semantic matching, TTS availability, SpeechRecognizer or network access.
export function playReferenceVoice(file, opts = {}) {
  const line = REF.find((item) => item.file === String(file || ''))
  if (!line) {
    opts.onLevel?.(0)
    opts.onEnd?.()
    return { duration: 0, matched: null, played: false }
  }
  return playReference(line, opts)
}
"""
voice.write_text(v)

print('Android renderer adaptation complete: mobile UI + deterministic touch OGG path')
