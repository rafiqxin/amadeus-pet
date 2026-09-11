import { Capacitor } from '@capacitor/core'

export function detectIOSRuntime({ nativePlatform = '', userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  if (String(nativePlatform || '').toLowerCase() === 'ios') return true
  if (/iPad|iPhone|iPod/i.test(String(userAgent || ''))) return true
  // iPadOS 13+ may expose a desktop-class Macintosh user agent in WKWebView.
  return String(platform || '') === 'MacIntel' && Number(maxTouchPoints || 0) > 1
}

export function nativePlatformName() {
  try { return String(Capacitor.getPlatform?.() || '') } catch { return '' }
}

export function isNativeRuntime() {
  try { return !!Capacitor.isNativePlatform?.() } catch { return nativePlatformName() !== '' && nativePlatformName() !== 'web' }
}

export function isIOSRuntime() {
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  return detectIOSRuntime({
    nativePlatform: nativePlatformName(),
    userAgent: nav.userAgent || '',
    platform: nav.platform || '',
    maxTouchPoints: nav.maxTouchPoints || 0,
  })
}

export function isNativeMobileRuntime() {
  if (isNativeRuntime()) return true
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  return /Android|iPad|iPhone|iPod/i.test(String(nav.userAgent || '')) ||
    (String(nav.platform || '') === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1)
}
