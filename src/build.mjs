// Pre-renders the sprite into finished ANSI rows.
//
// The status line runs once a second forever, so it must be cheap. Doing the
// GIF decode and the resampling here means the runtime only reads a small JSON
// file and picks an index out of it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { renderFrames } from './render.mjs'
import { prepare } from './prepare.mjs'
import { CHAFA_CELL, hasChafa, renderWithChafa } from './chafa.mjs'
import { sharedBounds } from './render.mjs'
import { FRAMES_FILE, ROOT, loadConfig } from './config.mjs'

// Evenly spaced pick, keeping the first frame and never repeating one.
const sample = (frames, limit) => {
  if (frames.length <= limit) return frames

  const picked = []

  for (let i = 0; i < limit; i++) {
    picked.push(frames[Math.floor((i * frames.length) / limit)])
  }

  return picked
}

const config = loadConfig()
const spritePath = isAbsolute(config.sprite) ? config.sprite : join(ROOT, config.sprite)

// PNG or GIF, decided by the file's own magic bytes.
const file = readFileSync(spritePath)
const gif = prepare(decodeSprite(file) ?? decodeGif(file), config.bounce, config.sheetFrames)
const chosen = sample(gif.frames, config.maxFrames)
// chafa knows the octant characters and chooses glyphs by searching for the
// best match rather than by majority vote, so it wins wherever it is available.
// The built-in renderer stays as the fallback and for terminals that can only
// manage half blocks.
const useChafa = config.renderer === 'chafa' && hasChafa()

let rendered

if (useChafa) {
  const box = sharedBounds(gif.frames, gif.width, gif.height)
  const cell = CHAFA_CELL[config.chafaSymbols] ?? CHAFA_CELL.octant

  // Ask for the size the sprite actually is at this many rows, so chafa is
  // matching pixels rather than inventing them.
  const cols = config.cols ?? Math.max(1, Math.round((box.width / box.height) * config.rows * (cell.height / cell.width)))

  const frames = renderWithChafa({ ...gif, frames: chosen }, {
    cols,
    rows: config.rows,
    symbols: config.chafaSymbols,
  })

  rendered = {
    rows: frames[0].rows.length,
    cols,
    factor: Math.round(box.height / (config.rows * cell.height)) || 1,
    palette: null,
    frames,
  }
} else {
  rendered = renderFrames(
    { ...gif, frames: chosen },
    {
      rows: config.rows,
      cols: config.cols,
      sampler: config.sampler,
      snap: config.snap,
      style: config.style,
      palette: config.palette,
      paletteChroma: config.paletteChroma,
      cellAspect: config.cellAspect,
    },
  )
}

// Sextants and octants live outside the Basic Multilingual Plane, and most
// terminal fonts stop at its edge. A missing glyph is not a crash — the
// terminal quietly draws a box with a question mark in it, once per cell, and
// the sprite becomes a wall of them. Cheaper to say so here than to find out by
// looking at the status line.
const glyphs = new Set()

for (const frame of rendered.frames) {
  for (const row of frame.rows) {
    for (const character of row.replace(/\x1b\[[0-9;]*m/g, '')) glyphs.add(character)
  }
}

const exotic = [...glyphs].filter((character) => character.codePointAt(0) > 0xffff)

mkdirSync(dirname(FRAMES_FILE), { recursive: true })
writeFileSync(
  FRAMES_FILE,
  `${JSON.stringify({
    sprite: config.sprite,
    rows: rendered.rows,
    cols: rendered.cols,
    frames: rendered.frames.map((frame) => frame.rows),
  })}\n`,
)

console.log(
  `built ${rendered.frames.length} frames from ${config.sprite}\n` +
    (gif.sheet ? `  sheet    ${gif.sheet.count} ${gif.sheet.layout} frames of ${gif.width}x${gif.height}\n` : '') +
    (gif.native ? `  native   recovered ${gif.width}x${gif.height} from ${gif.native.from} (was upscaled ${gif.native.unit}x)\n` : '') +
    `  size     ${rendered.cols}x${rendered.rows} cells, ` +
    (useChafa ? `chafa ${config.chafaSymbols}\n` : `style ${config.style}, sampler ${config.sampler}\n`) +
    `  palette  ${rendered.palette ? `${rendered.palette} colours` : 'unchanged'}\n` +
    `  scaling  ${rendered.factor ? `${rendered.factor}x exactly` : 'fractional (not snapped)'}` +
    `${config.snap && rendered.rows !== config.rows ? ` — snapped rows ${config.rows} -> ${rendered.rows}` : ''}\n` +
    `  glyphs   ${glyphs.size} distinct, ${exotic.length ? `${exotic.length} outside the BMP` : 'all widely supported'}\n` +
    `  wrote    ${FRAMES_FILE}`,
)

if (exotic.length) {
  console.warn(
    `\n  Warning: style "${config.style}" uses ${exotic.length} glyphs that many terminal\n` +
      `  fonts do not have (${exotic.slice(0, 6).join(' ')}...). If the status line fills with\n` +
      `  boxes or question marks, run \`node src/fontcheck.mjs\`. Ghostty and Kitty draw\n` +
      `  these themselves; Terminal.app needs "quad" or "braille".\n`,
  )
}
