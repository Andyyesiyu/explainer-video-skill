// Demo: binary search. It exists to show the mechanics (cues, sketches, responsive layout); a new video
// should get its own visual idea rather than this layout.
import { Rect, Txt, makeScene2D } from '@revideo/2d'
import { all, createRef, createSignal, delay, easeInOutCubic, fadeTransition, tween, type Reference } from '@revideo/core'
import { count, cues, frame, pop, rise, shake } from './lib'
import { Ink, Sketch, draw } from './sketch'
import { C, DIM, FONT, MONO } from './theme'

// Opening hook and cover: the first line states the main result outright, the subject is on screen from
// frame 0 and moving right away, and the last frame is the cover: a short, big title and one picture,
// centred in f.cover. The pile
// of a million is drawn as a bar that halves on every look, so the picture carries the idea, not a sentence.
// See SKILL.md「封面」「开场」「画面：用图形讲」.
export const hook = makeScene2D('hook', function* (view) {
  const f = frame(view), u = f.u, cue = cues('hook')
  const tries = createRef<Txt>(), ring = createRef<Rect>(), bar = createRef<Rect>(), row = createRef<Rect>()
  const looks = createSignal(0)
  const barW = Math.min(1100 * u, f.cover.w * 0.9), barH = 64 * u, cs = Math.min(90 * u, (barW - 6 * 14 * u) / 7)
  view.add(
    <Rect layout direction="column" alignItems="center" gap={44 * u} position={[0, f.cover.y - 50 * u]}>
      <Rect layout alignItems="baseline" gap={16 * u}>
        <Txt text="100 万" fontFamily={FONT} fontSize={170 * u} fill={C.text} />
        <Txt text="个数" fontFamily={FONT} fontSize={72 * u} fill={C.muted} />
      </Rect>
      <Rect width={barW} height={barH}>
        <Sketch layout={false} width={barW} height={barH} ink={C.muted} corner={8 * u} opacity={0.5} />
        <Sketch ref={bar} layout={false} height={barH} ink={C.primary} paper={C.primary} fillStyle="hachure" corner={8 * u}
          width={() => Math.max(10 * u, barW / 2 ** looks())} x={() => -barW / 2 + Math.max(10 * u, barW / 2 ** looks()) / 2} />
      </Rect>
      <Rect layout alignItems="baseline" gap={44 * u}>
        <Txt text="只看" fontFamily={FONT} fontSize={80 * u} fill={C.text} />
        <Txt ref={tries} text="0 次" fontFamily={FONT} fontSize={160 * u} fill={C.highlight} />
        <Sketch ref={ring} layout={false} shape="ellipse" ink={C.highlight} opacity={0}
          position={() => tries().position()} size={() => tries().size().add([60 * u, 40 * u])} />
      </Rect>
      <Rect ref={row} layout gap={14 * u}>
        {[...Array(7)].map(() => <Sketch width={cs} height={cs} ink={C.muted} paper={C.surface} opacity={0} />)}
      </Rect>
    </Rect>,
  )
  // Moves from the first frame: every look halves the bar and ticks the count, landing on 20 as it is said.
  const landed = cue.on('ask', '二十次', { lead: 0 })
  cue.at(0.1, () => tween(landed - 0.1, (p) => {
    const k = Math.min(20, Math.floor(p * 21))
    looks(k)
    tries().text(`${k} 次`)
  }), 'halve')
  cue.at(landed, () => all(pop(tries()), draw(ring(), 0.6)), 'ring')
  cue.at(cue.on('how', '七个数', { lead: 0 }), () => all(...row().children().map((c, i) => delay(i * 0.07, draw(c, 0.5)))), 'cells')
  yield* cue.run(view)
})

const VALUES = [2, 5, 8, 12, 16, 23, 38]
const CODE = [
  'while lo <= hi:',
  '    mid = (lo + hi) // 2',
  '    if a[mid] == t: return mid',
  '    if a[mid] < t: lo = mid + 1',
  '    else: hi = mid - 1',
]
const tokenColor = (tok: string) =>
  /^(while|if|else|return)$/.test(tok) ? C.bad : /^\d+$/.test(tok) ? C.extra2 : /^[a-z]+$/.test(tok) ? C.text : C.muted
// Leading whitespace collapses inside Txt, so indentation is a margin (monospace char ≈ 0.6em).
const codeLine = (line: string, size: number) => (
  <Txt fontFamily={MONO} fontSize={size} marginLeft={(line.length - line.trimStart().length) * 0.6 * size}>
    {line.trimStart().split(/(\s+|\w+)/).filter(Boolean).map((tok) => <Txt text={tok} fill={tokenColor(tok)} />)}
  </Txt>
)

export const search = makeScene2D('search', function* (view) {
  const f = frame(view), u = f.u, cue = cues('search')
  const gap = 16 * u, cs = Math.min(130 * u, (f.safe.w - 6 * gap) / 7)
  const head = createRef<Rect>(), row = createRef<Rect>(), cmp = createRef<Txt>(), focus = createRef<Rect>()
  const lo = createRef<Txt>(), hi = createRef<Txt>(), mid = createRef<Txt>(), arrow = createRef<Rect>()
  const bottom = createRef<Rect>(), code = createRef<Rect>(), tally = createRef<Rect>(), target = createRef<Txt>()
  const cells: Reference<Rect>[] = VALUES.map(() => createRef<Rect>())
  const midI = createSignal(3), loI = createSignal(0)
  const cx = (i: number) => {
    const a = Math.floor(i), b = Math.min(VALUES.length - 1, a + 1), t = i - a
    return cells[a]().x() * (1 - t) + cells[b]().x() * t
  }
  const top = () => cells[0]().top().y
  // Every node exists from the start (hidden), so the layout is fixed and nothing shifts as parts appear.
  // Landscape stacks from the top; the tall portrait frame spreads the same parts over its height.
  const big = f.portrait ? 1.25 : 1
  view.add(
    <Rect layout direction="column" alignItems="center" gap={36 * u} position={[0, f.safe.y]}
      width={f.safe.w} height={f.safe.h} justifyContent={f.portrait ? 'space-evenly' : 'start'}>
      <Rect ref={head} layout alignItems="baseline" gap={30 * u} opacity={0}>
        <Txt text="二分查找" fontFamily={FONT} fontSize={72 * u} fill={C.text} />
        <Txt text="target =" fontFamily={MONO} fontSize={36 * u} fill={C.muted} />
        <Txt ref={target} text="23" fontFamily={MONO} fontSize={36 * u} fill={C.highlight} />
      </Rect>
      <Rect ref={row} layout gap={gap} marginTop={90 * u}>
        {VALUES.map((v, i) => (
          <Sketch ref={cells[i]} layout width={cs} height={cs} justifyContent="center" alignItems="center"
            ink={C.primary} paper={C.surface} opacity={0}>
            <Txt text={String(v)} fontFamily={FONT} fontSize={cs * 0.38} fill={C.text} />
          </Sketch>
        ))}
        {/* Overlay in the row's space: pointers and the focus box follow the cells they point at.
            Txt ignores layout={false} inside a flex parent, so free-floating text needs a non-layout Rect. */}
        <Rect layout={false}>
          <Txt ref={lo} text="lo" fontFamily={MONO} fontSize={30 * u} fill={C.extra} opacity={0}
            position={() => [cx(loI()), top() - 34 * u]} />
          <Txt ref={hi} text="hi" fontFamily={MONO} fontSize={30 * u} fill={C.extra} opacity={0}
            position={() => [cx(6), top() - 34 * u]} />
          <Txt ref={mid} text="mid" fontFamily={MONO} fontSize={30 * u} fill={C.highlight} opacity={0}
            position={() => [cx(midI()), top() - 100 * u]} />
          <Rect ref={arrow} opacity={0}>
            <Ink ink={C.highlight} arrow points={() => [[cx(midI()), top() - 78 * u], [cx(midI()), top() - 12 * u]]} />
          </Rect>
          <Sketch ref={focus} ink={C.highlight} opacity={0} rough={{ strokeWidth: 4 }}
            position={() => [cx(midI()), cells[0]().y()]} size={cs + 22 * u} />
        </Rect>
      </Rect>
      <Txt ref={cmp} text=" " fontFamily={FONT} fontSize={44 * big * u} fill={C.text} opacity={0} />
      <Rect ref={bottom} layout direction={f.portrait ? 'column' : 'row'} alignItems="center" gap={60 * u}>
        <Rect ref={tally} layout direction="column" gap={18 * u} opacity={0}>
          {[7, 3, 1].map((n) => (
            <Rect layout alignItems="center" gap={18 * u} opacity={0}>
              <Sketch width={n * 34 * big * u} height={34 * big * u} ink={C.extra} paper={C.extra} fillStyle="hachure" corner={6 * u} />
              <Txt text={`${n} 个`} fontFamily={FONT} fontSize={34 * big * u} fill={C.muted} />
            </Rect>
          ))}
        </Rect>
        <Sketch ref={code} layout direction="column" padding={[26 * u, 34 * u]} gap={6 * u} ink={C.muted} paper={C.surface} opacity={0}>
          {CODE.map((l) => codeLine(l, 28 * big * u))}
        </Sketch>
      </Rect>
    </Rect>,
  )

  cue.at(0.1, () => rise(head()), 'head')
  cue.at(cue.on('setup', '七个数'), () => all(...cells.map((c, i) => delay(i * 0.08, draw(c(), 0.5)))), 'cells')
  cue.at(cue.on('setup', '二十三'), () => all(pop(target()), shake(target(), 8 * u)), 'target')
  cue.at(cue.on('mid1', '正中间'), () => all(lo().opacity(1, 0.3), hi().opacity(1, 0.3), mid().opacity(1, 0.3), arrow().opacity(1, 0.3), draw(focus(), 0.5)), 'pointers')
  cue.at(cue.on('mid1', '比'), function* () {
    cmp().text('12 < 23')
    yield* rise(cmp())
  }, 'compare')
  cue.at(cue.on('cut1', '扔掉'), () => all(
    ...cells.slice(0, 4).map((c, i) => delay(i * 0.06, c().opacity(DIM, 0.5))),
    loI(4, 0.7, easeInOutCubic), cmp().opacity(0, 0.3),
  ), 'cut')
  cue.at(cue.on('mid2', '再看中间'), () => midI(5, 0.7, easeInOutCubic), 'mid→5')
  cue.at(cue.on('mid2', '找到了'), function* () {
    cmp().text('23 = 23  找到了！')
    cmp().fill(C.good)
    yield* all(rise(cmp()), delay(0.2, pop(cells[5]())), ...[4, 6].map((i) => cells[i]().opacity(DIM, 0.4)))
  }, 'found')
  cue.at(cue.on('code', '砍掉一半'), function* () {
    tally().opacity(1)
    yield* all(...tally().children().map((r, i) => delay(i * 0.35, all(r.opacity(1, 0.2), draw(r, 0.5)))))
  }, 'tally')
  cue.at(cue.on('code', '写成代码'), () => draw(code(), 0.8), 'code')
  yield* cue.run(view, fadeTransition(0.3))
})

export const scale = makeScene2D('scale', function* (view) {
  const f = frame(view), u = f.u, cue = cues('scale')
  const n = createRef<Txt>(), times = createRef<Txt>(), ring = createRef<Rect>(), down = createRef<Rect>(), note = createRef<Txt>()
  view.add(
    <Rect layout direction="column" alignItems="center" gap={30 * u} position={[0, f.safe.y]} width={f.safe.w}>
      <Rect layout alignItems="baseline" gap={20 * u}>
        <Txt ref={n} text="7" fontFamily={FONT} fontSize={(f.portrait ? 120 : 140) * u} fill={C.text} />
        <Txt text="个数" fontFamily={FONT} fontSize={56 * u} fill={C.muted} />
      </Rect>
      <Rect ref={down} height={130 * u} width={20 * u} opacity={0}>
        <Ink layout={false} ink={C.muted} arrow points={[[0, -55 * u], [0, 55 * u]]} />
      </Rect>
      <Rect layout alignItems="center">
        <Txt text="最多 " fontFamily={FONT} fontSize={72 * u} fill={C.text} />
        <Txt ref={times} text="20 次" fontFamily={FONT} fontSize={110 * u} fill={C.highlight} opacity={0} />
        <Sketch ref={ring} layout={false} shape="ellipse" ink={C.highlight} opacity={0}
          position={() => times().position()} size={() => times().size().add([60 * u, 40 * u])} />
      </Rect>
      <Txt ref={note} text="log₂ 1,000,000 ≈ 20" fontFamily={MONO} fontSize={30 * u} fill={C.muted} opacity={0} />
    </Rect>,
  )
  cue.at(cue.on('million', '一百万'), () => count(n(), 1_000_000, 1.2, (v) => Math.round(v).toLocaleString('en-US'), 7), 'count')
  cue.at(cue.on('million', '最多'), () => all(down().opacity(1, 0.3), note().opacity(1, 0.4)), 'arrow')
  // The last line ends on 二十次 and the video cuts straight to the brand card, so this must be quick.
  cue.at(cue.on('million', '二十次'), () => all(pop(times(), 0.5), delay(0.1, draw(ring(), 0.4))), 'twenty')
  yield* cue.run(view, fadeTransition(0.3))
})
