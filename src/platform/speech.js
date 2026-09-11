import { SpeechRecognition } from '@capacitor-community/speech-recognition'

export function nativeSpeechAvailablePlatform() {
  return typeof navigator !== 'undefined' && /Android|iPad|iPhone|iPod/i.test(navigator.userAgent)
}

export async function recognizeOnce({ language = 'zh-CN' } = {}) {
  if (!nativeSpeechAvailablePlatform()) throw new Error('当前平台未启用原生语音识别')
  const capability = await SpeechRecognition.available()
  if (!capability?.available) throw new Error('当前设备没有可用的系统语音识别服务')
  let permission = await SpeechRecognition.checkPermissions()
  if (permission.speechRecognition !== 'granted') permission = await SpeechRecognition.requestPermissions()
  if (permission.speechRecognition !== 'granted') throw new Error('需要麦克风/语音识别权限')
  const result = await SpeechRecognition.start({ language, maxResults: 1, partialResults: false, popup: false })
  const text = result?.matches?.[0]?.trim() || ''
  if (!text) throw new Error('没有识别到有效语音')
  return text
}

export async function stopRecognition() { try { await SpeechRecognition.stop() } catch {} }
