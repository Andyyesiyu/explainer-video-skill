// Hand-drawn shapes in the Excalidraw manner: roughjs sketches a path, Revideo draws it as a `Path`.
// Shapes read their own live size, so they follow layout changes (landscape ↔ portrait, growing text).
import { Path, Rect, Txt, type Node, type PathProps, type RectProps } from '@revideo/2d'
import {
  all, createSignal, delay, easeInOutCubic, type PossibleVector2, type SignalValue, type ThreadGenerator, Vector2,
} from '@revideo/core'
import rough from 'roughjs'
import type { Drawable, Options } from 'roughjs/bin/core'
import { C, ROUGH } from './theme'

const gen = rough.generator()
// Bumped by `cues().run()` BOIL_FPS times a second; every sketch re-seeds with it.
export const boil = createSignal(0)
let seedCounter = 0
const nextSeed = () => 1 + ((++seedCounter * 7919) % 100000)

const join = (d: Drawable) => gen.toPaths(d).filter((p) => p.stroke !== 'none' || (p.fill && p.fill !== 'none')).map((p) => p.d).join(' ')
const roundRect = (w: number, h: number, r: number) => {
  const x = -w / 2, y = -h / 2
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  return `M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} ` +
    `L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`
}

// Ink and paper paths of every sketch, so `draw()` can find them under any node.
const parts = new WeakMap<Node, { ink?: Path; paper?: Path }>()
// Sketches marked `contain`: frames (a map, a chart area) that the layout lint keeps other shapes inside.
const frames = new WeakSet<Node>()
// Boxes and ellipses only; `Ink` lines are registered in `parts` too, as Paths.
export const isSketch = (n: Node) => n instanceof Rect && parts.has(n)
export const isFrame = (n: Node) => frames.has(n)
// Any hand-drawn part: a Sketch box or ellipse, or an Ink line.
export const isDrawn = (n: Node) => parts.has(n)

export interface SketchProps extends Omit<RectProps, 'stroke' | 'fill'> {
  shape?: 'rect' | 'ellipse'
  ink?: string // outline colour; omit for no outline
  paper?: string // fill colour; omit for no fill
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch' | 'zigzag' | 'dots'
  corner?: number
  seed?: number
  rough?: Options
  // A frame: the layout lint reports any visible shape or text that straddles its border.
  contain?: boolean
}

// A box (or ellipse) whose outline and fill are re-sketched from its current size. Use it like a Rect,
// including `layout` and children.
export function Sketch({ shape = 'rect', ink, paper, fillStyle = 'solid', corner = 16, seed = nextSeed(), rough: ro, contain, ref, children, ...props }: SketchProps) {
  let box: Rect
  const entry: { ink?: Path; paper?: Path } = {}
  const lw = ro?.strokeWidth ?? ROUGH.strokeWidth
  const outline = (o: Options) => {
    const s = box.size()
    return shape === 'ellipse' ? gen.ellipse(0, 0, s.x, s.y, o) : gen.path(roundRect(s.x, s.y, corner), o)
  }
  const opts = (extra: Options): Options => ({ ...ROUGH, ...ro, seed: seed + boil(), ...extra })
  return (
    <Rect ref={(n: Rect) => { box = n; parts.set(n, entry); if (contain) frames.add(n); (ref as ((n: Rect) => void) | undefined)?.(n) }} {...props}>
      {paper ? (
        <Path ref={(p: Path) => (entry.paper = p)} layout={false}
          data={() => join(outline(opts({ stroke: 'none', fill: '#000', fillStyle, fillWeight: lw * 0.6, hachureGap: lw * 3 })))}
          {...(fillStyle === 'solid' ? { fill: paper } : { stroke: paper, lineWidth: lw * 0.6, lineCap: 'round' as const })} />
      ) : null}
      {ink ? (
        <Path ref={(p: Path) => (entry.ink = p)} layout={false} data={() => join(outline(opts({ stroke: '#000' })))}
          stroke={ink} lineWidth={lw} lineCap="round" lineJoin="round" />
      ) : null}
      {children}
    </Rect>
  )
}

export interface InkProps extends Omit<PathProps, 'data' | 'stroke'> {
  points: SignalValue<PossibleVector2[]>
  ink?: string
  arrow?: boolean
  seed?: number
  rough?: Options
}

// A hand-drawn polyline in its parent's coordinates, optionally ending in an arrowhead.
export function Ink({ points, ink = C.text, arrow = false, seed = nextSeed(), rough: ro, ref, ...props }: InkProps) {
  const data = () => {
    const pts = (typeof points === 'function' ? points() : points).map((p) => new Vector2(p))
    const o: Options = { ...ROUGH, ...ro, seed: seed + boil(), stroke: '#000' }
    let d = join(gen.linearPath(pts.map((p) => [p.x, p.y]), o))
    if (arrow && pts.length > 1) {
      const tip = pts[pts.length - 1], dir = tip.sub(pts[pts.length - 2]).normalized
      const size = 6 * (ro?.strokeWidth ?? ROUGH.strokeWidth)
      const wing = (deg: number) => {
        const r = (deg * Math.PI) / 180
        return tip.sub(new Vector2(dir.x * Math.cos(r) - dir.y * Math.sin(r), dir.x * Math.sin(r) + dir.y * Math.cos(r)).scale(size))
      }
      const [l, r] = [wing(28), wing(-28)]
      d += ' ' + join(gen.linearPath([[l.x, l.y], [tip.x, tip.y], [r.x, r.y]], o))
    }
    return d
  }
  return (
    <Path ref={(p: Path) => { parts.set(p, { ink: p }); (ref as ((n: Path) => void) | undefined)?.(p) }} data={data} stroke={ink}
      lineWidth={ro?.strokeWidth ?? ROUGH.strokeWidth} lineCap="round" lineJoin="round" {...props} />
  )
}

// Draws every sketch under `node` stroke by stroke, then fades in fills and text. Give the node
// opacity={0} up front; draw() makes it visible when it starts.
export function* draw(node: Node, d = 0.8): ThreadGenerator {
  const found = [node, ...node.findAll((n) => parts.has(n))].map((n) => parts.get(n)).filter((p) => p != null)
  const texts = node.findAll((n) => n instanceof Txt && !(n.parent() instanceof Txt))
  for (const p of found) {
    p.ink?.end(0)
    p.paper?.opacity(0)
  }
  for (const t of texts) t.opacity(0)
  node.opacity(1)
  yield* all(
    ...found.flatMap((p) => [p.ink?.end(1, d, easeInOutCubic), p.paper && delay(d * 0.3, p.paper.opacity(1, d * 0.6))]).filter((g) => g != null),
    ...texts.map((t) => delay(d * 0.4, t.opacity(1, d * 0.5))),
  )
}
