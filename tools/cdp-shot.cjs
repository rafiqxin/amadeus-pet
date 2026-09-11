// Screenshot / DOM probe for a running Electron app over the DevTools protocol.
// Usage: node tools/cdp-shot.cjs [port] [out.png] [expression]
// Relies on Node's built-in global WebSocket (Node >= 22) instead of the `ws`
// package, so it needs no dependencies of its own.
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.argv[2] || '9223'
const OUT = process.argv[3] || 'preview/shot.png'
const EXPR = process.argv[4] || ''

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

;(async () => {
  const list = await get('/json/list')
  const page = list.find((t) => t.type === 'page')
  if (!page) {
    console.log('NO PAGE — targets:', list.map((t) => t.type).join(','))
    process.exit(1)
  }
  console.log('page:', page.url)
  console.log('title:', page.title)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })

  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data)
    if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id) }
  }
  const send = (method, params = {}) =>
    new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })

  const probe = EXPR || `JSON.stringify({
    inner: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    phone: (() => { const p = document.querySelector('#phone'); return p ? [Math.round(p.getBoundingClientRect().width), Math.round(p.getBoundingClientRect().height)] : null })(),
    canvas: (() => { const c = document.querySelector('#l2d-canvas'); return c ? [c.width, c.height] : null })(),
    status: (document.querySelector('.chat-status') || {}).textContent || null,
    bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200)
  })`
  const ev = await send('Runtime.evaluate', { expression: probe, returnByValue: true, awaitPromise: true })
  console.log('dom:', ev.result?.result?.value ?? JSON.stringify(ev.result))

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  if (!shot.result?.data) {
    console.log('SHOT FAIL', JSON.stringify(shot).slice(0, 400))
    process.exit(1)
  }
  const out = path.resolve(OUT)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log('wrote', out, fs.statSync(out).size, 'bytes')

  ws.close()
  process.exit(0)
})().catch((e) => { console.log('ERR', e.message); process.exit(1) })
