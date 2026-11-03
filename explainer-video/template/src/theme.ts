// Gruvbox Dark, named by role. Scenes use roles, never raw hex, so a video can be re-themed here.
export const C = {
  bg: '#282828',
  surface: '#3c3836', // panels, code blocks, caption backing
  text: '#ebdbb2',
  muted: '#928374', // secondary labels, axes
  primary: '#83a598', // the main entity
  highlight: '#fabd2f', // "look here"
  good: '#b8bb26',
  bad: '#fb4934',
  extra: '#8ec07c', // second family
  extra2: '#d3869b', // third family
  warm: '#fe8019',
}

// Channel identity: cover header, corner watermark and the closing brand card. This is the skill author's
// example channel: replace it with the user's own (SKILL.md「频道品牌和水印」), or set name to '' for no
// brand. Never use「·」in on-screen text.
export const BRAND = { name: '403-error', cta: '关注我，看更多' }

// Excalifont has no CJK glyphs; the canvas falls back to Xiaolai per character.
export const FONT = 'Excalifont, Xiaolai, sans-serif'
export const MONO = 'SF Mono, Menlo, monospace'

// Opacity for context that has been dealt with (eliminated half, previous step).
export const DIM = 0.2

// roughjs defaults for every sketched shape. roughness 0 gives clean lines.
export const ROUGH = { roughness: 1.3, bowing: 1.2, strokeWidth: 3 }
// Hand-drawn "boil": shapes are re-sketched this many times per second. 0 keeps them still.
export const BOIL_FPS = 4
