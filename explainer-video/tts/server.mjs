// 豆包语音合成 2.0 本地试听页。Key 取自 DOUBAO_API_KEY 或 macOS 钥匙串，不下发给浏览器。
//   node server.mjs   # 然后打开 http://127.0.0.1:8765
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const PORT = Number(process.env.PORT || 8765)
let KEY = process.env.DOUBAO_API_KEY
if (!KEY) {
  try {
    KEY = execFileSync('security', ['find-generic-password', '-s', 'doubao-tts-api-key', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    console.error('缺少豆包 key：设置 DOUBAO_API_KEY，或存入钥匙串 security add-generic-password -U -a "$USER" -s doubao-tts-api-key -w')
    process.exit(1)
  }
}
const HTML = new URL('./index.html', import.meta.url)

async function synth({ text, speaker, context, speechRate }) {
  const req_params = {
    text,
    speaker,
    audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Number(speechRate) || 0 },
  }
  if (context) req_params.additions = JSON.stringify({ context_texts: [context] })
  const res = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
    method: 'POST',
    headers: {
      'X-Api-Key': KEY,
      'X-Api-Resource-Id': 'seed-tts-2.0',
      'X-Api-Request-Id': randomUUID(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user: { uid: 'tts-playground' }, req_params }),
  })
  const raw = await res.text()
  const logid = res.headers.get('x-tt-logid')
  if (!res.ok) throw new Error(`HTTP ${res.status} logid=${logid}: ${raw.slice(0, 500)}`)
  const chunks = []
  for (const line of raw.split('\n')) {
    const s = line.replace(/^data:\s*/, '').trim()
    if (!s.startsWith('{')) continue
    const msg = JSON.parse(s)
    if (msg.code !== 0 && msg.code !== 20000000) throw new Error(`code=${msg.code} logid=${logid}: ${msg.message}`)
    if (msg.data) chunks.push(Buffer.from(msg.data, 'base64'))
  }
  if (!chunks.length) throw new Error(`no audio logid=${logid}: ${raw.slice(0, 300)}`)
  return Buffer.concat(chunks)
}

createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(readFileSync(HTML))
  }
  if (req.method === 'POST' && req.url === '/api/tts') {
    let body = ''
    for await (const c of req) body += c
    const t0 = Date.now()
    try {
      const audio = await synth(JSON.parse(body))
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'X-Latency-Ms': String(Date.now() - t0) })
      return res.end(audio)
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end(e.message)
    }
  }
  res.writeHead(404).end()
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}`))
