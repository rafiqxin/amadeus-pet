/* Reachability audit for the renderer.
 *
 * Walks the ESM import graph from index.html (including CSS `@import`) and lists
 * source files that nothing can reach. Vite does not bundle unreachable modules,
 * so dead code never reaches dist/ — but it stays in the tree and rots. Two whole
 * Cubism 5 implementations sat in src/ that way, unbuildable since the
 * `@framework` alias they needed was removed, and nobody noticed.
 *
 *     node tools/audit-reachability.mjs
 *     node tools/audit-reachability.mjs --quiet     # only the summary and orphans
 *
 * Exit code is 1 when anything is unreachable, so it can gate a workflow.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const quiet = process.argv.includes('--quiet')

const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return null // bare package or an alias we do not model
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const c of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

// Scanned separately on purpose. A single combined pattern whose middle is
// [^;]*? runs across newlines and swallows the side-effect CSS imports that
// follow a named import, which silently reports live CSS as unreachable.
const PATTERNS = [
  /(?:^|\n)\s*import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /@import\s+(?:url\()?['"]([^'"]+)['"]/g,
]

function importsOf(file) {
  const text = read(file)
  if (text == null) return []
  const out = []
  for (const re of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) out.push(m[1])
  }
  return out
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// ---- entries -------------------------------------------------------------
const html = read(path.join(ROOT, 'index.html')) || ''
const refs = [
  ...[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]),
  ...[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/g)].map((m) => m[1]),
]

const roots = []
for (const ref of refs) {
  if (/^https?:/.test(ref)) continue
  // Vite serves index.html from the repo root, so "/src/main.js" is root-relative,
  // while "./live2d.min.js" comes from public/ (publicDir is false; the vite plugin
  // copies it into dist/).
  const rel = ref.replace(/^\.?\//, '')
  const hit = [path.resolve(ROOT, rel), path.resolve(ROOT, 'public', rel)].find((c) => fs.existsSync(c))
  if (hit) roots.push(hit)
  else if (!quiet) console.log(`  (unresolved entry) ${ref}`)
}

// ---- reachability --------------------------------------------------------
const reachable = new Set()
const stack = [...roots]
while (stack.length) {
  const file = stack.pop()
  if (reachable.has(file)) continue
  reachable.add(file)
  for (const spec of importsOf(file)) {
    const target = resolveSpecifier(file, spec)
    if (target && !reachable.has(target)) stack.push(target)
  }
}

const allSrc = walk(path.join(ROOT, 'src'))
const orphans = allSrc.filter((f) => !reachable.has(f))

if (!quiet) {
  console.log('=== index.html entry points ===')
  for (const ref of refs) console.log('  ' + ref)
  console.log('')
  console.log(`=== reachable source modules: ${allSrc.length - orphans.length} ===`)
  for (const f of allSrc.filter((f) => reachable.has(f)).map((f) => path.relative(ROOT, f)).sort()) {
    console.log('  ' + f)
  }
  console.log('')
}

console.log(`=== unreachable source modules: ${orphans.length} ===`)
for (const f of orphans.map((f) => path.relative(ROOT, f)).sort()) {
  console.log(`  ${f}  (${fs.statSync(path.join(ROOT, f)).size} B)`)
}
if (!orphans.length) console.log('  (none — src/ is entirely reachable from index.html)')

process.exit(orphans.length ? 1 : 0)
