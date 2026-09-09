// Everything the project needs lives inside this folder, including the runtime
// state, so the whole thing can be deleted in one go.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The one thing that must outlive an update.
//
// Everything else this project writes lives under ROOT, which is the right place
// for it: a cache belongs to the copy that built it, and deleting the folder
// deletes the lot. But a plugin's ROOT is version-stamped —
// `.../cache/pokemanion/pokemanion/1.7.0/` — so `/plugin update` does not update
// a folder, it makes a new one. Everything in the old `.state` is simply gone.
//
// For a cache that is wasteful. For a record of something said to *you* it is a
// bug: the hello is meant to be shown once, and it was shown again after every
// single update, because the file remembering that it had been shown was in the
// folder that got replaced.
//
// So facts about the person rather than about the copy live here, outside any
// version. It holds one file today and should stay that small.
export const HOME_DIR = join(homedir(), '.pokemanion')

export const CONFIG_FILE = join(ROOT, 'config.json')
export const FRAMES_FILE = join(ROOT, 'build', 'frames.json')
export const STATE_DIR = join(ROOT, '.state')

// Bumped whenever a cached sprite gains a field or the way one is built
// changes. It goes into the cache key, so old entries can never be read back
// wrong — but that also means they are never read at all, and nothing would
// delete them: two bumps left 42MB and then 36MB of unreachable frames lying
// around. Every entry records the version it was written under so the pruner
// can sweep the ones that no longer match.
export const CACHE_VERSION = 5
export const STATE_FILE = join(STATE_DIR, 'activity.json')

export const DEFAULTS = {
  // Which sprite to animate. Any GIF works; run `npm run build` after changing it.
  sprite: 'assets/pikachu-icon.png',

  // Height on screen in terminal cells. Each cell is two pixels tall, so rows: 8
  // means a 16 pixel tall sprite. Width is worked out from the sprite's own
  // proportions; set `cols` to a number only if you want to override that.
  rows: 8,
  cols: null,

  // 'chafa' hands rendering to the chafa command, which knows the octant
  // characters (8 pixels to a cell, against 2 for a half block) and picks
  // glyphs by searching for the closest match. Needs a terminal that can draw
  // them — Ghostty and Kitty draw them themselves, Terminal.app cannot.
  // 'builtin' uses our own renderer and works anywhere.
  renderer: 'builtin',

  // Which characters chafa may use: octant, sextant, quad, half, braille, block.
  chafaSymbols: 'octant',

  // How many times taller a character cell is than it is wide. Two is the usual
  // shape of a monospace cell, and it is why the half block ▀ works: it splits
  // the cell into two squares. A terminal set up with extra line spacing has
  // taller cells, and then those halves are not square any more and the sprite
  // comes out stretched. `npm run cellcheck` measures yours.
  cellAspect: 2,

  // How an output pixel is chosen from the source block behind it.
  //   mode    - most frequent colour. Keeps outlines and flat colour. Default.
  //   nearest - the middle source pixel. Crisp, but outlines come and go.
  //   outline - like mode, but favours dark pixels. Good very small.
  // Averaging is deliberately not offered: it dissolves the black outline into
  // the body colour and the sprite turns to mush.
  // 'outline' rather than 'mode' by default: a sprite's outline is one pixel
  // wide, so at any real reduction it is a minority of every block and majority
  // voting deletes it. Losing the outline is what turns a sprite into a blob.
  sampler: 'outline',

  // How many pixels are packed into one character cell. More pixels per cell is
  // more detail in the same number of rows, but a cell is one glyph with one
  // foreground and one background, so it can only hold two colours.
  //
  //   blocks  - 1 px  per cell. No glyph at all, just a background colour, so
  //             it is always solid even where line spacing breaks the others.
  //   half    - 2 px  (1x2) using ▀. Every colour exact.
  //   quad    - 4 px  (2x2). Two colours per cell.
  //   sextant - 6 px  (2x3). The best looking, if your font has the glyphs.
  //   braille - 8 px  (2x4). The most detail, in every font, but the dots do
  //             not fill the cell so it reads as dot matrix, one colour a cell.
  //
  // `npm run fontcheck` shows whether your font has each of them.
  style: 'half',

  // Snap to a whole-number reduction from the source. A fractional reduction
  // makes some blocks wider than others and straight edges come out ragged, so
  // this rounds `rows` to the nearest size that divides evenly. Worth far more
  // than any other setting here.
  snap: true,

  // Collapse the sprite to this many colours before shrinking it. A sprite has
  // more shades than survive the reduction, and neighbouring blocks landing on
  // different shades is what turns a flat belly into speckle. 0 disables it.
  palette: 7,

  // How much a colour being vivid counts for when choosing the palette, against
  // simply covering a lot of the sprite. Pikachu's red cheek is 1.4% of him and
  // would never survive on area, while two near-black greys from the sprite's
  // anti-aliasing would. 0 ranks purely by area.
  paletteChroma: 6,

  // A still sprite (a PNG) has no animation of its own, so we give it a hop of
  // this many pixels on a four step cycle. Ignored for sprites that already
  // animate. 0 leaves a still sprite still.
  bounce: 1,

  // Small sprites are usually distributed as a vertical strip of frames, often
  // holding several facing directions. Give the frame numbers of the ones you
  // want, zero based, e.g. [2, 5] for a side-on walk cycle. null uses them all.
  sheetFrames: null,

  // The sprite the pane window uses, when it should differ from the status
  // line's. Characters want small, hard-edged art; a real image wants the
  // largest, smoothest version available. null means use the same one.
  windowSprite: null,

  // What the pane shows while Claude is idle. The running sprite plays only
  // when there is something to run about; the rest of the time this one does.
  windowIdleSprite: null,

  // Give each session its own Pokemon from assets/pokemon, picked from the
  // session id so it stays the same for that window's lifetime. Set false to
  // use windowSprite and windowIdleSprite for every session instead.
  randomPokemon: true,

  // How much of each frame's own delay to keep while Claude works, so 0.4 is
  // two and a half times faster. The working sprite is the Gen-5 back sprite,
  // which is the same Pokemon turned away from you; those move less on their
  // own than the front ones do, and the speed-up is what turns "facing the
  // other way" into "hard at it". 1 plays it as drawn.
  //
  // A roster entry whose working sprite is already a run cycle sets its own —
  // Pikachu's is 70ms a frame and wants none of this.
  busySpeed: 0.4,

  // Append every status line payload to .state/payloads.jsonl. Only useful for
  // working out what Claude Code actually reports; leave it off.
  logPayloads: false,

  // Open the sprite window automatically when a Claude session starts. macOS
  // will not let a split be scripted, so this is a small separate Ghostty
  // window. Only one is ever opened, however many sessions you run.
  autoWindow: false,

  // 'split'  puts the sprite in a pane of the Claude window, by simulating the
  //          split keystroke. Needs Ghostty enabled under Privacy & Security >
  //          Accessibility, because macOS offers no other way to split it.
  // 'window' opens a small separate window instead. Needs no permissions.
  windowMode: 'window',

  // How many times to press the shrink-the-split key. Ghostty's new_split
  // always takes half the window and its resize action moves a fixed step, so
  // the pane has to be squeezed down by repetition. Overshooting is safe — the
  // pane stops at its minimum — so this errs high. Lower it if the pane ends up
  // smaller than you want on a short window. Each press is ten pixels, so a
  // half-height split on a tall window needs a great many of them.
  splitShrink: 120,

  // Presses back up after the squash, to land on the height you want. Start at
  // 0, see what `npm run doctor` reports the pane measured, and add one press
  // per ten pixels you are short.
  splitGrow: 0,

  // Off by default, because it is no longer what makes the sprite fit: the
  // frames are rendered to whatever height the pane actually settled on, so the
  // sprite conforms to the pane rather than the pane to the sprite. Leaving it
  // on costs up to a second and a half of keypresses against an empty pane.
  //
  // Turn it on only if you want the pane forced to an exact row count.
  autoFit: false,
  windowRows: 3,

  // Only used by `windowMode: 'window'`, and as a fallback when there is no
  // terminal to ask. A split has no width of its own — it spans the terminal —
  // so in the mode almost everyone runs, this number does nothing.
  //
  // 38 rather than 34 because of one line of text, in that narrow mode: the dex
  // card draws beside the sprite, and Ash's ends with `Goal : Become a "Pokemon
  // Master"` — 32 columns against the 28 that a 5-column sprite and its gap left.
  // Four columns short wraps onto the next row, onto the sprite, and the card is
  // erased by overwriting its own width, so the remainder would stay after the
  // card had gone.
  //
  // I widened this believing it was the width of the pane you actually see. It
  // is not, and in a split Ash's card always had the room.
  windowCols: 38,

  // Whether the status line draws the sprite at all. Off leaves it as plain
  // text, for when the sprite is running in a pane of its own — a pane is not
  // bound by the status line's refresh, so it animates at the sprite's real
  // speed and there is no reason to draw it twice.
  statusSprite: true,

  // How long a frame is held. The status line cannot refresh faster than once a
  // second on a timer, but it also re-runs whenever a message updates, so a
  // shorter frame makes the animation move during busy stretches.
  frameMs: 200,

  // The source GIF has more frames than a 1fps floor can show. Sampling it down
  // means a full cycle completes in a few seconds instead of half a minute.
  maxFrames: 12,

  // Keep animating when nothing is happening, or stand still.
  animateWhenIdle: false,

  // How long after the last hook we still count as working.
  workingTimeoutMs: 120_000,

  // How long the transcript may go without growing before the sprite settles.
  //
  // This is the backstop for every way a turn can end without a closing hook —
  // an interruption, a declined tool, a question Claude is still waiting on.
  // The interruption marker in the transcript is the fast path and acts at
  // once; this only covers the cases that leave no marker either.
  //
  // Deliberately patient. Claude writes to the transcript every few seconds
  // while working, but a long stretch of thinking has been measured at fifteen
  // — so anything much tighter settles the sprite mid-thought and it flickers
  // between the two animations, which looks far worse than a late finish.
  idleAfterMs: 20_000,

  // Ask GitHub whether a newer version exists, at most once a day, in a detached
  // process nothing waits on — and say so once per version. It never installs
  // anything: updating is one command, and which command depends on how this was
  // installed, so both routes are told the right one.
  updateCheck: true,

  // The version in the pane's bottom-right corner, and nothing else — it said
  // `v1.2.0 -> 1.3.0` when an update was waiting, which asks you to work out
  // which number is which. Hidden while a card is up, and wherever the working
  // sprite is wide enough to reach that corner. Also gates the update card.
  showVersion: true,
}

export const loadConfig = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export const saveConfig = (patch) => {
  const next = { ...loadConfig(), ...patch }

  writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`)

  return next
}

// State is per session, not per machine. Two Claude sessions in two windows
// each get their own sprite, and each sprite follows its own session — a tool
// call in one window must not set the other one running.
const SESSIONS_DIR = join(STATE_DIR, 'sessions')

const safe = (id) => String(id ?? 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)

export const sessionStateFile = (id) => join(SESSIONS_DIR, `${safe(id)}.json`)

export const readState = (id) => {
  try {
    return JSON.parse(readFileSync(sessionStateFile(id), 'utf8'))
  } catch {
    return null
  }
}

export const writeState = (id, state) => {
  try {
    if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true })

    writeFileSync(sessionStateFile(id), JSON.stringify(state))
  } catch {}
}

export const heartbeatFile = (id) => join(SESSIONS_DIR, `${safe(id)}.beat.json`)

// Written by the status line every time it runs, read by the sprite. Kept apart
// from the hook state because it answers a different question: the hooks say
// what Claude was last asked to do, this says whether it is still doing it.
export const writeHeartbeat = (id, beat) => {
  try {
    if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true })

    const previous = readHeartbeat(id)

    // Only move the timestamp when the numbers actually moved. A heartbeat that
    // refreshed on every run would prove nothing — the status line runs whether
    // or not anything is happening.
    const moved = !previous || previous.api !== beat.api || previous.out !== beat.out

    writeFileSync(
      heartbeatFile(id),
      JSON.stringify({ ...beat, movedAt: moved ? beat.at : (previous?.movedAt ?? beat.at) }),
    )
  } catch {}
}

export const readHeartbeat = (id) => {
  try {
    return JSON.parse(readFileSync(heartbeatFile(id), 'utf8'))
  } catch {
    return null
  }
}

export const clearState = (id) => {
  try {
    unlinkSync(heartbeatFile(id))
  } catch {}

  try {
    unlinkSync(sessionStateFile(id))
  } catch {}
}
