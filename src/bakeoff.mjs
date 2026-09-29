// Renders every sprite in assets/ at the same height, so they can be compared
// in the terminal that has to display them rather than on a web page.
//
// Usage: node src/bakeoff.mjs [rows]

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { renderFrames, sharedBounds } from './render.mjs'
import { loadConfig, ROOT } from './config.mjs'
import { prepare } from './prepare.mjs'

const config = loadConfig()
const rows = Number(process.argv[2]) || config.rows

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const sprites = readdirSync(join(ROOT, 'assets'))
  .filter((file) => /\.(gif|png)$/i.test(file))
  .sort()

console.log(`\n  ${BOLD}Every sprite at ${rows} rows${RESET}${DIM} — the same height, so the only difference is the artwork${RESET}\n`)

const summary = []

for (const file of sprites) {
  const raw = readFileSync(join(ROOT, 'assets', file))
  const image = prepare(decodeSprite(raw) ?? decodeGif(raw), config.bounce)

  const rendered = renderFrames(image, {
    rows,
    sampler: config.sampler,
    snap: config.snap,
    style: config.style,
    palette: config.palette,
    paletteChroma: config.paletteChroma,
    cellAspect: config.cellAspect,
  })

  // The sprite's own size, not the canvas it is centred on — a drawing in the
  // middle of a big empty square is small art, and that is what decides how
  // much it has to be reduced.
  const box = sharedBounds(image.frames, image.width, image.height)
  const native = `${box.width}x${box.height}`

  console.log(
    `  ${BOLD}${file}${RESET}${DIM}  native ${native}, ` +
      `${image.frames.length} frame${image.frames.length === 1 ? '' : 's'}, ` +
      `shown ${rendered.cols}x${rendered.rows} at ${rendered.factor}x${RESET}`,
  )

  for (const row of rendered.frames[0].rows) console.log(`    ${row}`)

  console.log('')

  summary.push({
    file,
    native,
    frames: image.frames.length,
    factor: rendered.factor,
    cols: rendered.cols,
    onePlusRows: Math.ceil(box.height / 2),
  })
}

console.log(`  ${BOLD}Summary${RESET}\n`)
console.log(`  ${'sprite'.padEnd(22)} ${'native'.padEnd(9)} ${'frames'.padEnd(7)} ${'at ' + rows + ' rows'.padEnd(9)} ${'1:1 needs'}`)

for (const s of summary) {
  console.log(
    `  ${s.file.padEnd(22)} ${s.native.padEnd(9)} ${String(s.frames).padEnd(7)} ` +
      `${(s.factor + 'x, ' + s.cols + ' cols').padEnd(12)} ${s.onePlusRows} rows`,
  )
}

console.log(`\n  ${DIM}Pick one, then: node src/use.mjs <sprite>${RESET}\n`)
