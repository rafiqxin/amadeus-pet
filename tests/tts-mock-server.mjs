import http from 'node:http'

function makeWav() {
  const dataSize = 320
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.url === '/health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, output_language: 'ja', engine: 'mock-kurisu' }))
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
  res.end('not found')
})

server.listen(9882, '127.0.0.1', () => {
  console.log('AMA-DEUS mock TTS listening on http://127.0.0.1:9882')
})

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
