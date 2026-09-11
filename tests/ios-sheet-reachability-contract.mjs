import assert from 'node:assert/strict'
import fs from 'node:fs'

// Source contract for the CONNECTION sheet's confirm row.
//
// Measured before the fix, at 393x852 with the boot flow complete:
//   .mobile-api-sheet   clientHeight 476, scrollHeight 601, overflow-y visible
//   .mobile-api-actions top 879, bottom 923   (viewport is 883 tall)
//   document.elementFromPoint(centre of 保存) -> null
// The sheet could be filled in but never submitted: its content is ~125px taller
// than `min(56vh, 520px)`, and with `overflow: visible` the surplus spilled past
// the bottom of the screen with nothing able to scroll to it.
//
// Two rules keep the row reachable, and both are load-bearing:
//   1. the sheet scrolls, so the fields above the row can be brought into view
//   2. the row is sticky, so 保存 is reachable at any scroll position, including
//      while the on-screen keyboard squeezes the sheet
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

const actionsRule = css.match(/body\.mobile-ios \.mobile-api-sheet \.mobile-api-actions\s*\{[\s\S]*?\n\}/)
assert.ok(actionsRule, 'the iOS API-sheet confirm row needs its own rule')
assert.match(actionsRule[0], /position:\s*sticky/,
  'the confirm row must stay reachable at every scroll position, not only at the bottom')
assert.match(actionsRule[0], /bottom:\s*calc\(18px \+ env\(safe-area-inset-bottom\)\)/,
  'the sticky offset must match the sheet padding so the resting layout is unchanged')
assert.match(actionsRule[0], /z-index:\s*2/,
  'the confirm row must paint above the fields it covers while stuck')

assert.match(js, /sheet\.scrollTop = 0/,
  'opening a sheet must reset it to the top; CONNECTION has four fields above the confirm row')
assert.match(js, /data-mobile-act="save-api"/, 'the 保存 action must remain wired')
assert.match(js, /data-mobile-act="save-test-api"/, 'the 保存并测试 action must remain wired')

console.log('PASS CONNECTION sheet confirm row stays reachable (scrollable sheet + sticky actions)')
