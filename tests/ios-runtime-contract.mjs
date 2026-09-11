import assert from 'node:assert/strict'
import fs from 'node:fs'
import { detectIOSRuntime } from '../src/platform/runtime.js'

const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const ipadMobileUA = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const ipadDesktopUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

assert.equal(detectIOSRuntime({ nativePlatform: 'ios', userAgent: ipadDesktopUA }), true,
  'Capacitor native platform must identify iPadOS even with Macintosh UA')
assert.equal(detectIOSRuntime({ userAgent: iphoneUA }), true, 'iPhone UA must identify iOS')
assert.equal(detectIOSRuntime({ userAgent: ipadMobileUA }), true, 'mobile iPad UA must identify iOS')
assert.equal(detectIOSRuntime({ userAgent: ipadDesktopUA, platform: 'MacIntel', maxTouchPoints: 5 }), true,
  'desktop-class iPad UA must identify iOS via MacIntel + touch points')
assert.equal(detectIOSRuntime({ userAgent: ipadDesktopUA, platform: 'MacIntel', maxTouchPoints: 0 }), false,
  'real macOS without touch must not be classified as iOS')

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
assert.match(main, /isIOSRuntime\(\)/, 'iOS renderer must use runtime detection, not UA-only sniffing')
assert.match(main, /mountIosStageTapFallback/, 'iOS renderer must install a stage tap fallback')
assert.match(main, /mountIosCallTranscriptScroll/, 'iOS renderer must install transcript scrolling')
assert.doesNotMatch(main, /const isIOS = \/iPad\|iPhone\|iPod\//,
  'iOS renderer must not regress to UA-only detection')

const workflow = fs.readFileSync(new URL('../.github/workflows/build-ios-call-preview.yml', import.meta.url), 'utf8')
assert.match(workflow, /"preferredContentMode": "mobile"/,
  'Capacitor iOS shell must force mobile content mode on iPad')
assert.match(workflow, /"appendUserAgent": "AMA-DEUS-iOS"/,
  'Capacitor iOS shell must carry an explicit app UA marker')

console.log('PASS iOS runtime detection contract: iPhone + iPad mobile UA + iPad desktop UA')
console.log('PASS iOS renderer contract: stage tap + transcript scroll are mounted through native iOS detection')
console.log('PASS Capacitor contract: preferredContentMode=mobile + AMA-DEUS-iOS UA marker')
