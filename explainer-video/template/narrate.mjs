// script.json → narration audio + src/timeline.json (scene/beat times, word timestamps, captions).
//   node narrate.mjs                 uses script.json's size
//   node narrate.mjs --size 1080x1920
//   node narrate.mjs --requests 2       start from 2 requests instead of 1 (split at scene boundaries)
//   node narrate.mjs --no-voice         no TTS (no key needed): lines are timed at a reading pace, the
//                                       narration track is silence and the captions carry the words.
//                                       Same as "voice": "none" in script.json.
// Key: DOUBAO_API_KEY, else macOS Keychain item `doubao-tts-api-key`. Clips are cached in build/audio
// by hash of voice + rate + context + text. The whole script goes out as ONE request so intonation carries
// across sentences and scenes, and that clip is played whole; lines and scenes are only time marks in it.
// If the service rejects that (too long), the script is split at scene boundaries into 2, then 3 requests.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const scriptText = readFileSync('script.json', 'utf8')
const S = JSON.parse(scriptText)
const SIZE = arg('--size', S.size ?? '1920x1080')
const [W, H] = SIZE.split('x').map(Number)
const VOICE = S.voice ?? 'zh_female_xiaohe_uranus_bigtts'
const RATE = S.rate ?? 20
// No-voice mode: nothing is synthesised. Each line lasts as long as it takes to read its caption at
// READ_CPS characters per second (script.json "readRate" overrides), plus a short pause at punctuation,
// and never less than MIN_LINE seconds.
const NO_VOICE = process.argv.includes('--no-voice') || S.voice === 'none'
const READ_CPS = S.readRate ?? 5.5, MIN_LINE = 1.2, COMMA = 0.15, STOP = 0.3
// `--redo id1,id2`: synthesise the runs containing these beats again, ignoring the cache.
const REDO = arg('--redo', '').split(',').filter(Boolean)
// Extra takes tried when a run is flagged by audioIssues.
const RETAKES = 2
// Delivery instruction sent with every request. BASE_CONTEXT is the user's chosen narration style and is
// always sent; script.json's optional `context` is appended to it for this video only, never replacing it.
const BASE_CONTEXT = '像科技博主给朋友做评测一样，语气自然、节奏紧凑、语速适中，吐字清楚。中英文混读要连贯，英文词融入中文语流，不要在英文前后停顿。句与句之间停顿要短，不拖音，讲到关键结论时加重语气，但不要放慢或长停顿。'
const CONTEXT = BASE_CONTEXT + (S.context ?? '')
// Silence before a scene's first line, between lines, and after its last line. Consecutive spoken
// lines are synthesised as one request, so GAP only applies around silent beats. Chapter boundaries
// stay tight (CUT_LEAD + CUT_TAIL, on top of the clips' own edge silence): a pause between scenes reads
// as dead air and costs viewers. LEAD/TAIL only open and close the whole video.
const LEAD = 0.3, GAP = 0.12, TAIL = 0.15, CUT_LEAD = 0, CUT_TAIL = 0.05
// Caption line width in units (CJK = 1, ASCII ≈ 0.55); narrower in portrait. Must stay below what the
// caption box in lib.tsx fits on one line (portrait ≈ 17.6, landscape ≈ 36), or the renderer re-wraps it.
const CAPTION_MAX = H > W ? 16 : 22

mkdirSync('build/audio', { recursive: true })
const ids = S.scenes.flatMap((s) => s.beats.map((b) => b.id))
const dup = ids.find((id, i) => ids.indexOf(id) !== i)
if (dup) throw new Error(`beat id "${dup}" is used twice; beat ids must be unique across the script`)

const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())

let apiKey = process.env.DOUBAO_API_KEY
function doubaoKey() {
  if (apiKey) return apiKey
  try {
    apiKey = execFileSync('security', ['find-generic-password', '-s', 'doubao-tts-api-key', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    throw new Error('缺少豆包 key：设置 DOUBAO_API_KEY，或存入钥匙串 security add-generic-password -U -a "$USER" -s doubao-tts-api-key -w；没有 key 时用 node narrate.mjs --no-voice 生成无配音版本，不要换成系统自带语音')
  }
  return apiKey
}

// Writes `<base>.mp3` and `<base>.words.json` ([{ w, s, e }], seconds from clip start, already scaled
// by speech_rate). `enable_subtitle` must sit in audio_params; elsewhere `words` comes back empty.
async function tts(text, base) {
  const res = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
    method: 'POST',
    headers: {
      'X-Api-Key': doubaoKey(),
      'X-Api-Resource-Id': 'seed-tts-2.0',
      'X-Api-Request-Id': randomUUID(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user: { uid: 'explainer-video' },
      req_params: {
        text,
        speaker: VOICE,
        audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: RATE, enable_subtitle: true },
        additions: JSON.stringify({ context_texts: [CONTEXT] }),
      },
    }),
    signal: AbortSignal.timeout(300_000),
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`TTS HTTP ${res.status} logid=${res.headers.get('x-tt-logid')}: ${raw.slice(0, 300)}`)
  const chunks = [], words = []
  for (const line of raw.split('\n')) {
    const s = line.replace(/^data:\s*/, '').trim()
    if (!s.startsWith('{')) continue
    const msg = JSON.parse(s)
    if (msg.code !== 0 && msg.code !== 20000000) throw new Error(`TTS code=${msg.code}: ${msg.message}`)
    if (msg.data) chunks.push(Buffer.from(msg.data, 'base64'))
    for (const w of msg.sentence?.words ?? []) words.push({ w: w.word, s: w.startTime, e: w.endTime })
  }
  if (!chunks.length) throw new Error(`TTS returned no audio for: ${text}`)
  writeFileSync(`${base}.mp3`, Buffer.concat(chunks))
  writeFileSync(`${base}.words.json`, JSON.stringify(words))
}

// `take` > 0 asks for another synthesis of the same text (the model is not deterministic); `fresh`
// ignores the cache for this take.
async function speak(text, take = 0, fresh = false) {
  const key = `${VOICE}|${RATE}|${CONTEXT}|${text}${take ? `|take ${take}` : ''}`
  const base = `build/audio/${createHash('sha1').update(key).digest('hex').slice(0, 16)}`
  if (fresh || !existsSync(`${base}.mp3`) || !existsSync(`${base}.words.json`)) {
    process.stdout.write(`  tts: ${text}\n`)
    await tts(text, base)
    writeFileSync(`${base}.txt`, key)
  }
  return { audio: `${base}.mp3`, dur: probe(`${base}.mp3`), words: JSON.parse(readFileSync(`${base}.words.json`, 'utf8')) }
}

// RMS per 10 ms, decoded to 16 kHz mono.
function envelope(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1'], { maxBuffer: 1 << 28 })
  const pcm = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length))
  const out = []
  for (let i = 0; i < pcm.length; i += 160) {
    const n = Math.min(160, pcm.length - i)
    let s = 0
    for (let j = 0; j < n; j++) s += pcm[i + j] ** 2
    out.push(Math.sqrt(s / n))
  }
  return out
}

// Quiet stretches of an envelope as [startFrame, endFrame) pairs; quiet = under 5% of speech level.
function silences(env, loud) {
  const out = []
  let s = -1
  env.forEach((v, i) => {
    if (v < loud * 0.05) { if (s < 0) s = i }
    else if (s >= 0) { out.push([s, i]); s = -1 }
  })
  if (s >= 0) out.push([s, env.length])
  return out
}

// The parts of a clip that are played, as [from, to] in clip seconds. TTS clips come with their own
// lead-in and tail silence, and the model sometimes holds 0.4s+ between sentences; left in, these read
// as dead air. Lead-in and tail are cut to EDGE, and any silence inside longer than MAX_GAP is cut to
// MAX_GAP by dropping its middle. Only silence is removed, so the voice itself is untouched.
const EDGE = 0.05, MAX_GAP = 0.2
function keep(a, dur) {
  const q = a.quiet, n = a.env.length
  const head = q[0]?.[0] === 0 ? Math.max(0, q[0][1] * 0.01 - EDGE) : 0
  const tail = q.at(-1)?.[1] === n && q.at(-1)[0] > 0 ? Math.min(dur, q.at(-1)[0] * 0.01 + EDGE) : dur
  if (tail <= head) return [[0, dur]]
  const segs = []
  let from = head
  for (const [qs, qe] of q) {
    const s = qs * 0.01, e = qe * 0.01
    if (s <= head || e >= tail || e - s <= MAX_GAP) continue
    segs.push([from, s + MAX_GAP / 2])
    from = e - MAX_GAP / 2
  }
  segs.push([from, tail])
  return segs
}
// Clip time → time in the played audio (cut parts collapse to the point where they were cut).
const played = (segs) => (t) => segs.reduce((k, [a, b]) => k + Math.max(0, Math.min(t, b) - a), 0)

// Glitches in a synthesised run. Its audio is played whole, never cut, so what is left to catch is the
// model itself stalling (a long silence between two sounds) or the clip ending mid-sound.
const STALL = 1.0
function audioIssues(a) {
  const issues = []
  for (const [s, e] of a.quiet) {
    if (s > 0 && e < a.env.length && (e - s) * 0.01 > STALL) issues.push(`${((e - s) * 0.01).toFixed(2)}s silence at ${(s * 0.01).toFixed(2)}s`)
  }
  if ((a.env.at(-2) ?? 0) > a.loud * 0.1) issues.push('audio still sounding at the end of the clip')
  return issues
}

// Words carry trailing punctuation ("型，") and English loses its spaces, so matching runs on this form.
const norm = (s) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
const width = (s) => [...s].reduce((n, c) => n + (c.codePointAt(0) < 0x80 ? 0.55 : 1), 0)
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const ascii = (c) => c !== undefined && c.codePointAt(0) < 0x80 && c !== ' '
// Breaks an over-long clause into lines of at most CAPTION_MAX at the most even word boundary, so no
// line is a one- or two-character stub. Never splits inside an ASCII token (fork-and-flush, 0.47) and
// never starts a line with punctuation or a particle that belongs to the previous word (了、的、着…).
function wrapClause(text) {
  if (width(text) <= CAPTION_MAX) return [text]
  const cuts = []
  let at = 0
  for (const { segment } of segmenter.segment(text)) {
    at += segment.length
    if (at < text.length && !(ascii(text[at - 1]) && ascii(text[at])) && !/^[\p{P}了的地得着过吗呢吧啊们]/u.test(text.slice(at))) cuts.push(at)
  }
  let best = -1, score = Infinity
  for (const c of cuts) {
    const l = text.slice(0, c).trim(), r = text.slice(c).trim()
    const midAscii = ascii(l.at(-1)) && ascii(r[0]) ? 6 : 0
    const over = Math.max(0, width(l) - CAPTION_MAX, width(r) - CAPTION_MAX) * 10
    const s = Math.abs(width(l) - width(r)) + midAscii + over - (/[、，]$/.test(l) ? 2 : 0)
    if (s < score) [best, score] = [c, s]
  }
  if (best < 0) return [text]
  return [...wrapClause(text.slice(0, best).trim()), ...wrapClause(text.slice(best).trim())]
}
// Caption chunks: whole clauses packed onto one line; a clause longer than a line becomes chunks of two
// balanced lines joined by "\n".
function splitCaption(text) {
  const out = []
  let cur = ''
  for (const part of text.split(/(?<=[，。！？；：,!?;:])/).map((p) => p.trim()).filter(Boolean)) {
    if (width(part) > CAPTION_MAX) {
      if (cur) out.push(cur)
      cur = ''
      const lines = wrapClause(part)
      for (let i = 0; i < lines.length; i += 2) out.push(lines.slice(i, i + 2).join('\n'))
    } else if (cur && width(cur + part) > CAPTION_MAX) {
      out.push(cur)
      cur = part
    } else {
      cur += part
    }
  }
  if (cur) out.push(cur)
  return out
}
// Chunk times from word timestamps; null when `sub` and `say` split differently (width share is used).
function wordTimes(say, words, count) {
  const chunks = splitCaption(say)
  if (!words.length || chunks.length !== count) return null
  const stream = words.flatMap((w) => norm(w.w).split('').map(() => w))
  if (stream.length !== norm(say).length) return null
  let i = 0
  return chunks.map((c) => {
    const k = norm(c).length
    const t = [stream[i].s, stream[i + k - 1].e]
    i += k
    return t
  })
}

// Consecutive spoken beats form one run; a silent beat stands alone.
function runs(list) {
  const out = []
  for (const b of list) {
    const last = out.at(-1)
    if (b.say && last?.[0].say) last.push(b)
    else out.push([b])
  }
  return out
}

// Marks where each beat starts inside a run's clip. The audio itself is not cut: these marks only time
// animations and captions. Word timestamps can be off (a word squeezed to 0.03s, then a 1s gap), so a
// mark sits in the middle of the longest real silence between the two beats, not between their stamps.
// Marks and word times come back in played time (`keep` cuts long silences); word times are relative
// to their beat's mark, and the run's first and last marks are where its played audio starts and ends.
function markRun(run, n, a, segs) {
  const at = played(segs), head = segs[0][0], tail = segs.at(-1)[1]
  const owner = n.words.flatMap((w, i) => norm(w.w).split('').map(() => i))
  const lens = run.map((b) => norm(b.say).length)
  const total = lens.reduce((a, l) => a + l, 0)
  if (owner.length !== total) {
    throw new Error(`TTS word timestamps cover ${owner.length} chars but the text has ${total}; cannot split: ${run.map((b) => b.id).join(', ')}`)
  }
  let c = 0
  const first = lens.map((l) => {
    const i = owner[c]
    c += l
    return i
  })
  const mark = (i) => {
    const prev = n.words[i - 1], next = n.words[i], after = n.words[i + 1] ?? next
    const lo = Math.round(prev.s / 0.01), hi = Math.round(Math.max(after.s, next.e) / 0.01)
    let gap
    for (const [s, e] of a.quiet) {
      const len = Math.min(e, hi) - Math.max(s, lo)
      if (len > 0 && (!gap || len > gap.len)) gap = { len, t: ((Math.max(s, lo) + Math.min(e, hi)) / 2) * 0.01 }
    }
    return gap ? gap.t : (prev.e + next.s) / 2
  }
  const marks = [head, ...first.slice(1).map(mark), tail].map(at)
  return run.map((b, k) => {
    const from = marks[k], to = marks[k + 1]
    const words = n.words.slice(first[k], first[k + 1] ?? n.words.length)
      .map((w) => ({ w: w.w, s: Math.max(0, at(w.s) - from), e: Math.max(0, at(w.e) - from) }))
    return { b, from, to, words }
  })
}

// No-voice stand-in for synth(): word times from reading pace, no audio. A CJK character takes one
// unit, a Latin word or number about half a unit per letter (at least one), punctuation adds a pause.
function readRun(run) {
  let t = 0
  const parts = run.map((b) => {
    const from = t, words = []
    let s = 0
    // A Latin word or number is one token (0.47, GPT-5, 3.5k); any other letter (a CJK character) is one.
    for (const tok of b.say.match(/[A-Za-z0-9\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F.%+\-]*|./gu) ?? []) {
      if (/^[\p{L}\p{N}]/u.test(tok)) {
        const units = tok.length === 1 && !ascii(tok) ? 1 : Math.max(1, width(tok) * 0.9)
        const d = units / READ_CPS
        words.push({ w: tok, s, e: s + d })
        s += d
      } else if (/[，、；：,;:]/.test(tok)) s += COMMA
      else if (/[。！？.!?]/.test(tok)) s += STOP
      else if (words.length) words.at(-1).w += tok
    }
    const dur = Math.max(MIN_LINE, s + STOP)
    t += dur
    return { b, from, to: t, words }
  })
  return { file: null, segs: [[0, t]], parts }
}

// Synthesises a run as one request and plays it whole. A take with a glitch is thrown away and the run
// is synthesised again as a whole (the model is not deterministic); the take with the fewest issues wins.
async function synth(run) {
  const text = run.map((b) => b.say).join(''), fresh = run.some((b) => REDO.includes(b.id))
  let best
  for (let take = 0; take <= RETAKES; take++) {
    const n = await speak(text, take, fresh)
    const env = envelope(n.audio), loud = [...env].sort((x, y) => x - y)[Math.floor(env.length * 0.9)] ?? 0
    const a = { env, loud, quiet: silences(env, loud) }
    const issues = audioIssues(a)
    if (!best || issues.length < best.issues.length) best = { n, a, issues, take }
    if (!issues.length) break
    process.stdout.write(`  audio-qa: take ${take} of "${run[0].id}…" flagged: ${issues.join('; ')}\n`)
  }
  if (best.issues.length) audioQa.push(...best.issues.map((i) => `${run[0].id}…: ${i}`))
  else if (best.take) process.stdout.write(`  audio-qa: "${run[0].id}…" clean on take ${best.take}\n`)
  const segs = keep(best.a, best.n.dur)
  return { file: best.n.audio, segs, parts: markRun(run, best.n, best.a, segs) }
}

// Splits scene indices into `k` consecutive groups of roughly equal spoken length.
function partition(k) {
  const len = S.scenes.map((sc) => sc.beats.reduce((n, b) => n + norm(b.say ?? '').length, 0))
  const total = len.reduce((a, b) => a + b, 0), groups = [[]]
  let acc = 0
  len.forEach((l, i) => {
    if (groups.length < k && groups.at(-1).length && acc + l / 2 > (total * groups.length) / k) groups.push([])
    groups.at(-1).push(i)
    acc += l
  })
  return groups
}

const MAX_REQUESTS = 3
let clips, captions, audioQa, scenes, t
for (let k = Number(arg('--requests', 1)); ; k++) {
  clips = []; captions = []; audioQa = []
  const firstAbs = new Map(), beatsOf = S.scenes.map(() => [])
  let cursor = LEAD
  try {
    for (const g of partition(k)) {
      const flat = g.flatMap((si) => S.scenes[si].beats.map((b) => ({ ...b, si })))
      for (const run of runs(flat)) {
        if (!run[0].say) {
          const b = run[0], dur = b.silent ?? 1
          if (!firstAbs.has(b.si)) firstAbs.set(b.si, cursor)
          beatsOf[b.si].push({ id: b.id, say: '', abs: cursor, dur, words: [] })
          cursor += dur + GAP + (b.pause ?? 0)
          continue
        }
        const { file, segs, parts } = NO_VOICE ? readRun(run) : await synth(run)
        let clipLen = 0
        for (const [from, to] of segs) {
          if (file) clips.push({ file, from, to, abs: cursor + clipLen })
          clipLen += to - from
        }
        for (const { b, from, to, words } of parts) {
          const at = cursor + from, dur = to - from
          if (!firstAbs.has(b.si)) firstAbs.set(b.si, at)
          beatsOf[b.si].push({ id: b.id, say: b.say, abs: at, dur, words })
          const chunks = splitCaption(b.sub ?? b.say)
          const timed = wordTimes(b.say, words, chunks.length)
          const total = chunks.reduce((n, c) => n + width(c), 0)
          let c0 = at
          chunks.forEach((c, i) => {
            const [s, e] = timed ? [at + timed[i][0], at + timed[i][1]] : [c0, c0 + (dur * width(c)) / total]
            captions.push({ s, e, beat: b.id, text: c.replace(/[，。；：、,;:]+$/, '') })
            c0 = e
          })
        }
        cursor += clipLen + (run.at(-1).pause ?? 0) + GAP
      }
      // Between requests: the same tight chapter cut as before.
      cursor += -GAP + CUT_TAIL + CUT_LEAD
    }
  } catch (e) {
    if (k >= MAX_REQUESTS || !/^TTS /.test(e.message)) throw e
    process.stdout.write(`  ${k} request(s) failed (${e.message.slice(0, 160)}); retrying with ${k + 1}\n`)
    continue
  }
  t = cursor - CUT_TAIL - CUT_LEAD + TAIL
  // A scene starts where its first line is marked (mid-pause inside a shared clip) and ends where the next starts.
  const starts = S.scenes.map((_, si) => (si === 0 ? 0 : firstAbs.get(si)))
  scenes = S.scenes.map((sc, si) => {
    const start = starts[si], end = starts[si + 1] ?? t
    return { id: sc.id, start, end, beats: beatsOf[si].map(({ abs, ...b }) => ({ ...b, start: abs - start })) }
  })
  if (!NO_VOICE) console.log(`tts: ${k} request(s)`)
  break
}
// Hold each caption until the next one (same line) or briefly after it ends.
for (const [i, c] of captions.entries()) {
  const next = captions[i + 1]
  c.e = !next ? c.e + 0.3 : next.beat === c.beat ? next.s : Math.min(next.s, c.e + 0.3)
}

const total = t
if (!clips.length) {
  // No voice: a silent track of the right length, so render.mjs and bgm.mjs work unchanged.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', total.toFixed(3), 'build/narration.wav'])
} else {
  const ffmpegArgs = ['-y', '-v', 'error']
  for (const c of clips) ffmpegArgs.push('-i', c.file)
  const filter = clips.map((c, i) => `[${i}:a]atrim=start=${c.from.toFixed(3)}:end=${c.to.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,adelay=${Math.round(c.abs * 1000)}:all=1[a${i}]`).join(';') +
    `;${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest,` +
    `loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad,atrim=0:${total.toFixed(3)}[out]`
  execFileSync('ffmpeg', [...ffmpegArgs, '-filter_complex', filter, '-map', '[out]', '-ac', '2', 'build/narration.wav'])
}

const srtTime = (x) => {
  const ms = Math.round(x * 1000)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}
writeFileSync('build/captions.srt', captions.map((c, i) => `${i + 1}\n${srtTime(c.s)} --> ${srtTime(c.e)}\n${c.text}\n`).join('\n'))

const scriptHash = createHash('sha1').update(scriptText).digest('hex').slice(0, 12)
writeFileSync('src/timeline.json', JSON.stringify({ scriptHash, size: [W, H], total, voice: !NO_VOICE, scenes, captions }, null, 1))
console.log(`timeline: ${scenes.length} scenes, ${total.toFixed(1)}s at ${W}x${H}${NO_VOICE ? ' (no voice, reading pace)' : ''} → src/timeline.json, build/narration.wav`)
writeFileSync('build/audio-qa.json', JSON.stringify(audioQa, null, 1))
console.log(audioQa.length
  ? `\nAUDIO QA: still flagged after ${RETAKES} retakes (listen; --redo <beatId> for a fresh take):\n${audioQa.map((s) => `  ${s}`).join('\n')}`
  : 'audio-qa: no stall or truncated clip detected')
