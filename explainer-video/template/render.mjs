// src/ (Revideo scenes) + build/narration.wav → MP4, plus a QA report and a contact sheet.
//   node render.mjs --out renders/name-v1.mp4
//   --range 3,9         render only seconds 3–9 (quick look; QA covers only that span)
//   --workers 2         parallel browser workers
//   --no-burn-subs      skip burned-in captions (the soft track and .srt are still written)
// Env: CHROME (chrome-headless-shell; auto-detected from the Playwright cache otherwise).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

// Cloud Linux: use the system ffmpeg (read when @revideo/ffmpeg loads, so set before the import) and
// kill headless shells left by an interrupted render; they reconnect to vite and restart the export.
const LINUX = process.platform === 'linux'
const CLOSE_GRACE = 8 // s to wait for chrome / vite to close after the last frame
if (LINUX) {
  for (const [k, bin] of [['FFMPEG_PATH', '/usr/bin/ffmpeg'], ['FFPROBE_PATH', '/usr/bin/ffprobe']]) {
    if (!process.env[k] && existsSync(bin)) process.env[k] = bin
  }
  try { execFileSync('pkill', ['-9', '-f', 'headless_shell'], { stdio: 'ignore' }) } catch {}
}

// Revideo awaits browser.close() and the vite server's close() before it merges the output. Puppeteer's
// browser.close() sends CDP Browser.close and then waits for the chrome process to exit with no timeout, so
// if chrome does not exit the render sits at 100% for good (seen 2026-10/11 in the cloud, once for 27 min;
// the pending call was browser.close(), and it did not reproduce in 16 instrumented runs). Patch the
// installed renderer once so both closes are bounded: give chrome CLOSE_GRACE s to exit, then SIGKILL its
// whole process group, and log which stage was stuck.
{
  const file = createRequire(import.meta.url).resolve('@revideo/renderer/lib/server/render-video.js')
  const src = readFileSync(file, 'utf8')
  const orig = 'await Promise.all([browser.close(), server.close()]);'
  if (src.includes(orig)) {
    const helpers = `
// Added by explainer-video render.mjs: bounded close (see the comment there).
function __renderCloseWait(p, ms) {
  return Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), ms).unref())]);
}
async function __renderCloseBrowser(browser) {
  const proc = browser.process();
  const gone = () => !proc || proc.exitCode !== null || proc.signalCode !== null;
  const exited = gone() ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
  if (await __renderCloseWait(browser.close(), ${CLOSE_GRACE * 1000})) return;
  console.warn('render-close: browser.close() still pending after ${CLOSE_GRACE}s (' +
    (gone() ? 'chrome exited, puppeteer cleanup stuck' : 'chrome did not exit after Browser.close') + '); killing chrome');
  // Puppeteer starts chrome detached, so -pid reaches its zygote and renderers too.
  if (!gone()) { try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} } }
  await __renderCloseWait(exited, 3000);
}
async function __renderCloseServer(server) {
  if (!(await __renderCloseWait(server.close(), ${CLOSE_GRACE * 1000}))) console.warn('render-close: vite server.close() still pending after ${CLOSE_GRACE}s; moving on');
}
`
    writeFileSync(file, src.replaceAll(orig, 'await Promise.all([__renderCloseBrowser(browser), __renderCloseServer(server)]);') + helpers)
  }
}
const { renderVideo } = await import('@revideo/renderer')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const OUT = resolve(arg('--out', 'renders/explainer.mp4'))
mkdirSync(dirname(OUT), { recursive: true })
const BASE = OUT.replace(/\.mp4$/, '')
const RANGE = arg('--range')?.split(',').map(Number)
// More than one worker hangs at the end with the ffmpeg exporter on Linux.
const WORKERS = LINUX ? 1 : Number(arg('--workers', 1))
const BURN_SUBS = !process.argv.includes('--no-burn-subs')

const TL = JSON.parse(readFileSync('src/timeline.json', 'utf8'))
const hash = createHash('sha1').update(readFileSync('script.json')).digest('hex').slice(0, 12)
if (hash !== TL.scriptHash) throw new Error('script.json changed since the last narration; run node narrate.mjs first')
const [W, H] = TL.size

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const pw = '/opt/pw-browsers'
  const lin = existsSync(pw) && readdirSync(pw).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()
  // Older Playwright builds ship chrome-linux/headless_shell; newer ones (e.g. 1243) chrome-headless-shell-linux64/chrome-headless-shell.
  for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell']) {
    if (lin && existsSync(`${pw}/${lin}/${rel}`)) return `${pw}/${lin}/${rel}`
  }
  const cache = `${process.env.HOME}/Library/Caches/ms-playwright`
  const dir = existsSync(cache) && readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()
  const bin = dir && `${cache}/${dir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`
  if (!bin || !existsSync(bin)) throw new Error('chrome-headless-shell not found: npx playwright install chromium-headless-shell, or set CHROME')
  return bin
}

// Revideo relays the page console as "Worker N: JSHandle:<text>" and reports scene errors only as
// logs, so capture everything and fail on errors ourselves.
const logs = []
for (const k of ['log', 'warn', 'error']) {
  const orig = console[k].bind(console)
  console[k] = (...a) => {
    const line = a.map(String).join(' ')
    logs.push(line)
    if (!line.includes('QA {')) orig(...a)
  }
}

mkdirSync('build', { recursive: true })
const t0 = Date.now()
await renderVideo({
  projectFile: './src/project.ts',
  variables: { burnSubs: BURN_SUBS },
  settings: {
    outFile: 'raw.mp4',
    outDir: './build',
    workers: WORKERS,
    logProgress: true,
    puppeteer: { executablePath: findChrome(), headless: 'shell', ...(process.getuid?.() === 0 ? { args: ['--no-sandbox'] } : {}) },
    // Linux headless shell has no H.264 WebCodecs encoder, so frames go to ffmpeg there.
    projectSettings: {
      ...(process.platform === 'linux' ? { exporter: { name: '@revideo/core/ffmpeg', options: { format: 'mp4' } } } : {}),
      ...(RANGE ? { range: RANGE } : {}),
    },
  },
})
const errors = logs.filter((l) => /\[console\.error\]|Rendering failed|Uncaught|Error:/.test(l) && !l.includes('QA {'))
if (errors.length) {
  console.error(`\nrender errors (the video may be blank where they occurred):\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`)
  process.exit(1)
}
console.log(`rendered build/raw.mp4 in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

// QA from the probes in lib.tsx: overrunning animations and layout issues.
const qa = [...new Set(logs.map((l) => l.match(/QA (\{.*\})/)?.[1]).filter(Boolean))].map((s) => JSON.parse(s))
writeFileSync('build/qa-events.json', JSON.stringify(qa))
// cover / hook / style / outro are warnings from the rules in SKILL.md: fix them, or tell the user why not.
const report = { overrun: [], layout: [], cover: [], hook: [], style: [], outro: [] }
for (const sc of TL.scenes) {
  const len = sc.end - sc.start
  const ended = qa.filter((q) => q.kind === 'anim' && q.scene === sc.id)
  const cut = qa.filter((q) => q.kind === 'anim-start' && q.scene === sc.id && !ended.some((e) => e.label === q.label && e.start === q.start))
  for (const c of cut) report.overrun.push(`${sc.id}/${c.label}: still running when the scene ends, cut off`)
  const anims = [...ended, ...cut.map((c) => ({ ...c, end: len }))]
  for (const a of anims) {
    // Anything starting before the first line counts as part of it.
    const i = Math.max(0, sc.beats.findLastIndex((b) => b.start <= a.start + 0.01))
    const next = sc.beats[i + 1]
    const limit = next ? next.start : len
    if (a.end > limit + 0.05) {
      report.overrun.push(`${sc.id}/${a.label}: ends ${(a.end - limit).toFixed(2)}s after ${next ? `line "${next.id}" starts` : 'the scene ends'}`)
    }
  }
  const issues = new Map()
  for (const l of qa.filter((q) => q.kind === 'lint' && q.scene === sc.id)) {
    for (const s of l.issues) issues.set(s, [...(issues.get(s) ?? []), `${l.beat}.${l.point}`])
  }
  for (const [s, at] of issues) {
    const kind = s.match(/^(cover|hook|style): /)?.[1]
    report[kind ?? 'layout'].push(`${sc.id}: ${kind ? s.slice(kind.length + 2) : s}  (${[...new Set(at)].join(', ')})`)
  }
}
// The opening decides whether a viewer stays (SKILL.md「开场」): it should be moving right away.
if (!RANGE || RANGE[0] < 0.5) {
  const starts = TL.scenes.flatMap((sc) => qa.filter((q) => q.kind === 'anim-start' && q.scene === sc.id).map((q) => sc.start + q.start))
  const firstMove = Math.min(...starts)
  if (!(firstMove <= 0.5)) report.hook.push(`nothing starts moving until ${Number.isFinite(firstMove) ? firstMove.toFixed(1) + 's' : 'the end'}; start an animation right away`)
}
// The closing card should be gone before the viewer reaches for the next video.
const last = TL.scenes.at(-1)
if (last.id === 'brand' && last.end - last.start > 2) report.outro.push(`brand card lasts ${(last.end - last.start).toFixed(2)}s; keep it under 2s with one short CTA line`)
writeFileSync('build/qa.json', JSON.stringify(report, null, 1))
const probed = qa.some((q) => q.kind === 'lint')
for (const [k, v] of Object.entries(report)) if (v.length) console.log(`\nQA ${k}:\n  ${v.join('\n  ')}`)
if (!probed) console.log('\nQA: no layout probes ran (range too short, or scenes do not use cues().run)')
else if (!Object.values(report).some((v) => v.length)) console.log('\nQA: clean')

// Final mux: our own narration mix (Revideo's audio path re-encodes and lowers it) + soft captions.
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a])
const offset = RANGE?.[0] ?? 0
ff('-i', 'build/raw.mp4', '-ss', String(offset), '-i', 'build/narration.wav', '-itsoffset', String(-offset), '-i', 'build/captions.srt',
  '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text',
  '-metadata:s:s:0', 'language=chi', '-t', ((RANGE?.[1] ?? TL.total) - offset).toFixed(3), '-movflags', '+faststart', OUT)
writeFileSync(`${BASE}.srt`, readFileSync('build/captions.srt'))

// Cover (end of the first scene) and one still per narrated line, tiled into a contact sheet.
const inRange = (t) => !RANGE || (t >= RANGE[0] && t < RANGE[1])
const still = (t, file, scale) => ff('-ss', (t - offset).toFixed(3), '-i', OUT, '-frames:v', '1', ...(scale ? ['-vf', `scale=${scale}:-2`] : []), file)
if (inRange(TL.scenes[0].end - 0.1)) still(TL.scenes[0].end - 0.1, `${BASE}-cover.png`)
// The first 5 seconds in one strip, to judge the opening at a glance.
const hookTimes = [0, 0.5, 1, 2, 3, 4, 5].filter((t) => t < TL.total && inRange(t))
rmSync('build/hook', { recursive: true, force: true })
mkdirSync('build/hook')
hookTimes.forEach((t, i) => still(t + 0.02, `build/hook/${i}.png`, H > W ? 270 : 480))
if (hookTimes.length) ff('-i', 'build/hook/%d.png', '-vf', `tile=${hookTimes.length}x1:padding=6:color=0x1d2021`, '-frames:v', '1', `${BASE}-hook.png`)
rmSync('build/sheet', { recursive: true, force: true })
mkdirSync('build/sheet')
const portrait = H > W
const times = TL.scenes.flatMap((s) => s.beats.map((b) => s.start + b.start + b.dur - 0.05)).filter(inRange)
times.forEach((t, i) => still(t, `build/sheet/${String(i).padStart(3, '0')}.png`, portrait ? 270 : 480))
if (times.length) {
  const cols = Math.min(times.length, portrait ? 6 : 4)
  ff('-i', 'build/sheet/%03d.png', '-vf', `tile=${cols}x${Math.ceil(times.length / cols)}:padding=6:color=0x1d2021`, '-frames:v', '1', `${BASE}-sheet.png`)
}
console.log(`\n→ ${OUT}\n  ${BASE}-hook.png (0–5s strip), ${BASE}-sheet.png (one still per line), ${BASE}.srt, build/qa.json`)
// Text spilling out of its box is never acceptable in a delivered video: fail so it cannot be missed.
const overflow = report.layout.filter((s) => s.includes('overflows box'))
if (overflow.length) {
  console.error(`\nTEXT OVERFLOW (fix before delivering: let the box size to its text, or shorten/wrap the label):\n  ${overflow.join('\n  ')}`)
  process.exit(2)
}
// A bounded server.close() can leave vite's handles open; don't let them keep the process alive.
process.exit(0)
