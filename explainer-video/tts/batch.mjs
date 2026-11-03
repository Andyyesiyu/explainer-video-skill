// 通过本地 server.mjs 批量合成：[RATE=20] [CONTEXT=...] node batch.mjs <speaker> [prefix]
// RATE 即 speech_rate，范围 [-50,100]，100 为 2 倍速
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const speaker = process.argv[2]
const prefix = process.argv[3] || speaker
if (!speaker) {
  console.error('用法：node batch.mjs <speaker> [prefix]')
  process.exit(1)
}

const LINES = [
  ['cloud', '我们用 Kubernetes 部署了一个 gRPC 服务，通过 Envoy sidecar 做 mTLS，QPS 峰值大概 3.5k，P99 latency 控制在 120ms 以内。'],
  ['agent', 'AgentServer 通过 JSON-RPC 暴露 thread/start 和 turn/start，底层 runtime 可以是 Claude Code、Codex 或者 Gemini CLI，前端用 React 渲染。'],
  ['cli', '先跑 pnpm install，再执行 pnpm --filter web exec vitest run，CI 在 GitHub Actions 上大概要 8 分钟。'],
  ['models', 'GPT-5、Claude Opus 4.5 和 Gemini 3 Pro 在 SWE-bench Verified 上的差距已经不到 5 个点，Qwen3-Coder 也追得很紧。'],
  ['abbr', 'SDK、API、CLI、MR、PR、CI/CD、OOM、SLA、TPM、RPM 这些缩写，模型能不能逐个字母读对？'],
  ['long', '首轮 Router 失败或者返回非法结果时，server 会在本地 fallback 到一个 default model 或者 queue 不超过 50 的模型，并把 degrade_reason 写进 observability event 里上报。'],
  ['intro', '大家好。这个视频用几分钟，讲两件事。'],
  ['mixed', 'packages 目录是平台本身：前端 web，后端主服务 server，跑在沙箱里的 runner，以及负责把流量转发到 runner 的 portal 和 proxy。'],
  ['numbers', '第一步过滤候选：有图片就只保留多模态模型，剩余额度低于百分之五的直接剔除。'],
  ['logic', '如果当前用的是弱模型，分数够高、或者预测用户可能不满意，就升级到强模型；'],
]

const OUT = resolve('samples') + '/'
mkdirSync(OUT, { recursive: true })
for (const [id, text] of LINES) {
  const res = await fetch('http://127.0.0.1:8765/api/tts', {
    method: 'POST',
    body: JSON.stringify({ text, speaker, context: process.env.CONTEXT || '', speechRate: process.env.RATE || 0 }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    console.error(`${id}: ${res.status} ${await res.text()}`)
    continue
  }
  writeFileSync(`${OUT}${prefix}_${id}.mp3`, Buffer.from(await res.arrayBuffer()))
  console.log(`${id}: ok ${res.headers.get('X-Latency-Ms')}ms`)
}
