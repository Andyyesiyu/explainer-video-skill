// Lays a background music bed under a finished video's narration (the audio already in the MP4).
//   node bgm.mjs renders/name-v1.mp4 music/track.mp3 --out renders/name-v1-bgm.mp4
//   --under 30     dB the bed sits below the voice while someone speaks (default 30)
//   --credit "…"   attribution line for a CC BY track; written next to the output as <out>-credits.txt
// The music is EQ'd out of the voice band, looped with a crossfade when it is shorter than the video,
// calibrated against the measured voice loudness, ducked a little more under speech (sidechain) and
// faded in and out. Video and subtitle streams are copied untouched.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'
// −4 dB around 2.5 kHz keeps the music out of the consonants; +1.5 dB at 150 Hz keeps it warm.
const EQ = 'equalizer=f=2500:t=q:w=1:g=-4,equalizer=f=150:t=q:w=1:g=1.5'
// Gentle extra dip while the voice is on; the bed level itself comes from --under.
const DUCK = 'sidechaincompress=threshold=0.02:ratio=2.5:attack=30:release=500'
const XFADE = 4, FADE_IN = 1.2, FADE_OUT = 2.5

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : fallback
}
const UNDER = Number(opt('--under', 30))
const CREDIT = opt('--credit')
const [VIDEO, MUSIC] = args
if (!VIDEO || !MUSIC) throw new Error('usage: node bgm.mjs <video.mp4> <music> [--out out.mp4] [--under 30] [--credit "…"]')
const OUT = resolve(opt('--out', VIDEO.replace(/\.mp4$/, '-bgm.mp4')))
for (const f of [VIDEO, MUSIC]) if (!existsSync(f)) throw new Error(`not found: ${f}`)
mkdirSync('build', { recursive: true })
mkdirSync(dirname(OUT), { recursive: true })

const run = (bin, a) => {
  const r = spawnSync(bin, a, { encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) throw new Error(`${bin} failed:\n${r.stderr.slice(-2000)}`)
  return r.stderr
}
const duration = (f) => Number(spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout)
// Integrated loudness (LUFS) of the first audio stream, optionally only between `from` and `to` seconds.
const lufs = (f, from, to) => {
  const trim = from != null ? `atrim=${from}:${to},` : ''
  const log = run(FFMPEG, ['-nostats', '-i', f, '-map', '0:a:0', '-af', `${trim}ebur128`, '-f', 'null', '-'])
  return Number([...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop()[1])
}

const V = duration(VIDEO)
// Loop the track with crossfades until it covers the video.
let bed = MUSIC
const M = duration(MUSIC)
if (M < V + 1) {
  const n = Math.ceil((V + XFADE) / (M - XFADE))
  const chain = [...Array(n - 1)].map((_, i) => `${i ? `[x${i}]` : '[0:a]'}[${i + 1}:a]acrossfade=d=${XFADE}:c1=tri:c2=tri${i < n - 2 ? `[x${i + 1}]` : ''}`)
  bed = 'build/bgm-loop.wav'
  run(FFMPEG, ['-v', 'error', '-y', ...[...Array(n)].flatMap(() => ['-i', MUSIC]), '-filter_complex', chain.join(';'), bed])
  console.log(`bgm: ${M.toFixed(1)}s track looped ×${n} (${XFADE}s crossfades, first join at ${(M - XFADE).toFixed(1)}s)`)
}

const prep = (gain) => `aresample=48000,aformat=channel_layouts=stereo,atrim=0:${V},${EQ},volume=${gain}dB`
const voice = '[0:a]aresample=48000,aformat=channel_layouts=stereo'
// The ducked bed alone, for measuring. Gain reduction depends only on the voice, so the bed's level
// is linear in `gain` and one measurement calibrates it. Skip the first and last 3s (fades, outro).
const measureBed = (gain) => {
  run(FFMPEG, ['-v', 'error', '-y', '-i', VIDEO, '-i', bed, '-filter_complex',
    `[1:a]${prep(gain)}[m];${voice}[v];[m][v]${DUCK}[d]`, '-map', '[d]', '-t', String(V), 'build/bgm-bed.wav'])
  return lufs('build/bgm-bed.wav', 3, V - 3)
}
const voiceLufs = lufs(VIDEO, 3, V - 3)
const gain = +(voiceLufs - UNDER - measureBed(0)).toFixed(1)

run(FFMPEG, ['-v', 'error', '-y', '-i', VIDEO, '-i', bed, '-filter_complex',
  `[1:a]${prep(gain)},afade=t=in:d=${FADE_IN},afade=t=out:st=${(V - FADE_OUT).toFixed(2)}:d=${FADE_OUT}[m];` +
  `${voice},asplit[v1][v2];[m][v1]${DUCK}[d];[v2][d]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[a]`,
  '-map', '0:v', '-map', '[a]', '-map', '0:s?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-c:s', 'copy',
  '-movflags', '+faststart', OUT])

const bedLufs = measureBed(gain)
console.log(`bgm: voice ${voiceLufs} LUFS, bed ${bedLufs} LUFS under speech (${(voiceLufs - bedLufs).toFixed(1)} dB below), music gain ${gain} dB`)
console.log(`bgm: mix ${lufs(OUT)} LUFS → ${OUT}`)
if (CREDIT) {
  writeFileSync(OUT.replace(/\.mp4$/, '-credits.txt'), CREDIT + '\n')
  console.log('bgm: attribution written next to the video; it goes in the post description')
}
