import assert from 'node:assert/strict'
import fs from 'node:fs'

// Source contract for the CONNECTION sheet.
//
// Measured before the fix, at 393x852 with the boot flow complete:
//   .mobile-api-sheet   clientHeight 476, scrollHeight 601, overflow-y visible
//   .mobile-api-actions top 879, bottom 923   (viewport is 883 tall)
//   document.elementFromPoint(centre of 保存) -> null
// The sheet could be filled in but never submitted: its content is ~125px taller
// than `min(56vh, 520px)`, and with `overflow: visible` the surplus spilled past
// the bottom of the screen with nothing able to scroll to it.
//
// The fix is that the sheet scrolls. The confirm row deliberately stays in normal
// flow at the end of the content: it is reached by scrolling (or by dragging the
// sheet), the way every other field is. An earlier revision pinned it with
// `position: sticky` plus a gradient cover, which the user rejected on device as
// a floating bar that covered the field above it.
//
// Real WKWebView interaction lives in ios-tests/, executed on a Simulator by CI.

const css = fs.readFileSync(new URL('../src/ui/mobile.css', import.meta.url), 'utf8')
const js = fs.readFileSync(new URL('../src/ui/mobile.js', import.meta.url), 'utf8')

const sheetRule = css.match(/body\.mobile-ios \.mobile-sheet\s*\{[\s\S]*?\n\}/)
assert.ok(sheetRule, 'body.mobile-ios .mobile-sheet rule must exist')
assert.match(sheetRule[0], /overflow-y:\s*auto/,
  'the sheet must scroll: its content is taller than max-height, and with overflow:visible the confirm row lands off-screen')
assert.match(sheetRule[0], /max-height:\s*min\(56vh, 520px\)/,
  'the sheet height budget is part of the contract; changing it changes how much has to scroll')
assert.match(sheetRule[0], /overflow-anchor:\s*none/,
  'voice diagnostics rewrite their line even while the sheet is closed; scroll anchoring must not move the sheet')

// The confirm row must NOT be pinned. Keeping it in flow is the requested design.
assert.doesNotMatch(css, /\.mobile-api-actions\s*\{[^}]*position:\s*sticky/,
  'the confirm row was un-pinned on purpose; it belongs in normal flow at the end of the sheet')

assert.match(js, /sheet\.scrollTop = 0/,
  'opening a sheet must reset it to the top; CONNECTION has four fields above the confirm row')
assert.match(js, /data-mobile-act="save-api"/, 'the 保存 action must remain wired')
assert.match(js, /data-mobile-act="save-test-api"/, 'the 保存并测试 action must remain wired')

console.log('PASS CONNECTION sheet scrolls to its confirm row (no pinned overlay)')
