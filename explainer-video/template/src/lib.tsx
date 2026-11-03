// Timing, captions, layout frame and QA shared by all scenes. Copied into each project: edit freely.
import { Circle, Img, Rect, Txt, type Layout, type Node, type View2D } from '@revideo/2d'
import {
  all, any, chain, createRef, easeInOutCubic, easeOutBack, easeOutCubic, easeOutQuint, tween, useScene, useTime, waitFor,
  type ThreadGenerator,
} from '@revideo/core'
import FONTS from './fonts.json'
import TL from './timeline.json'
import { Watermark } from './brand'
import { boil, isDrawn, isFrame, isSketch } from './sketch'
import { BOIL_FPS, BRAND, C, FONT, MONO } from './theme'

// Canvas text silently falls back to a system font until a face is loaded, so load every chunk first.
await Promise.all(FONTS.map((f) => {
  const face = new FontFace(f.fam, `url(/fonts/${f.fam}/${f.file})`, { unicodeRange: f.range })
  document.fonts.add(face)
  return face.load()
}))

export const WORD_LEAD = 0.25

// Frame size and the safe area for content. `u` is one pixel at 1080 on the short side, so sizes
// written as `n * u` scale across resolutions. The bottom band belongs to captions (and, in portrait,
// to the platform's own UI). The safe area is a default layout box, not a hard limit: content may go
// past it as long as it stays clear of the captions.
// `cover` is where the cover (the first scene's last frame) must fit: feeds show a portrait cover cropped
// to 3:4 around its centre, so in portrait it is the middle 1080×1440 minus a margin, centred on the
// screen. Landscape covers are shown whole; keep a 5% margin.
export function frame(view: View2D) {
  const w = view.width(), h = view.height(), portrait = h > w
  const u = Math.min(w, h) / 1080
  const top = portrait ? 0.15 * h : 60 * u
  const bottom = portrait ? 0.26 * h : 200 * u
  const side = (portrait ? 60 : 120) * u
  const cover = portrait
    ? { x: 0, y: 0, w: w - 2 * side, h: Math.min(h, (w * 4) / 3) - 2 * side }
    : { x: 0, y: 0, w: w * 0.9, h: h * 0.9 }
  return { w, h, portrait, u, safe: { x: 0, y: (top - bottom) / 2, w: w - 2 * side, h: h - top - bottom }, cover }
}

// Scenes in script.json order. Audio and captions are laid out from the script, so a scene missing
// here or out of order would silently desync everything after it.
export function ordered<T extends { name: string }>(list: T[]): T[] {
  const names = list.map((d) => d.name)
  const extra = names.filter((n) => !TL.scenes.some((s) => s.id === n))
  if (extra.length) throw new Error(`scenes not in script.json: ${extra.join(', ')}`)
  return TL.scenes.map((s) => {
    const d = list.find((x) => x.name === s.id)
    if (!d) throw new Error(`script.json scene "${s.id}" has no makeScene2D('${s.id}', …)`)
    return d
  })
}

const qa = (x: object) => console.log('QA ' + JSON.stringify(x))
const norm = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

// Per-scene clock from timeline.json. Times are seconds from the scene start.
// `watermark: false` for scenes that already show the brand (cover, closing card). `captions: false`
// keeps burned-in captions out of a scene (the silent closing card, where the last line's caption would
// otherwise linger for a moment).
export function cues(id: string, { watermark = true, captions: withCaptions = true } = {}) {
  const found = TL.scenes.find((s) => s.id === id)
  if (!found) throw new Error(`scene "${id}" is not in timeline.json; add it to script.json and run node narrate.mjs`)
  const sc = found
  const len = sc.end - sc.start
  const beat = (bid: string) => {
    const b = sc.beats.find((x) => x.id === bid)
    if (!b) throw new Error(`beat "${bid}" is not in scene "${id}"`)
    return b
  }
  // WORD_LEAD before `text` is spoken in beat `bid`.
  const on = (bid: string, text: string, { lead = WORD_LEAD, nth = 1 } = {}) => {
    const b = beat(bid)
    const stream = b.words.flatMap((w) => norm(w.w).split('').map(() => w))
    const hay = b.words.map((w) => norm(w.w)).join('')
    let i = -1
    for (let n = 0; n < nth; n++) {
      i = hay.indexOf(norm(text), i + 1)
      if (i < 0) break
    }
    if (i < 0 || !norm(text)) throw new Error(`"${text}" is not spoken in beat "${bid}": ${b.say}`)
    return Math.max(0, b.start + stream[i].s - lead)
  }
  const tasks: ThreadGenerator[] = []
  // Starts `task` at scene time `t`. Start and end are reported to render.mjs for overrun checks; a task
  // still running when the scene ends is cut off there and reported without an end.
  const at = (t: number, task: () => ThreadGenerator, label = `@${t.toFixed(2)}s`) => {
    tasks.push((function* () {
      yield* waitFor(Math.max(0, t))
      const t0 = useTime()
      qa({ kind: 'anim-start', scene: id, label, start: t0 })
      yield* task()
      qa({ kind: 'anim', scene: id, label, start: t0, end: useTime() })
    })())
  }

  // Adds captions, boil and QA probes, then runs everything until the scene's narrated length.
  // Pass extra generators such as a transition: `yield* cue.run(view, fadeTransition(0.4))`.
  function* run(view: View2D, ...extra: ThreadGenerator[]) {
    const f = frame(view)
    const mark = createRef<Rect>()
    if (watermark && BRAND.name) view.add(<Watermark ref={mark} u={f.u} x={-f.w / 2 + 40 * f.u} y={-f.h / 2 + (f.portrait ? 100 : 40) * f.u} />)
    const capBox = createRef<Rect>(), capTxt = createRef<Txt>()
    const burn = withCaptions && useScene().variables.get('burnSubs', true)()
    if (burn) {
      // Portrait: bottom edge at 76% height, above the title, description and buttons that short-video apps
      // lay over the lower quarter. It may cover the bottom of a diagram a little, so the backing is
      // translucent and the text carries a shadow to stay readable.
      view.add(
        <Rect ref={capBox} layout offset={[0, 1]} position={[0, f.h / 2 - (f.portrait ? 0.24 * f.h : 48 * f.u)]}
          padding={[10 * f.u, 28 * f.u]} radius={14 * f.u} fill={C.surface + (f.portrait ? '99' : 'e6')} maxWidth={f.w * 0.9} opacity={0}>
          {/* narrate.mjs pre-breaks captions into lines that fit; "pre" keeps its "\n" and never re-wraps. */}
          <Txt ref={capTxt} text="" fontFamily={FONT} fontSize={(f.portrait ? 52 : 46) * f.u} lineHeight="135%"
            fill={C.text} textWrap="pre" textAlign="center" shadowColor={'#000000b3'} shadowBlur={8 * f.u} />
        </Rect>,
      )
    }
    const caps = TL.captions.filter((c) => c.e > sc.start + 0.01 && c.s < sc.end - 0.01)
      .map((c) => ({ ...c, s: Math.max(0, c.s - sc.start), e: Math.min(len, c.e - sc.start) }))
    function* captions() {
      if (!burn) return
      let now = 0
      for (const [i, c] of caps.entries()) {
        yield* waitFor(c.s - now)
        capTxt().text(c.text)
        capBox().opacity(1)
        now = c.s
        const next = caps[i + 1]
        if (!next || next.s > c.e + 0.01) {
          yield* waitFor(c.e - now)
          capBox().opacity(0)
          now = c.e
        }
      }
    }
    // The first scene is also the hook and the cover: its first frame must already show something, and
    // its last frame (the cover) is checked against the cover rules in SKILL.md「封面」.
    const first = TL.scenes[0].id === id
    const skip = () => [mark(), capBox()].filter(Boolean) as Node[]
    function* probes() {
      const points = sc.beats.filter((b) => b.say).flatMap((b) => [
        { beat: b.id, point: 'mid', t: b.start + b.dur / 2 },
        { beat: b.id, point: 'end', t: b.start + b.dur - 0.05 },
      ])
      let now = 0
      if (first) {
        yield* waitFor(0.04)
        now = 0.04
        const shown = visible(view, skip())
        if (!shown.texts.length && !shown.shapes.length) {
          qa({ kind: 'lint', scene: id, beat: 'first-frame', point: 'start', issues: ['hook: the first frame is empty; show the subject from frame 0'] })
        }
      }
      for (const [i, p] of points.entries()) {
        yield* waitFor(p.t - now)
        now = p.t
        const cover = first && i === points.length - 1
        qa({ kind: 'lint', scene: id, beat: p.beat, point: p.point, issues: lint(view, f, capTxt, skip(), cover) })
      }
    }
    // The cover is grabbed from the first scene's last frame: take the caption off just before it.
    function* clearForCover() {
      if (!first || !burn) return
      yield* waitFor(Math.max(0, len - 0.15))
      capBox().opacity(0)
    }
    function* boiling() {
      while (BOIL_FPS) {
        yield* waitFor(1 / BOIL_FPS)
        boil(boil() + 1)
      }
    }
    const playback = useScene().playback
    const startedAt = playback.framesToSeconds(playback.frame)
    // End on the narration's absolute end, not after `len`: scene lengths snap to whole frames, and
    // waiting a fixed `len` would let that rounding pile up scene after scene.
    const until = Math.max(0, sc.end - startedAt)
    yield* any(waitFor(until), all(...extra, ...tasks, captions(), probes(), clearForCover(), boiling(), waitFor(until)))
  }
  return { len, beat, on, at, run }
}

// Layout lint on visible text: offscreen, overlapping, too small, or under the caption. Visible shapes
// (sketches, dots) and text are also checked against the screen and against `<Sketch contain>` frames.
// Lines and arrows are skipped: they cross frames on purpose.
const textOf = (n: Txt): string => n.text() || n.children().map((c) => (c instanceof Txt ? textOf(c) : '')).join('')
// Layout box in screen pixels (cacheBBox is padded for effects, so it over-reports overlaps).
// Ignores rotation, which this template doesn't use on text.
function worldBox(n: Layout) {
  const p = n.absolutePosition(), s = n.absoluteScale(), size = n.size(), o = n.offset()
  const w = size.x * Math.abs(s.x), h = size.y * Math.abs(s.y)
  const cx = p.x - (o.x * w) / 2, cy = p.y - (o.y * h) / 2
  return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2, scale: Math.abs(s.y) }
}
const opacity = (n: Node) => {
  let o = 1
  for (let p: Node | null = n; p; p = p.parent()) o *= p.opacity()
  return o
}
const within = (n: Node, roots: Node[]) => {
  for (let p: Node | null = n; p; p = p.parent()) if (roots.includes(p)) return true
  return false
}
// Reading length: a CJK character counts 1, a Latin letter or digit 0.5; spaces and punctuation are free.
const units = (s: string) => [...s.replace(/[\s\p{P}]/gu, '')].reduce((n, ch) => n + (/[\x00-\xff]/.test(ch) ? 0.5 : 1), 0)
// Content on screen, leaving out `skip` (watermark, captions): text at ≥50% opacity, and shapes.
function visible(view: View2D, skip: Node[]) {
  const texts = view.findAll((n): n is Txt => n instanceof Txt && !(n.parent() instanceof Txt) && !within(n, skip))
    .map((n) => ({ n, o: opacity(n), box: worldBox(n), label: textOf(n).slice(0, 20), full: textOf(n) }))
    .filter((t) => t.o >= 0.5 && t.box.r > t.box.l && t.label.trim())
  const shapes = view.findAll((n) => (isDrawn(n) || n instanceof Circle || n instanceof Img) && !within(n, skip) && opacity(n) >= 0.5)
  return { texts, shapes }
}
// Style checks (SKILL.md「画面：用图形讲」and「封面」). They only warn; render.mjs lists them under their own
// headings. `cover` adds the cover checks, run on the first scene's last frame.
function styleLint(view: View2D, f: ReturnType<typeof frame>, texts: ReturnType<typeof visible>['texts'], cover: boolean) {
  const issues: string[] = []
  const prose = texts.filter((t) => !String(t.n.fontFamily()).includes(MONO.split(',')[0]) && t.full !== BRAND.name)
  // A box holding a phrase and nothing drawn: the PPT look. Code blocks (monospace) are exempt.
  for (const box of view.findAll((n) => isSketch(n) && opacity(n) >= 0.5)) {
    const inner = box.findAll(() => true).filter((n) => n !== box)
    if (inner.some((n) => isDrawn(n) || n instanceof Circle || n instanceof Img)) continue
    const said = prose.filter((t) => inner.includes(t.n)).map((t) => t.full).join('')
    if (units(said) > 12) issues.push(`style: text in a box "${said.slice(0, 20)}" (${units(said)} chars); draw it instead`)
  }
  if (cover) {
    // f.cover is in view coordinates (origin at the centre); boxes are in screen pixels.
    const sc = worldBox(view), k = sc.scale, ox = (sc.l + sc.r) / 2 + f.cover.x * k, oy = (sc.t + sc.b) / 2 + f.cover.y * k
    const win = { l: ox - (f.cover.w * k) / 2, r: ox + (f.cover.w * k) / 2, t: oy - (f.cover.h * k) / 2, b: oy + (f.cover.h * k) / 2 }
    for (const t of prose) {
      const { l, r, t: top, b } = t.box
      if (l < win.l - 2 || r > win.r + 2 || top < win.t - 2 || b > win.b + 2) issues.push(`cover: "${t.label}" is outside the centre window`)
    }
  }
  return issues
}
function lint(view: View2D, f: ReturnType<typeof frame>, capTxt: () => Txt | undefined, skip: Node[], cover = false) {
  const cap = capTxt()
  const screen = worldBox(view)
  const texts = visible(view, skip).texts
  const issues: string[] = styleLint(view, f, texts, cover)
  const hit = (a: { l: number; r: number; t: number; b: number }, b: typeof a) => {
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
    return w > 0 && h > 0 ? (w * h) / Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t)) : 0
  }
  for (const t of texts) {
    const { l, r, t: top, b } = t.box
    if (l < screen.l - 2 || r > screen.r + 2 || top < screen.t - 2 || b > screen.b + 2) issues.push(`offscreen "${t.label}"`)
    if (t.n.fontSize() * t.box.scale < 20 * f.u) issues.push(`small ${Math.round(t.n.fontSize() * t.box.scale)}px "${t.label}"`)
    // Text must stay inside the content area (box minus padding) of the sketched box it sits in, with
    // no tolerance beyond float rounding: a label in a fixed-width box that reaches into the padding
    // or past the outline is reported.
    let p = t.n.parent()
    while (p && !isSketch(p)) p = p.parent()
    if (p) {
      const box = worldBox(p as Layout), pad = (p as Layout).padding(), k = box.scale, eps = 0.5
      const inner = { l: box.l + pad.left * k, r: box.r - pad.right * k, t: box.t + pad.top * k, b: box.b - pad.bottom * k }
      if (box.r > box.l && (l < inner.l - eps || r > inner.r + eps || top < inner.t - eps || b > inner.b + eps)) {
        issues.push(`overflows box "${t.label}"`)
      }
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j]
      if (a.n.findAll(() => true).includes(b.n) || b.n.findAll(() => true).includes(a.n)) continue
      if (hit(a.box, b.box) > 0.15) issues.push(`overlap "${a.label}" × "${b.label}"`)
    }
  }
  const capBox = cap?.parent()
  if (cap && capBox instanceof Rect && capBox.opacity() > 0.5 && textOf(cap)) {
    const cb = worldBox(capBox), ct = worldBox(cap)
    if (ct.l < cb.l - 2 || ct.r > cb.r + 2) issues.push(`caption overflow "${textOf(cap).slice(0, 20)}"`)
    // A little overlap is fine (the backing is translucent); flag text the caption mostly hides.
    for (const t of texts) if (hit(t.box, cb) > 0.4) issues.push(`under caption "${t.label}"`)
  }
  const shapes = view.findAll((n): n is Layout => (isSketch(n) || n instanceof Circle) && n.parent() !== capBox && !within(n, skip) && opacity(n) >= 0.5)
    .map((n) => {
      const box = worldBox(n), label = n.findAll((c): c is Txt => c instanceof Txt).map(textOf).join('').slice(0, 20)
      const at = `(${Math.round((box.l + box.r) / 2 / f.u)}, ${Math.round((box.t + box.b) / 2 / f.u)})`
      return { n, box, label: label || `${n instanceof Circle ? 'dot' : 'shape'} at ${at}` }
    })
    .filter((s) => s.box.r > s.box.l && s.box.b > s.box.t)
  const tol = 4 * f.u
  const inside = (a: typeof screen, b: typeof screen) => a.l >= b.l - tol && a.r <= b.r + tol && a.t >= b.t - tol && a.b <= b.b + tol
  for (const s of shapes) if (!inside(s.box, screen)) issues.push(`offscreen "${s.label}"`)
  for (const fr of shapes.filter((s) => isFrame(s.n))) {
    for (const s of [...shapes, ...texts]) {
      if (s.n === fr.n || s.n.findAll(() => true).includes(fr.n)) continue
      if (hit(s.box, fr.box) > 0 && !inside(s.box, fr.box) && !inside(fr.box, s.box)) issues.push(`crosses frame "${fr.label}": "${s.label}"`)
    }
  }
  return issues
}

// Small motion vocabulary. Everything else is plain Revideo tweens.
export function* rise(n: Node, d = 0.6, dy = 30): ThreadGenerator {
  const y = n.y()
  n.y(y + dy)
  yield* all(n.opacity(1, d, easeOutQuint), n.y(y, d, easeOutQuint))
}
export function* pop(n: Node, d = 0.6): ThreadGenerator {
  n.scale(0.8)
  yield* all(n.opacity(1, d * 0.6, easeOutCubic), n.scale(1, d, easeOutBack))
}
export function* count(n: Txt, to: number, d = 1.2, fmt = (v: number) => String(Math.round(v)), from = 0): ThreadGenerator {
  yield* tween(d, (p) => n.text(fmt(from + (to - from) * easeOutCubic(p))))
}
export function* shake(n: Node, amp = 14): ThreadGenerator {
  const x = n.x()
  yield* chain(...[-1, 1, -0.7, 0.7, 0].map((k) => n.x(x + k * amp, 0.1, easeInOutCubic)))
}
// A copy of `src` flies onto `dst` and cross-fades into it; `src` stays. Give `dst` opacity={0}.
export function* copyTo(view: View2D, src: Node, dst: Node, d = 0.9): ThreadGenerator {
  const c = src.clone()
  view.add(c)
  c.absolutePosition(src.absolutePosition())
  c.absoluteScale(src.absoluteScale())
  c.opacity(1)
  yield* all(
    c.absolutePosition(dst.absolutePosition(), d, easeOutQuint),
    c.absoluteScale(dst.absoluteScale(), d, easeOutQuint),
    chain(waitFor(0.7 * d), all(c.opacity(0, 0.3 * d), dst.opacity(1, 0.3 * d))),
  )
  c.remove()
}
