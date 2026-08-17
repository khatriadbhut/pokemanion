// The sprite as a real image, in its own window.
//
// Characters are a compromise: the smallest thing a terminal can draw with them
// is a fraction of a cell, which is roughly eight times a game console's pixel,
// so a sprite is either small or detailed and never both. Terminals that speak
// the kitty graphics protocol have no such limit — the image is drawn at screen
// resolution and can occupy as few rows as you like while staying sharp.
//
// Claude Code strips those sequences out of the status line, so this cannot go
// there. It can go in a window of its own, next to it.
//
// Two sprites, switched by what Claude is doing: one for waiting, one for
// working. The hooks write that state to a file and this polls it.
//
// Usage: npm run window [rows] [busySprite] [idleSprite]

import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanLines } from './interrupt.mjs'
import { ROOT, STATE_DIR, loadConfig, readState } from './config.mjs'
import { MIN_DELAY, loadSprite } from './sprite.mjs'
import { alignFor, busyFile, busySpeedFor, flipBusyFor, idleFile, touch, transitionFor } from './roster.mjs'
import { entry as dexEntry, paneCard } from './dex.mjs'
import { available as updateAvailable, cornerText, installedVersion } from './update.mjs'

const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR = '\x1b[2J'

// An image sent through the graphics protocol is a *placement*, and placements
// accumulate: drawing a second frame does not replace the first, it lands on
// top of it, so the whole walk cycle piles up on screen at once. Moving the
// cursor does nothing about it — placements have to be deleted explicitly.
// a=d clears them while leaving the transmitted image data alone.
const DELETE_PLACEMENTS = '\x1b_Ga=d\x1b\\'

const config = loadConfig()
const args = process.argv.slice(2)
const sessionArg = args.find((a) => a.startsWith('--session='))?.slice('--session='.length) ?? null
const speciesArg = args.find((a) => a.startsWith('--species='))?.slice('--species='.length) ?? null

// A Pokemon that was asked for at launch and is still downloading. The pane
// opens on the closed Pokeball and waits for it — see the ball below.
const pendingArg = args.find((a) => a.startsWith('--pending='))?.slice('--pending='.length) ?? null
const [rowsArg, busyArg, idleArg] = args.filter((a) => !a.startsWith('--'))
const rows = Number(rowsArg) || 4

// Claim the window, so the SessionStart hook knows not to open a second one.
const PID_FILE = join(STATE_DIR, `window-${sessionArg ?? 'default'}.pid`)

// A note left by closeWindow when the session ended before this pane had
// written its pid. Opening a pane takes a second or two — split the terminal,
// type a command, boot node — and a session that ends inside that window found
// nothing to kill. The pane then finished starting with nobody left to own it
// and ran forever, a sprite for a session that no longer exists.
//
// Checked here and on every poll, because the note can arrive at either moment.
const CLOSED_FILE = join(STATE_DIR, `window-${sessionArg ?? 'default'}.closed`)

const wasClosed = () => {
  try {
    if (!existsSync(CLOSED_FILE)) return false

    unlinkSync(CLOSED_FILE)

    return true
  } catch {
    return false
  }
}

if (wasClosed()) process.exit(0)

try {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(PID_FILE, String(process.pid))
} catch {}

const releasePid = () => {
  try {
    if (readFileSync(PID_FILE, 'utf8').trim() !== String(process.pid)) return
  } catch {
    return
  }

  try {
    unlinkSync(PID_FILE)
  } catch {}

  // And the Pokemon it was holding, so the next terminal opened can have it.
  // This is the ordinary way Pikachu comes free: close the window it was in and
  // the next one gets it.
  try {
    unlinkSync(join(STATE_DIR, `window-${sessionArg ?? 'default'}.species`))
  } catch {}
}

process.on('exit', releasePid)

// Resize the pane until it is exactly as tall as the sprite.
//
// Ghostty resizes in pixels while the sprite is measured in rows, and the cell
// height joining the two is not something the CLI will report. Rather than
// guess at font metrics, this nudges the divider one step at a time and reads
// the result back out of the terminal itself: process.stdout.rows is the pane's
// real height, so the loop can see whether the last press helped.
//
// A step is ten pixels and a row is more than that, so several presses may pass
// with no change — hence pressing until the row count moves rather than
// assuming one press is one row.
const writeTrace = (lines) => {
  try {
    writeFileSync(join(STATE_DIR, 'fit.log'), `${lines.join('\n')}\n`)
  } catch {}
}

const KEY_DOWN = 125
const KEY_UP = 126
const STEP_PAUSE = 45

const nudge = (code, times) => {
  const press = `        key code ${code} using {command down, control down}`

  spawnSync(
    'osascript',
    ['-e', `tell application "System Events"\n${Array.from({ length: times }, () => press).join('\n')}\n        end tell`],
    { encoding: 'utf8' },
  )
}

// Deliberately asynchronous. The terminal reports a resize by sending SIGWINCH,
// and node only refreshes process.stdout.rows when it gets round to handling
// that signal — so a loop that blocks between presses would keep reading the
// old height and press forever.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fitToSprite = async (target) => {
  if (!process.stdout.isTTY) return null

  // Recorded so a pane that settles on the wrong height can be diagnosed from
  // what actually happened rather than from a guess about cell heights.
  const trace = [`target ${target}`]
  let stuck = 0

  // Bounded, because a pane already at its minimum can never reach a smaller
  // target and the loop would otherwise press forever.
  for (let attempt = 0; attempt < 40; attempt++) {
    const current = process.stdout.rows

    if (current === target) {
      trace.push(`reached ${current}`)
      writeTrace(trace)

      return current
    }

    trace.push(`${current} -> press ${current > target ? 'down' : 'up'}`)

    nudge(current > target ? KEY_DOWN : KEY_UP, 1)
    await sleep(STEP_PAUSE)

    // A step is ten pixels and a row is taller than that, so a press that
    // changes nothing is normal. Several in a row means we are against a limit.
    stuck = process.stdout.rows === current ? stuck + 1 : 0

    if (stuck > 8) {
      trace.push(`stuck at ${process.stdout.rows} after ${stuck} presses with no change`)
      writeTrace(trace)

      return process.stdout.rows
    }
  }

  trace.push(`gave up at ${process.stdout.rows} after 40 attempts`)
  writeTrace(trace)

  return process.stdout.rows
}

const fitted = config.autoFit === false ? null : await fitToSprite(rows)

// Convert the frames only once the pane has stopped moving, and to the height
// it actually settled on rather than the height that was asked for. Rendering
// first and resizing afterwards is what leaves the sprite too tall for its pane
// — the top gets clipped and the leftover row sits empty below it.
const paneRows = Math.max(1, process.stdout.rows || rows)

// Which Pokemon this session gets is decided by whatever launched this, and
// passed in — the launcher can see how many other sprite windows are up, which
// is what makes the first one Pikachu.
// Below this the two sprites are not being compared, they are being confused.
//
// Native height only means the same thing for both when both were drawn at the
// same scale — two Gen-5 rips, say. Pikachu's pair is 40px of pixel art beside
// 285px of smooth animation that no pixel grid could be recovered from: the
// same character, drawn at wildly different resolutions, and dividing one by
// the other says 0.14 as if Pikachu shrank to a seventh of himself. Treating a
// gap that large as "not comparable" and giving both the full pane is what
// keeps Pikachu and Ash exactly as they were.
const RELATIVE_FLOOR = 0.8

let species = speciesArg ?? null
let idle
let busy
let busySpeed
let transition
let align

// Everything that depends on which Pokemon this is, in one place so it can be
// done again. It has to be repeatable because the Pokemon can now change while
// the pane is up — see `checkSpecies` below.
const useSpecies = (name) => {
  species = name

  const flipBusy = busyArg || idleArg ? false : flipBusyFor(species)

  const idleSprite = idleArg ?? (species ? idleFile(species) : (config.windowIdleSprite ?? config.sprite))
  const busySprite = busyArg ?? (species ? busyFile(species) : (config.windowSprite ?? config.sprite))

  // Two animations, both facing you: the Pokemon while it waits, and its shiny
  // palette while it works. Both play as their artists drew them.
  idle = loadSprite(idleSprite, 'idle', paneRows, config.sheetFrames)
  busy = loadSprite(busySprite, 'busy', paneRows, config.sheetFrames, flipBusy)

  // Let the two differ in size, a little. Stretching both to the pane height
  // makes them exactly as tall as each other whatever they really are, which is
  // right when they are the same file recoloured and wrong when one was
  // supplied by hand. The taller keeps the full pane, so nothing gets smaller
  // than it would have been; the other is scaled against it.
  const tallest = Math.max(idle.box.height, busy.box.height)

  const rowsFor = (sprite) => {
    const share = sprite.box.height / tallest

    return Math.max(1, Math.round(paneRows * (share < RELATIVE_FLOOR ? 1 : share)))
  }

  // Only re-render when it actually changes the row count — the common case is
  // two sprites of identical size, which must cost nothing.
  if (rowsFor(idle) !== paneRows) idle = loadSprite(idleSprite, 'idle', rowsFor(idle), config.sheetFrames)

  if (rowsFor(busy) !== paneRows) busy = loadSprite(busySprite, 'busy', rowsFor(busy), config.sheetFrames, flipBusy)

  busySpeed = busyArg ? 1 : busySpeedFor(species, config.busySpeed ?? 1)

  // Only where the two sprites really are two different Pokemon. Pikachu and Ash
  // keep one identity across both of theirs, so flashing a silhouette between
  // them would announce a transformation that is not happening.
  transition = busyArg || idleArg ? null : transitionFor(species)

  align = busyArg || idleArg ? 'left' : alignFor(species)

  // Marks a guest as recently wanted, so the pruner evicts the ones nobody is
  // actually looking at rather than whichever happens to sort first.
  if (species) touch(species)
}

// The same check the live switch makes at `checkSpecies`, which startup went
// without for too long. A pane that threw here took its split down with it,
// which looks like the pane never opening at all rather than like a missing file.
const playable = (name) => !name || (existsSync(idleFile(name)) && existsSync(busyFile(name)))

// Named here because the wait below needs it, and the species poll further down
// reads the same file.
const SPECIES_FILE = join(STATE_DIR, `window-${sessionArg ?? 'default'}.species`)

// One idea rather than three: the Pokemon this pane is waiting for.
//
// It arrives two ways. `--pending` is the launcher saying so outright, because
// it knew before the split opened. The other is this pane being handed a name
// whose files are not on disk — a guest the pruner took while the session was
// closed — which used to be a crash and then, briefly, a silent fall back to
// Pikachu. Both are the same situation and both now get the Pokeball.
const waitingFor = pendingArg ?? (speciesArg && !playable(speciesArg) ? speciesArg : null)

// The launcher already started the download for a `--pending`. This is only for
// the case this pane worked out for itself, and starting a second one would
// mean two processes writing the same files.
if (waitingFor && !pendingArg) {
  try {
    const child = spawn(process.execPath, [join(ROOT, 'src', 'fetch.mjs'), waitingFor, SPECIES_FILE], {
      detached: true,
      stdio: 'ignore',
    })

    child.unref()
  } catch {}
}

try {
  useSpecies(waitingFor ? null : (speciesArg ?? null))
} catch {
  useSpecies(null)
}

// The Pokeball, played when a Pokemon *arrives* — the pane opening, or a
// species being switched to. Not when Claude starts or stops working.
//
// That distinction is the whole design. Waiting-to-working happens constantly
// and has to stay readable at a glance, so it gets the quick flash. Arriving
// happens when you ask for it, a handful of times a day, so it can afford a
// second and a half of ceremony. Playing the ball on every work switch would
// bury the signal under the celebration.
//
// The file is 86 frames and 3.4 seconds, most of it a ball sitting still: it
// only starts moving at frame 32 and has finished bursting open by 67. The
// window is the wobble and the burst, and it ends open — so the last thing on
// screen is a ball mid-burst, handing over to the Pokemon it just released.
const BALL_WINDOW = [30, 67]

const ball = config.pokeball === false ? null : loadSprite('assets/17-pokeball.gif', 'ball', paneRows, null, false, BALL_WINDOW)

// The other half of the same file: the ball before it starts moving.
//
// Frames 0 to 30 were never drawn by anything — the arrival window above starts
// at the wobble. They are the ball at rest, which is exactly what a pane waiting
// on a download should be showing.
//
// This is what `claude --kyogre` looks like now when kyogre is not on disk yet.
// The split opens on a closed ball instead of waiting, in silence, for a
// download it was going to be killed in the middle of anyway. When the files
// land, the claim file changes, and `checkSpecies` greets the new name with the
// wobble and the burst it plays for every arrival. The ball opens and the
// Pokemon is there, which is the right thing for a wait to turn into.
const BALL_CLOSED = [0, 30]

if (waitingFor) {
  try {
    const resting = loadSprite('assets/17-pokeball.gif', 'ballwait', paneRows, null, false, BALL_CLOSED)

    idle = resting
    busy = resting

    // No silhouette flash between the two: they are the same ball, and nothing
    // is transforming into anything yet.
    transition = null
  } catch {}
}

const ballFrames = () =>
  ball
    ? ball.frames.map((frame, index) => ({ frame, sprite: ball, delay: Math.max(MIN_DELAY, ball.delays[index]) }))
    : []

// Sprites sit on the bottom of the pane rather than the top, so two of
// different heights share a floor instead of a ceiling. Anything else has the
// shorter one hanging in mid-air, and switching between them looks like the
// Pokemon jumping.
//
// Horizontally they hug whichever edge the roster names, left unless told
// otherwise. Same reasoning, sideways: a sprite whose frame is mostly effect —
// Charizard's fire reaches left across two thirds of its own box — has its body
// at one end, and pinning the other end throws the body across the pane.
//
// A left-aligned sprite that fills the pane resolves to row 1, column 1, which
// is where everything was drawn before any of this existed.
const originFor = (sprite) => {
  const row = Math.max(1, paneRows - sprite.rows + 1)

  // A pipe reports no width, and falling back to the sprite's own width would
  // silently turn every right-aligned sprite into a left-aligned one — which is
  // exactly how this first appeared to work and did not. The configured pane
  // width is what a real pane is built to, so it is the honest stand-in.
  const width = process.stdout.columns || config.windowCols || sprite.cols
  const col = align === 'right' ? Math.max(1, width - sprite.cols + 1) : 1

  return `\x1b[${row};${col}H`
}

const delayFor = (sprite, frame) =>
  sprite === busy
    ? Math.max(MIN_DELAY, Math.round(sprite.delays[frame] * busySpeed))
    : sprite.delays[frame]

// Record the size the pane actually came out at. The split is sized by
// simulated keypresses measured in pixels, so this is the only way to see
// whether that landed on the wanted number of rows.
//
// Only from a real pane. Warming runs and tests write to a pipe, where there is
// no size to report, and recording their `0x0` overwrites the one number worth
// having — which is exactly what made this read `0x0` while a pane was up.
//
// It matters more than it looks. The frame cache is keyed by row count, so a
// pane that settles on a height nobody warmed has to run chafa on every frame:
// two seconds of frozen sprite the first time each Pokemon is shown, against
// three hundredths of a second when it was warmed for that height.
const SIZE_FILE = join(STATE_DIR, 'window.size')

if (process.stdout.isTTY) {
  try {
    writeFileSync(
      SIZE_FILE,
      `${process.stdout.columns ?? 0}x${process.stdout.rows ?? 0}${fitted === null ? '' : ` (fitted to ${rows})`}`,
    )
  } catch {}
}

process.stdout.write(HIDE_CURSOR + CLEAR + DELETE_PLACEMENTS)

const stop = () => {
  process.stdout.write(DELETE_PLACEMENTS + SHOW_CURSOR + '\n')
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

// The state of one specific session, written by that session's hooks. Keyed by
// session so a second Claude in another window cannot set this sprite running.
// Pressing escape fires no hook — Claude Code has no event for it, so the last
// hook still says "working" and the sprite would run on until it timed out.
//
// It does leave one trace: an interruptedMessageId appended to the session
// transcript. Watching the end of that file catches an interruption the moment
// it happens, which no amount of waiting on hooks can do.
let transcriptAt = null
let pending = ''
let interruptedAt = 0

// When the transcript last grew. Claude writes to it as it goes — a thought, a
// tool call, a result, every few seconds — so a transcript that has stopped
// moving is a Claude that has stopped working, whatever the hooks last said.
//
// This is the backstop, not the main signal: the interruption marker below is
// instant, and this only has to cover the cases where no marker and no closing
// hook ever arrive. Hence a patient threshold — a long stretch of thinking is
// genuinely quiet, and settling the sprite mid-thought would have it flickering
// between the two animations.
let movedAt = Date.now()

const scan = (chunk) => {
  pending += chunk

  const lines = pending.split('\n')

  // The last piece may be half a line whose remainder is not written yet; it
  // is held back and finished on the next read.
  pending = lines.pop() ?? ''

  interruptedAt = Math.max(interruptedAt, scanLines(lines.join('\n')))
}

const checkTranscript = (path) => {
  if (!path) return

  let size

  try {
    size = statSync(path).size
  } catch {
    return
  }

  // First look: start from the end. Everything before now is history, and
  // replaying it would report every interruption this session ever had.
  if (transcriptAt === null) {
    transcriptAt = size

    return
  }

  if (size !== transcriptAt) movedAt = Date.now()

  if (size <= transcriptAt) {
    // Truncated or replaced; resync rather than read nonsense.
    transcriptAt = size
    pending = ''

    return
  }

  try {
    const handle = openSync(path, 'r')
    const length = size - transcriptAt
    const buffer = Buffer.allocUnsafe(length)

    readSync(handle, buffer, 0, length, transcriptAt)
    closeSync(handle)

    scan(buffer.toString('utf8'))
  } catch {}

  transcriptAt = size
}

const isWorking = () => {
  const state = readState(sessionArg)

  checkTranscript(state?.transcript)

  if (state?.state !== 'working') return false

  // Measured against the start of the turn, not against the last hook to fire.
  //
  // Interrupting a tool call does not cancel that tool's PostToolUse. The
  // transcript shows why: the killed tool writes its tool_result on the same
  // millisecond as the interruption marker, so the hook is already on its way,
  // and a hook is a whole node start-up behind the file write. It therefore
  // lands after the interruption is noticed and stamps the state newer.
  //
  // Against the last hook that made a freshly interrupted session look like the
  // busiest one there is, and the sprite ran on for the full two minute
  // timeout — but only when a tool was in flight, which is why interrupting
  // Claude mid-thought always did settle it. Nothing but a new prompt starts a
  // turn, so nothing but a new prompt should be able to clear an interruption.
  if (interruptedAt > (state.promptAt ?? state.at ?? 0)) return false

  // A tool that started and has not reported back is genuinely in flight, and a
  // slow command writes nothing to the transcript for as long as it runs — so
  // while one is out, silence proves nothing and only the timeout applies.
  //
  // Everything else has to keep showing signs of life. This is what catches the
  // ways a turn can end without any closing hook: an interruption whose marker
  // never lands, a tool call declined at the permission prompt, a question
  // Claude asked and is still waiting on. All of them look identical from the
  // hooks' side — the last thing they said was "working" — and identical in the
  // transcript too: nothing more arrives.
  // Only when there is a transcript to have gone quiet. Without one there is
  // nothing to measure, and treating that as silence would leave the sprite
  // permanently still.
  if (state.transcript && !state.tool && Date.now() - movedAt > config.idleAfterMs) return false

  return Date.now() - (state.at ?? 0) < config.workingTimeoutMs
}

// Evolving, the way the games do it: the two shapes traded back and forth as
// white silhouettes, quicker each time, until the new one stays.
//
// Without this the sprite simply becomes a different Pokemon between one frame
// and the next, which reads as a glitch rather than a change — the swap is the
// whole idea, so it is worth the half second to show it happening.
//
// The acceleration is what sells it. Evenly spaced, it is a flashing light;
// speeding up, it is something resolving.
// Evolve: even, so the alternation ends on the shape being turned into rather
// than the one being left. An odd count flickers and lands back on the old
// Pokemon, and the hard cut it was meant to hide happens anyway on the very
// next frame.
const EVOLVE_STEPS = 8
const EVOLVE_FIRST = 130
const EVOLVE_LAST = 40

// Flash: odd, so it both opens and closes on white. The colour underneath is
// the sprite being revealed, so the last white frame hands straight over to the
// animation already showing it — there is no separate reveal to get wrong.
const FLASH_STEPS = 5
const FLASH_FIRST = 90
const FLASH_LAST = 40

const transitionFrames = (from, to) => {
  if (!transition || config.transitions === false) return []

  const evolving = transition === 'evolve'
  const steps = evolving ? EVOLVE_STEPS : FLASH_STEPS
  const first = evolving ? EVOLVE_FIRST : FLASH_FIRST
  const last = evolving ? EVOLVE_LAST : FLASH_LAST

  const out = []

  for (let i = 0; i < steps; i++) {
    const progress = i / (steps - 1)

    // Evolving trades two different silhouettes. A recolour has only one shape,
    // so trading silhouettes would show a white blob sitting still — it flashes
    // between white and the new colours instead.
    const sprite = evolving ? (i % 2 === 0 ? from : to) : to
    const frame = evolving || i % 2 === 0 ? sprite.ghost : sprite.frames[0]

    out.push({ frame, sprite, delay: Math.round(first + (last - first) * progress) })
  }

  return out
}

// Typing `--squirtle` at Claude writes that name to the claim file this pane
// already owns, and this is the half that notices. Swapping the sprites in
// place rather than reopening the window is the point: a new pane would be a
// new Ghostty split, stealing focus and losing everything on screen.
//
// Polled rather than watched, because fs.watch on a single file is unreliable
// across editors and atomic writes, and a stat every half second costs nothing
// next to the chafa work this pane already does.
// Reloading from the cache costs 3-10ms, so the poll interval is the entire
// delay you feel. A stat is a few microseconds; at this rate it is around seven
// a second, which is nothing beside the chafa work this pane already did.
const SPECIES_POLL_MS = 150

const stampOf = (path) => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

// Zero while waiting, so the first poll reads the claim rather than comparing
// against it.
//
// This line is reached after the Pokeball has been converted, a second or so
// into starting up, and the download it is waiting for takes about the same. So
// the claim could already have been written by the time this ran — and recording
// its timestamp here means recording it as already seen. The pane then sat on a
// closed ball forever, waiting for a change that had happened while it booted.
//
// Nothing is lost by starting at zero: a stamp of zero means no claim file at
// all, and the poll below treats any real one as news.
let speciesAt = waitingFor ? 0 : stampOf(SPECIES_FILE)
let speciesCheckedAt = Date.now()

const checkSpecies = () => {
  // Sprites named on the command line are the ones being worked on; a session
  // switching underneath them would be the opposite of what was asked for.
  if (!sessionArg || busyArg || idleArg) return

  if (Date.now() - speciesCheckedAt < SPECIES_POLL_MS) return

  speciesCheckedAt = Date.now()

  checkCard()

  const stamp = stampOf(SPECIES_FILE)

  if (stamp === 0 || stamp === speciesAt) return

  speciesAt = stamp

  let name

  try {
    name = readFileSync(SPECIES_FILE, 'utf8').trim().toLowerCase()
  } catch {
    return
  }

  // An unreadable or unknown name leaves the pane exactly as it is. Half a
  // sprite is worse than the wrong sprite.
  if (!name || !existsSync(idleFile(name)) || !existsSync(busyFile(name))) return

  // Note there is no "same name, nothing to do" shortcut. Rewriting the current
  // name is the way to make a pane pick up a sprite that changed underneath it —
  // swapping which file an entry points at, or re-warming the cache — without
  // closing the window. It costs a few milliseconds from cache.

  useSpecies(name)

  index = 0
  process.stdout.write(CLEAR)

  // A Pokemon arriving, so the ball opens for it. Queued rather than drawn
  // here: the frame loop is what owns the screen, and fighting it for the
  // cursor is how placements end up stacked on top of each other.
  evolving = ballFrames()
  showCard(name)
}

// Stats shown beside the sprite for a few seconds, then gone.
//
// The pane is four rows and the whole width of the window; the sprite uses
// about eight columns of it. The rest has always been empty, and this is what
// it is for — `--dex current` writes the lines here and the pane shows them
// where you are already looking, rather than in the conversation.
//
// Timed out rather than dismissed: it is a glance, not a panel, and anything
// that needs closing is worse than the empty space it replaced.
const CARD_FILE = join(STATE_DIR, `window-${sessionArg ?? 'default'}.card`)
const CARD_GAP = 3

let cardAt = stampOf(CARD_FILE)
let cardLines = []
let cardUntil = 0
let cardDrawnAt = 0

// The pane describing itself, whenever what it is showing changes: rolled with
// --random, switched with --squirtle, or just opened. The card always matches
// the Pokemon under it, which is the rule that makes this coherent — a lookup
// of something *else* (`--dex dragonite`, `--dex random`) stays in the
// conversation, because putting those here would caption the wrong animal.
const showCard = (name) => {
  if (!name || config.cardMs === 0) return

  try {
    cardLines = paneCard(dexEntry(name), paneRows)
    cardUntil = Date.now() + (config.cardMs ?? 8000)
  } catch {}
}

const checkCard = () => {
  const stamp = stampOf(CARD_FILE)

  if (stamp === 0 || stamp === cardAt) return

  cardAt = stamp

  try {
    cardLines = readFileSync(CARD_FILE, 'utf8').split('\n').filter(Boolean).slice(0, paneRows)
  } catch {
    return
  }

  cardUntil = Date.now() + (config.cardMs ?? 8000)
  process.stdout.write(CLEAR)
}

// Redrawn every frame rather than once, because the sprite underneath is
// redrawn every frame and the two share the pane. Erased by overwriting with
// spaces: the text sits in cells, the sprite is an image placement, and
// clearing lines wholesale would take one without the other.
const drawCard = (sprite) => {
  const showing = Date.now() < cardUntil

  if (!showing && cardDrawnAt === 0) return

  const col = sprite.cols + CARD_GAP
  const width = Math.max(...cardLines.map((line) => line.length), 1)

  for (let i = 0; i < Math.max(cardLines.length, cardDrawnAt); i++) {
    const text = showing ? (cardLines[i] ?? '').padEnd(width) : ' '.repeat(width)

    process.stdout.write(`\x1b[${i + 1};${col}H${text}`)
  }

  cardDrawnAt = showing ? cardLines.length : 0
}

// The version, bottom right, and what to do about it if there is a newer one.
//
// The same thing Claude Code does with its own update line: a status display
// says what it is and what is out of date without interrupting anything. The
// pane is the natural place — it is already on screen, already saying what the
// session is doing, and its bottom-right corner is empty.
//
// Re-read on a timer rather than per frame. The pane draws several times a
// second and this is two small files.
const VERSION_EVERY = 30_000
const ourVersion = installedVersion()

let versionText = null
let versionRead = 0
let versionCols = 0
let versionDrawn = 0

const drawVersion = (sprite) => {
  if (config.showVersion === false || !ourVersion) return

  const now = Date.now()

  // Never on top of something that matters. The card can reach the bottom row,
  // and a wide working sprite — Charizard's fire is twenty columns — can reach
  // across to where this would sit.
  if (now < cardUntil) {
    versionDrawn = 0

    return
  }

  const cols = process.stdout.columns || config.windowCols || 0
  const rows = process.stdout.rows || 0

  // The same line Claude Code prints, in the room this pane actually has.
  //
  // The pane is a horizontal split, so its width is the terminal's — wide enough
  // for the whole command, which is what Claude prints on its own update line.
  // The width is read each time rather than once, because a pane is resized by
  // dragging and this has to still fit afterwards.
  //
  // In the corner rather than in a card: the cards are spoken for, by the stats
  // on arrival and by `--dex` whenever you ask for one.
  if (now - versionRead > VERSION_EVERY || cols !== versionCols) {
    versionRead = now
    versionCols = cols

    try {
      versionText = cornerText(ourVersion, updateAvailable(), Math.max(0, cols - (sprite?.cols ?? 0) - 2))
    } catch {
      versionText = `v${ourVersion}`
    }
  }

  if (!versionText) return

  const from = cols - versionText.length + 1

  // Only where there is room for it beside whatever else is drawn.
  if (cols < versionText.length + 2 || rows < 2 || (sprite?.cols ?? 0) + 2 > from) return

  const pad = Math.max(0, versionDrawn - versionText.length)

  process.stdout.write(`\x1b[${rows};${Math.max(1, from)}H\x1b[2m${versionText}\x1b[0m${' '.repeat(pad)}`)
  versionDrawn = versionText.length
}

let index = 0
let working = false

// What the sprite is on its way to being, and the flicker still to play before
// it gets there. Empty means nothing is in progress.
let target = false
let evolving = []

const tick = () => {
  // The session may have ended while this pane was still starting, in which
  // case closeWindow left a note rather than a signal — it had no pid to send
  // one to. Exiting here is what stops an orphaned sprite outliving its session.
  if (wasClosed()) process.exit(0)

  checkSpecies()

  const now = isWorking()

  // A change of mind mid-flicker restarts it towards the new answer rather than
  // finishing a transformation that is already out of date — which is what an
  // escape during the first half second is.
  if (now !== target) {
    target = now
    evolving = transitionFrames(working ? busy : idle, now ? busy : idle)

    if (evolving.length === 0) {
      working = now
      index = 0
      process.stdout.write(CLEAR)
    }
  }

  if (evolving.length > 0) {
    const step = evolving.shift()

    process.stdout.write(DELETE_PLACEMENTS + originFor(step.sprite) + step.frame)

    // The last silhouette hands over to the real sprite, started from its first
    // frame so it does not land mid-stride on the other one's index.
    if (evolving.length === 0) {
      working = target
      index = 0
    }

    setTimeout(tick, step.delay)

    return
  }

  const sprite = working ? busy : idle
  const frame = index % sprite.frames.length

  process.stdout.write(DELETE_PLACEMENTS + originFor(sprite) + sprite.frames[frame])

  drawCard(sprite)
  drawVersion(sprite)

  index++

  setTimeout(tick, delayFor(sprite, frame))
}

// A warming run only needs the frames converted and written to the cache, so
// it draws one frame and leaves rather than animating at an audience of nobody.
if (sessionArg === 'warm') {
  process.exit(0)
}

// The pane opening is an arrival too — the first thing it does is let the
// Pokemon out, and say what it is.
evolving = ballFrames()

showCard(species)

tick()

// Tidy up after the pane is already drawing, never before. Pruning walks the
// cache directory and can delete a few hundred megabytes; doing it on the way
// in would show an empty pane while it worked. A session opening is also the
// only moment a guest can have become stale since the last one.
setTimeout(async () => {
  try {
    const { prune } = await import('./prune.mjs')

    prune()
  } catch {}
}, 2000)

// Only say anything when the pane is taller than the sprite needs. Fitted to
// the sprite exactly, every line printed here would push the image up and out,
// which looks like stray text appearing from behind Pikachu.
const describe = (sprite, label) =>
  `  ${label.padEnd(8)} ${species ?? sprite.name} — ${sprite.box.width}x${sprite.box.height}, ` +
  `${sprite.frames.length} frames, ${sprite.cols}x${sprite.rows} cells`

if ((process.stdout.rows ?? 0) > paneRows + 2) {
  console.error(
    `\x1b[${paneRows + 2}H${describe(idle, 'waiting')}\n${describe(busy, 'working')}\n  ctrl-c to stop`,
  )
}
