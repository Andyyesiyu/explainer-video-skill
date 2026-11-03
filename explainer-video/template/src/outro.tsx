// Closing brand card (~1.5s): avatar, channel name and source are on screen within 0.3s, the CTA text
// lands on the spoken words, and the video ends 0.15s after the CTA line. Viewers swipe away as soon as
// an outro starts, so keep the line short. Needs a last scene `brand` in script.json:
//   { "id": "brand", "beats": [{ "id": "cta", "say": "关注我，看更多。" }] }
// A silent card also works ({ "id": "cta", "silent": 0.75 }): the CTA text then shows right away.
import { Rect, Txt, makeScene2D } from '@revideo/2d'
import { createRef, fadeTransition } from '@revideo/core'
import { Avatar } from './brand'
import { cues, frame, pop, rise } from './lib'
import { draw } from './sketch'
import { BRAND, C, FONT } from './theme'

export const brandOutro = (source: string) => makeScene2D('brand', function* (view) {
  const f = frame(view), u = f.u, cue = cues('brand', { watermark: false, captions: false })
  const av = createRef<Rect>(), name = createRef<Txt>(), cta = createRef<Txt>(), src = createRef<Txt>()
  const s = f.portrait ? 1 : 0.8
  view.add(
    <Rect position={[0, f.safe.y]}>
      <Avatar ref={av} d={300 * s * u} y={-190 * s * u} opacity={0} />
      <Txt ref={name} text={BRAND.name} y={30 * s * u} fontFamily={FONT} fontSize={96 * s * u} fill={C.text} opacity={0} />
      <Txt ref={cta} text={BRAND.cta} y={135 * s * u} fontFamily={FONT} fontSize={46 * s * u} fill={C.highlight} opacity={0} />
      <Txt ref={src} text={source} y={300 * s * u} fontFamily={FONT} fontSize={30 * s * u} fill={C.muted} opacity={0} />
    </Rect>,
  )
  cue.at(0, () => draw(av(), 0.3), 'avatar')
  cue.at(0, () => pop(name(), 0.3), 'name')
  // Spoken CTA: anchor on whichever of these words it says. Silent card: right after the name.
  const spoken = cue.beat('cta').say
  const ctaAt = spoken
    ? ['主页', '关注'].map((w) => { try { return cue.on('cta', w, { lead: 0.1 }) } catch { return null } }).find((t) => t != null) ?? 0.1
    : 0.1
  cue.at(ctaAt, () => rise(cta(), 0.25, 16 * u), 'cta')
  cue.at(0.1, () => src().opacity(1, 0.2), 'source')
  yield* cue.run(view, fadeTransition(0.15))
})
