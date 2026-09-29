// Turning a sprite file into the escape sequences that draw it.
//
// Extracted from the pane because the Pokedex draws sprites too, and two copies
// of "scale pixel art down without ruining it" is exactly how one of them
// quietly gets worse — the whole project is an argument about that.
//
// Everything here is about the same problem: terminals draw in cells, sprites
// are drawn in pixels, and the conversion is where the quality is won or lost.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { prepare } from './prepare.mjs'
import { encodePng } from './pngwrite.mjs'
import { CACHE_VERSION, ROOT, STATE_DIR, loadConfig } from './config.mjs'
import { sharedBounds } from './render.mjs'
import { coloursFor, currentFormat, passthroughFor, symbolsFor } from './graphics.mjs'

const config = loadConfig()

// Low enough that speeding an animation up is not immediately swallowed by the
// floor. Most Gen-5 frames sit near 50ms already, so a 60ms floor clamped most
// of them and the working tempo came out barely faster than the idle one.
export const MIN_DELAY = 25

// Scratch space for the PNGs handed to chafa. Cleared on the way out rather
// than after the first load, because a sprite can be rendered at any time —
// a Pokemon switched to mid-session, a Pokedex card — not only at startup.
const dir = mkdtempSync(join(tmpdir(), 'pixel-runner-'))

process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
})

// Only worth doing for genuinely small sprites. Blowing up something already
// high-resolution just builds a huge PNG for chafa to shrink straight back down.
export const zoomFor = (size) => (size >= 64 ? 1 : Math.max(1, Math.ceil(96 / size)))

// Blow the sprite up by a whole number first, repeating each pixel as a hard
// square. chafa scales with a smoothing filter, which is right for photographs
// and ruinous for pixel art — it would round off exactly the edges the artist
// drew. Handing it something already near the final size leaves it little to
// smooth away.
const magnify = (pixels, width, height, factor) => {
  if (factor === 1) return pixels

  const wide = width * factor
  const out = new Uint8Array(wide * height * factor * 4)

  for (let y = 0; y < height * factor; y++) {
    const sourceY = Math.floor(y / factor)

    for (let x = 0; x < wide; x++) {
      const from = (sourceY * width + Math.floor(x / factor)) * 4
      const to = (y * wide + x) * 4

      out[to] = pixels[from]
      out[to + 1] = pixels[from + 1]
      out[to + 2] = pixels[from + 2]
      out[to + 3] = pixels[from + 3]
    }
  }

  return out
}

// Converting frames means writing a PNG and launching chafa for each one, and
// the two sprites here come to twenty-one of them — a second or more of empty
// pane on every launch. The result only changes when the sprite file, its size
// on screen or the settings that shape it change, so it is worth keeping.
const CACHE_DIR = join(STATE_DIR, 'cache')

// How this terminal is being drawn in, and everything that changes those bytes.
//
// Read at call time rather than at import, because the pane asks the terminal
// what it supports and writes the answer down *before* it loads a sprite —
// a module-level constant here would be the guess made a moment too early.
const drawnAs = () => ({
  format: currentFormat(config),
  passthrough: passthroughFor(config),
  colours: coloursFor(),
  symbols: symbolsFor(config),
})

const cacheKeyFor = (path, cellRows, sheetFrames, flip, range) => {
  const stat = statSync(path)
  const how = drawnAs()

  return createHash('sha1')
    .update(
      [
        CACHE_VERSION,
        path,
        stat.mtimeMs,
        stat.size,
        cellRows,
        config.bounce,
        JSON.stringify(sheetFrames ?? null),
        flip ? 'flip' : '',
        JSON.stringify(range ?? null),
        // A cache entry is escape sequences, not pixels, so anything that
        // changes which escape sequences chafa emits has to be in the key. It
        // was not, and it did not need to be while there was exactly one
        // format — the day there were four, a sixel terminal would have been
        // handed the kitty frames some other terminal warmed.
        how.format,
        how.passthrough,
        how.colours,
        how.symbols,
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 16)
}

// The white shape of a sprite. Evolving in the games is two silhouettes traded
// back and forth, so this is the only extra artwork the transition needs — one
// image per sprite, rendered once alongside it.
//
// The original alpha is kept rather than forced to opaque, so the soft edge the
// artist drew stays soft instead of gaining a hard white fringe.
export const silhouette = (pixels) => {
  const out = new Uint8Array(pixels.length)

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue

    out[i] = 255
    out[i + 1] = 255
    out[i + 2] = 255
    out[i + 3] = pixels[i + 3]
  }

  return out
}

// Everything needed to play one sprite: its frames already converted to image
// escape sequences, and how long each is held.
export const loadSprite = (name, label, cellRows, sheetFrames, flip = false, range = null) => {
  const path = isAbsolute(name) ? name : join(ROOT, name)

  const cacheFile = join(CACHE_DIR, `${cacheKeyFor(path, cellRows, sheetFrames, flip, range)}.json`)

  if (existsSync(cacheFile)) {
    try {
      return { name, ...JSON.parse(readFileSync(cacheFile, 'utf8')) }
    } catch {}
  }

  const raw = readFileSync(path)

  const decoded = decodeSprite(raw) ?? decodeGif(raw)
  const whole = prepare(decoded, config.bounce, sheetFrames)

  // A window of frames, for an animation that is longer than the moment it is
  // wanted for. `sliceSheet` cannot do this — it only takes apart a single
  // image laid out as a grid, and returns a real GIF untouched.
  //
  // Either one window, `[from, to]`, or several played back to back,
  // `[[from, to], [from, to]]` — for when the part worth keeping is in two
  // places and the frames between them are not wanted at all.
  const windows = !range ? null : Array.isArray(range[0]) ? range : [range]
  const image = windows ? { ...whole, frames: windows.flatMap(([from, to]) => whole.frames.slice(from, to)) } : whole

  // Crop to the sprite itself. A frame is mostly empty — the overworld one is
  // 17x18 of artwork centred in 32x32 — and drawing the padding would waste
  // nearly half the pane on nothing.
  const box = sharedBounds(image.frames, image.width, image.height)
  const zoom = zoomFor(Math.max(box.width, box.height))
  const cols = Math.max(1, Math.round((box.width / box.height) * cellRows * 2))

  // Mirroring is done here rather than to the file, because it costs nothing at
  // this point and the alternative is converting a GIF with tools this machine
  // does not have. It is baked into the cache, so it is paid once.
  //
  // What it is for: an animation whose effect reaches out to one side puts the
  // Pokemon at the far end of its own frame. Mirroring turns "body on the right,
  // fire going left" into "body on the left, fire going right", which lines the
  // body up with the resting sprite instead of throwing it across the pane.
  const crop = (pixels) => {
    const out = new Uint8Array(box.width * box.height * 4)

    if (!flip) {
      for (let y = 0; y < box.height; y++) {
        const from = ((box.y + y) * image.width + box.x) * 4

        out.set(pixels.subarray(from, from + box.width * 4), y * box.width * 4)
      }

      return out
    }

    for (let y = 0; y < box.height; y++) {
      for (let x = 0; x < box.width; x++) {
        const from = ((box.y + y) * image.width + (box.x + box.width - 1 - x)) * 4
        const to = (y * box.width + x) * 4

        out[to] = pixels[from]
        out[to + 1] = pixels[from + 1]
        out[to + 2] = pixels[from + 2]
        out[to + 3] = pixels[from + 3]
      }
    }

    return out
  }

  // One already-cropped frame to the escape sequence that draws it.
  const how = drawnAs()

  const toFrame = (pixels, slot) => {
    const file = join(dir, `${label}-${slot}.png`)

    // Recreated rather than assumed. The scratch directory is deleted once the
    // opening sprites are converted, and a Pokemon switched to mid-session
    // whose frames are not in the cache has to write its PNGs somewhere.
    mkdirSync(dir, { recursive: true })

    writeFileSync(file, encodePng(magnify(pixels, box.width, box.height, zoom), box.width * zoom, box.height * zoom))

    const result = spawnSync(
      'chafa',
      [
        '--format', how.format,
        // Only where they change something, so the kitty path emits byte for
        // byte what it always did. That matters more than tidiness here: those
        // bytes are what every existing cache holds and what the one tested
        // setup draws.
        //
        // `--colors` is symbols-only because the pixel formats carry their own
        // colour. chafa normally works this out from the terminal it writes to
        // and cannot: its output is a pipe into the cache, so it sees no
        // terminal and falls back to 16 colours, which turns a sprite to mud.
        ...(how.format === 'symbols' ? ['--colors', how.colours, '--symbols', how.symbols] : []),
        // A multiplexer swallows a graphics sequence unless it is wrapped in
        // the multiplexer's own envelope. chafa's `auto` cannot see one either,
        // for the same reason: it is looking at a pipe.
        ...(how.passthrough === 'none' ? [] : ['--passthrough', how.passthrough]),
        // The width is worked out from the sprite's own proportions and the
        // pane's height, so the box already has the sprite's shape and the
        // image comes back filling it exactly — no gap to centre inside.
        //
        // Not --align. That positions by emitting leading newlines, measured
        // against chafa's view rather than this box: nine of them in testing,
        // which in a four row pane scrolls the sprite off the top.
        '--size', `${cols}x${cellRows}`,
        '--animate', 'off',
        '--polite', 'on',
        file,
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )

    if (result.status !== 0) {
      console.error(`chafa failed on ${name}: ${(result.stderr ?? '').trim()}`)
      process.exit(1)
    }

    // chafa wraps its output in cursor hiding and a trailing newline; we drive
    // the cursor ourselves so the frames land on top of each other.
    //
    // C=1 tells the terminal not to move the cursor past the image. Without it
    // the cursor is pushed to the row after the last one the image occupies —
    // which, when the image fills the pane exactly, is off the bottom, so the
    // pane scrolls and takes the sprite's top row with it. That is the clipped
    // ears and the empty row underneath: the image is not too tall, it has been
    // shifted up out of view.
    return result.stdout
      .replace(/\x1b\[\?25[lh]/g, '')
      .replace(/\x1b_Ga=T,/g, '\x1b_Ga=T,C=1,')
      .replace(/\n+$/, '')
  }

  // Each frame is converted once, up front. Re-running chafa every frame would
  // spend more time launching processes than drawing.
  //
  // And a pose is converted once, however many frames hold it. GIFs hold a pose
  // by repeating the frame — the Pokeball's rock is three pictures across
  // eight frames — and a chafa run apiece was most of what a cold ball cost.
  const converted = new Map()

  const frames = image.frames.map(({ pixels }, index) => {
    const cropped = crop(pixels)
    const key = createHash('sha1').update(cropped).digest('hex')

    if (!converted.has(key)) converted.set(key, toFrame(cropped, index))

    return converted.get(key)
  })

  // The pose the flicker trades against. Taken from the first frame, which is
  // the one the sprite is switched to anyway.
  const ghost = toFrame(silhouette(crop(image.frames[0].pixels)), 'ghost')

  // Each frame's own delay, not one delay for all of them. A sprite animation
  // is rarely evenly timed — one of these opens on a 650ms pose then runs at 50
  // — so a single interval plays the whole thing at the speed of its longest
  // pause.
  const delays = image.frames.map(({ delay }) => Math.max(MIN_DELAY, delay || 200))

  //  is recorded so the pruner can tell which sprite a cache entry came
  // from. The key is a hash, so without this an entry whose sprite has been
  // deleted is unattributable and simply accumulates.
  const sprite = { v: CACHE_VERSION, name, box, zoom, cols, rows: cellRows, frames, delays, ghost }

  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(cacheFile, JSON.stringify(sprite))
  } catch {}

  return { name, ...sprite }
}
