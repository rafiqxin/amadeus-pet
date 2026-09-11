import assert from 'node:assert/strict'
import http from 'node:http'

function makeWav() {
  const dataSize = 160
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24)
  buffer.writeUInt32LE(32000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

const wav = makeWav()
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.url === '/health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, output_language: 'ja' }))
    return
  }
  if (req.url === '/v1/tts' && req.method === 'POST') {
    req.resume()
    req.on('end', () => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('X-Amadeus-TTS-Engine', 'mock-kurisu')
      res.end(wav)
    })
    return
  }
  res.statusCode = 404
  res.end()
})
await new Promise((resolve) => server.listen(9882, '127.0.0.1', resolve))

try {
  globalThis.localStorage = {
    data: new Map(),
    getItem(key) { return this.data.get(key) ?? null },
    setItem(key, value) { this.data.set(key, String(value)) },
    removeItem(key) { this.data.delete(key) },
  }
  const mod = await import('../src/voice/tts-client.js')
  mod.setTtsConfig({ endpoint: 'http://127.0.0.1:9882', enabled: true })
  const health = await mod.checkTtsServer()
  assert.equal(health.ok, true)
  const generated = await mod.synthesizeTts('接続テストです。', { language: 'ja' })
  assert.equal(generated.blob.size, wav.length)
  assert.equal(generated.engine, 'mock-kurisu')

  const nativeDecoded = mod.decodeNativeAudioResponse({
    data: wav.toString('base64'),
    headers: { 'content-type': 'audio/wav', 'x-amadeus-tts-engine': 'mock-native' },
  })
  assert.equal(nativeDecoded.blob.size, wav.length)
  assert.equal(nativeDecoded.engine, 'mock-native')
  console.log(`PASS TTS transport: health + HTTP WAV + native base64 decode (${wav.length} bytes)`)
} finally {
  await new Promise((resolve) => server.close(resolve))
}
