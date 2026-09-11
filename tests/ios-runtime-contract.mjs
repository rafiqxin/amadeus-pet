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

// Lip sync must be written where the library's update order lets it survive.
// Cubism2InternalModel.update() runs motion -> saveParam -> expression ->
// emit('beforeModelUpdate') -> model.update() (the deformation) -> loadParam(),
// so anything written from a ticker callback lands after the deformation and is
// then wiped by the next frame's loadParam(). All 18 motions in this model
// animate PARAM_MOUTH_OPEN_Y, so a late write always lost to the motion and the
// mouth only moved when the motion happened to move it.
const live2d = fs.readFileSync(new URL('../src/live2d/cubism2app.js', import.meta.url), 'utf8')
const live2dCode = live2d.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
assert.match(live2dCode, /on\('beforeModelUpdate'/,
  'mouth writes must hook the library event that fires after motion/expression and before the deformation')
assert.doesNotMatch(live2dCode, /UPDATE_PRIORITY/,
  'writing the mouth from a ticker priority lands after model.update() and does nothing')
assert.match(live2dCode, /setParam\('PARAM_MOUTH_OPEN_Y'/,
  'the lip sync parameter is PARAM_MOUTH_OPEN_Y; expressions only own MOUTH_FORM/MOUTH_SIZE')
assert.match(live2dCode, /off\('beforeModelUpdate'/,
  'the listener must be detached on reload and dispose, or a stale model keeps being driven')
assert.match(main, /const hello = await playReferenceVoice\('hello'/,
  'connect should await playback start only')
assert.doesNotMatch(main, /if \(hello\.played\) await ended/,
  'connect must not hold the app lock until ended')

// There is exactly one iOS workflow now. The three that used to exist are in
// legacy/workflows/: build-ios-call-preview.yml ran the same XCUITest suite as a
// hard gate before packaging and sat red for seven pushes, build-ios-device-
// candidate.yml produced the same IPA without releasing it, and
// call-fidelity-preview.yml triggered on a branch that no longer exists.
const workflow = fs.readFileSync(new URL('../.github/workflows/build-ios-unsigned-ipa.yml', import.meta.url), 'utf8')
assert.match(workflow, /runs-on: macos-15/,
  'the iOS build needs a macOS runner')
assert.match(workflow, /XCUITest|xcrun simctl/,
  'the simulator regression job must still be wired up')
assert.match(workflow, /xcodebuild[\s\S]*?\btest\b/,
  'the simulator job must actually run xcodebuild test')
assert.match(workflow, /continue-on-error: true/,
  'the flaky simulator suite must not be able to withhold the IPA')
assert.match(workflow, /gh release create[\s\S]*?--target/,
  'the build must publish a real release, not only an artifact')
assert.doesNotMatch(workflow, /--prerelease(?!\s*=\s*false)/,
  'a prerelease is hidden behind the Pre-releases toggle, which is why the build looked unpublished; --prerelease=false is fine')

const workflows = fs.readdirSync(new URL('../.github/workflows/', import.meta.url))
assert.deepEqual(workflows, ['build-ios-unsigned-ipa.yml'],
  'the iOS branch should carry a single workflow; superseded ones belong in legacy/workflows/')

console.log('PASS iOS runtime + primary Live2D interaction contract')
console.log('PASS connect lock contract: hello does not wait for ended')
console.log('PASS CI carries one non-blocking simulator suite that cannot withhold the release')
