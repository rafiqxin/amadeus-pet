import assert from 'node:assert/strict'
import fs from 'node:fs'
import { detectIOSRuntime } from '../src/platform/runtime.js'

const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const ipadMobileUA = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const ipadDesktopUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

assert.equal(detectIOSRuntime({ nativePlatform: 'ios', userAgent: ipadDesktopUA }), true)
assert.equal(detectIOSRuntime({ userAgent: iphoneUA }), true)
assert.equal(detectIOSRuntime({ userAgent: ipadMobileUA }), true)
assert.equal(detectIOSRuntime({ userAgent: ipadDesktopUA, platform: 'MacIntel', maxTouchPoints: 5 }), true)
assert.equal(detectIOSRuntime({ userAgent: ipadDesktopUA, platform: 'MacIntel', maxTouchPoints: 0 }), false)

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
assert.match(main, /onTap:\s*\(\{ hit \}\)\s*=>\s*\{[\s\S]*lastPrimaryTapAt/,
  'Cubism onTap must be the primary path on iOS too')
assert.doesNotMatch(main, /if\s*\(!isIOS\)\s*void playTouch/,
  'iOS must not disable Cubism onTap')
assert.match(main, /pointHit\(event\.clientX, event\.clientY\)/,
  'stage fallback must be coordinate/hit-test based')
assert.doesNotMatch(main, /target === stage \|\| target === canvas/,
  'stage fallback must not depend on exact DOM target identity')
assert.match(main, /const hello = await playReferenceVoice\('hello'/,
  'connect should await playback start only')
assert.doesNotMatch(main, /if \(hello\.played\) await ended/,
  'connect must not hold the app lock until ended')

const workflow = fs.readFileSync(new URL('../.github/workflows/build-ios-call-preview.yml', import.meta.url), 'utf8')
assert.match(workflow, /WKWebView XCUITest/)
assert.match(workflow, /xcodebuild[\s\S]*test/)

console.log('PASS iOS runtime + primary Live2D interaction contract')
console.log('PASS connect lock contract: hello does not wait for ended')
console.log('PASS CI contract includes Simulator/WKWebView XCUITest')
