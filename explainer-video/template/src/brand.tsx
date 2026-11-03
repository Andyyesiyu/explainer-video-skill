// Channel brand: a hand-drawn avatar (Oppenheimer's porkpie hat and pipe) and the corner watermark.
import { Rect, Txt, type RectProps } from '@revideo/2d'
import { Ink, Sketch } from './sketch'
import { BRAND, C, FONT } from './theme'

type P = [number, number]
// Strokes in units of the avatar's radius, origin at its centre.
const STROKES: { pts: P[]; ink: string }[] = [
  { pts: [[-0.36, -0.04], [-0.33, -0.44], [-0.12, -0.48], [0, -0.42], [0.12, -0.48], [0.33, -0.44], [0.36, -0.04]], ink: C.text },
  { pts: [[-0.6, 0], [-0.3, 0.06], [0, 0.08], [0.3, 0.06], [0.6, 0]], ink: C.text },
  { pts: [[-0.355, -0.1], [0.355, -0.1]], ink: C.warm },
  { pts: [[-0.28, 0.12], [-0.27, 0.36], [-0.13, 0.58], [0.02, 0.64], [0.16, 0.56], [0.27, 0.34], [0.28, 0.12]], ink: C.text },
  { pts: [[0.04, 0.44], [0.36, 0.47], [0.36, 0.3], [0.52, 0.3], [0.5, 0.5], [0.36, 0.5]], ink: C.warm },
  { pts: [[0.52, 0.24], [0.63, 0.16], [0.57, 0.08], [0.67, 0]], ink: C.muted },
]

export function Avatar({ d, ...props }: { d: number } & RectProps) {
  const r = d / 2, lw = Math.max(2, d / 45)
  return (
    <Rect width={d} height={d} {...props}>
      <Sketch layout={false} shape="ellipse" width={d} height={d} ink={C.highlight} paper={C.surface} rough={{ strokeWidth: lw }} />
      {STROKES.map((s) => (
        <Ink layout={false} ink={s.ink} points={s.pts.map(([x, y]) => [x * r, y * r] as P)}
          rough={{ strokeWidth: lw, roughness: d < 100 ? 0.4 : 0.9 }} />
      ))}
    </Rect>
  )
}

// Top-left corner mark, left-aligned at (x, y) in view coordinates.
export function Watermark({ u, x, y, ...props }: { u: number; x: number; y: number } & RectProps) {
  return (
    <Rect layout alignItems="center" gap={12 * u} offset={[-1, 0]} x={x} y={y} opacity={0.6} {...props}>
      <Avatar d={50 * u} />
      <Txt text={BRAND.name} fontFamily={FONT} fontSize={30 * u} fill={C.text} />
    </Rect>
  )
}
