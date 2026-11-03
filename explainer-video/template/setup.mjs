// One-time: fetch Excalidraw's handwriting fonts (Excalifont for Latin, Xiaolai for CJK; both OFL)
// from the @excalidraw/excalidraw npm package into public/fonts, and write src/fonts.json with each
// file's unicode-range so the browser loads only the chunks a video uses.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PKG = '@excalidraw/excalidraw@0.18.1'
const tmp = mkdtempSync(join(tmpdir(), 'exfonts-'))
const tgz = execFileSync('npm', ['pack', PKG, '--silent'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop()
execFileSync('tar', ['xzf', tgz], { cwd: tmp })
const prod = join(tmp, 'package/dist/prod')

const chunk = readdirSync(prod).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(prod, f), 'utf8'))
  .find((s) => s.includes('Xiaolai-Regular-'))
if (!chunk) throw new Error(`no font table in ${PKG}; the bundle layout changed`)
const vars = {}
for (const m of chunk.matchAll(/var (\w+)="\.\/fonts\/(Xiaolai|Excalifont)\/([^"]+)"/g)) vars[m[1]] = { fam: m[2], file: m[3] }
const fonts = []
for (const m of chunk.matchAll(/\{uri:(\w+)(?:,descriptors:\{unicodeRange:("[^"]*"|[\w.]+)[^}]*\})?\}/g)) {
  const v = vars[m[1]]
  if (!v) continue
  fonts.push({ ...v, range: m[2]?.startsWith('"') ? JSON.parse(m[2]) : 'U+0-10FFFF' })
}
if (!fonts.some((f) => f.fam === 'Xiaolai') || !fonts.some((f) => f.fam === 'Excalifont')) throw new Error('font table parse failed')

for (const fam of ['Excalifont', 'Xiaolai']) {
  rmSync(`public/fonts/${fam}`, { recursive: true, force: true })
  cpSync(join(prod, 'fonts', fam), `public/fonts/${fam}`, { recursive: true })
}
writeFileSync('src/fonts.json', JSON.stringify(fonts))
rmSync(tmp, { recursive: true, force: true })
console.log(`fonts: ${fonts.length} files → public/fonts, src/fonts.json`)
