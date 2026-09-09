// Checks that every part of the setup is actually in place.
//
// There are a lot of moving pieces — settings.json wiring, hooks, sprites, an
// external renderer, a terminal that can draw the glyphs, a macOS permission —
// and most of them fail quietly. This says which.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { prepare } from './prepare.mjs'
import { sharedBounds } from './render.mjs'
import { FRAMES_FILE, ROOT, loadConfig } from './config.mjs'
import { speciesInUse, windowIsRunning } from './companion.mjs'
import { available, fetchedGuests, knownCount, pickFor } from './roster.mjs'
import { guestCost } from './prune.mjs'
import { AGENTS, isInstalled, isStale } from './agents.mjs'
import { chooseLauncher, launchCommand, paneArgv, terminalRows } from './launcher.mjs'
import { alreadySet as kittyReady } from './kitty.mjs'
import { currentFormat, remembered } from './graphics.mjs'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const results = []

const check = (name, fn) => {
  try {
    const { ok, detail, warn } = fn()

    results.push({ name, ok, warn, detail })
  } catch (error) {
    results.push({ name, ok: false, detail: error.message })
  }
}

const config = loadConfig()

check('config readable', () => ({ ok: true, detail: `${Object.keys(config).length} settings` }))

// Off is the intended state — the sprite moved into its own pane — so warning
// about it marked every healthy fresh install as "something to look at".
check('status line sprite', () => ({
  ok: true,
  detail: config.statusSprite ? `on, ${config.rows} rows, style ${config.style}` : 'off — the sprite lives in a pane',
}))

check('built frames', () => {
  // Only the status line reads these, and it is off by default and no longer
  // installed. Reporting a fresh clone as *broken* for not having built frames
  // it will never read sends someone to `npm run build` to fix nothing — and a
  // red mark on a first run reads as "this did not install properly".
  if (!config.statusSprite) return { ok: true, detail: 'not needed — the sprite lives in a pane' }

  if (!existsSync(FRAMES_FILE)) return { ok: false, detail: 'missing — run npm run build' }

  const bundle = JSON.parse(readFileSync(FRAMES_FILE, 'utf8'))

  return {
    ok: true,
    warn: bundle.sprite !== config.sprite,
    detail:
      bundle.sprite === config.sprite
        ? `${bundle.frames.length} frames, ${bundle.cols}x${bundle.rows} cells`
        : `built from ${bundle.sprite} but config says ${config.sprite} — run npm run build`,
  }
})

for (const [label, name] of [
  ['working sprite', config.windowSprite ?? config.sprite],
  ['idle sprite', config.windowIdleSprite ?? config.windowSprite ?? config.sprite],
]) {
  check(label, () => {
    const path = isAbsolute(name) ? name : join(ROOT, name)

    if (!existsSync(path)) return { ok: false, detail: `${name} not found` }

    const raw = readFileSync(path)
    const image = prepare(decodeSprite(raw) ?? decodeGif(raw), config.bounce, config.sheetFrames)
    const box = sharedBounds(image.frames, image.width, image.height)

    return {
      ok: image.frames.length > 0,
      detail: `${name} — ${box.width}x${box.height}, ${image.frames.length} frames`,
    }
  })
}

// How the sprite is drawn here, which is the other half of "does this work in
// my terminal" and used to have no answer at all.
check('sprite format', () => {
  const format = currentFormat(config)
  const probed = remembered() !== null

  const why = config.graphicsFormat
    ? 'forced in config.json'
    : probed
      ? 'the terminal was asked'
      : `guessed from ${process.env.TERM_PROGRAM ? '$TERM_PROGRAM' : '$TERM'} — a pane will ask and may pick better`

  return {
    ok: true,
    // Not a warning. Symbols is a real answer and the whole point of having
    // four: it is what a terminal with no pixel support draws instead of
    // nothing. Flagging it would be reporting a working setup as a problem.
    detail: `${format}${format === 'symbols' ? ' — coloured blocks, no pixel support here' : ''} (${why})`,
  }
})

check('chafa', () => {
  const probe = spawnSync('chafa', ['--version'], { encoding: 'utf8' })

  return {
    ok: probe.status === 0,
    detail: probe.status === 0 ? probe.stdout.split('\n')[0] : 'not installed — brew install chafa',
  }
})

// Which terminal is going to open the pane — the question that replaced "is
// Ghostty installed?" when there started to be more than one answer.
//
// It reports the command it would actually run, not just the name. Every time
// the pane has failed to open, the useful thing to know was what was attempted:
// a launcher chosen correctly and then invoked with the wrong pane id looks
// exactly like a launcher not chosen at all, from the outside.
const launcher = chooseLauncher()

check('pane opener', () => {
  if (!launcher) {
    return {
      ok: false,
      detail:
        `nothing here can open a window${process.env.TERM_PROGRAM ? ` — this is ${process.env.TERM_PROGRAM}` : ''}\n` +
        '      the sprite would still draw; there is just nothing to put it in.\n' +
        '      run it yourself: npm run window 4 --session=<id>',
    }
  }

  if (launcher.applescript) return { ok: true, detail: `${launcher.label} — the split is a keystroke` }

  const mode = config.windowMode === 'split' ? 'split' : 'window'
  const command =
    launchCommand(launcher, mode, {
      rows: config.windowRows ?? 3,
      cols: config.windowCols ?? 34,
      argv: paneArgv({ rows: config.windowRows ?? 3, session: '<id>' }),
      env: process.env,
      rowsAvailable: terminalRows(),
    }) ?? launchCommand(launcher, 'window', { rows: config.windowRows ?? 3, cols: config.windowCols ?? 34, argv: ['…'], env: process.env, rowsAvailable: terminalRows() })

  // Trimmed to the launcher's own arguments. The rest is the pane invocation,
  // which is the same every time and forty characters of node path.
  const shown = command ? `${command[0]} ${command[1].slice(0, command[1].indexOf('--')).join(' ')}` : 'cannot open a pane'

  return { ok: Boolean(command), detail: `${launcher.label} — ${shown}` }
})

// Only where it is the thing that opens the pane. A Ghostty sitting in
// /Applications on a machine whose pane comes from WezTerm is not a fault, and
// reporting it as one sends people to install something they do not need.
if (!launcher || launcher.name === 'ghostty-macos') {
  check('Ghostty', () => ({
    ok: existsSync('/Applications/Ghostty.app'),
    detail: existsSync('/Applications/Ghostty.app') ? 'installed' : 'not installed',
  }))
}

// And the kitty equivalent: the pane is chosen to come from kitty, so the two
// settings it needs are now part of the setup rather than trivia.
if (launcher?.name === 'kitty') {
  check('kitty options', () => {
    const set = kittyReady()

    return {
      ok: true,
      warn: !(set.remote && set.splits),
      detail:
        set.remote && set.splits
          ? 'remote control on, splits layout available'
          : `${set.remote ? '' : 'remote control off. '}${set.splits ? '' : 'splits layout not enabled. '}npm run kitty -- --install`,
    }
  })
}

// One line per agent, whether or not you have it. An agent you do not use
// reporting "not installed" is information; leaving it out entirely would make
// "is it wired up?" unanswerable for whichever one you do have.
for (const agent of AGENTS) {
  check(`${agent.label} hooks`, () => {
    if (!isInstalled(agent)) {
      return {
        ok: true,
        detail: isStale(agent) ? `not installed — ${agent.dir()} exists but the program does not` : 'not installed',
      }
    }

    const file = agent.file()

    if (!existsSync(file)) return { ok: false, detail: `no ${file} — run npm run install-statusline` }

    const document = JSON.parse(readFileSync(file, 'utf8'))
    const events = Object.entries(document.hooks ?? {})
      .filter(([, groups]) =>
        // Matched on where this project actually is, not on what it is called.
        // Checking for the literal name meant renaming the folder would report
        // every hook as missing while they all worked perfectly.
        groups.some((group) => (group.hooks ?? []).some((hook) => String(hook.command).includes(ROOT))),
      )
      .map(([event]) => event)

    const needed = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop']
    const missing = needed.filter((event) => !events.includes(event))

    return {
      ok: missing.length === 0,
      detail: missing.length
        ? `hooks missing: ${missing.join(', ')} — run npm run install-statusline`
        : `${events.length} hooks registered in ${file.replace(homedir(), '~')}`,
    }
  })
}

check('sprite window', () => {
  const sizeFile = join(ROOT, '.state', 'window.size')
  const measured = existsSync(sizeFile) ? readFileSync(sizeFile, 'utf8').trim() : null

  return {
    ok: true,
    detail:
      (windowIsRunning() ? 'running' : 'not running') +
      (measured ? `, pane last measured ${measured}` : ''),
  }
})

// The frame cache is keyed by row count, so a cache warmed for a height the
// pane never settles on is no cache at all: every sprite is rendered from
// scratch the first time it is shown, which is two seconds of frozen animation
// rather than three hundredths. It costs nothing when it is right and is
// invisible when it is wrong, so it is worth stating plainly.
check('cache matches the pane', () => {
  const sizeFile = join(ROOT, '.state', 'window.size')

  if (!existsSync(sizeFile)) return { ok: true, warn: true, detail: 'no pane measured yet — open one, then npm run warm' }

  const measured = readFileSync(sizeFile, 'utf8').trim()
  const paneRows = Number(measured.match(/x(\d+)/)?.[1] ?? 0)

  if (!paneRows) return { ok: true, warn: true, detail: `unreadable size "${measured}"` }

  const cacheDir = join(ROOT, '.state', 'cache')

  if (!existsSync(cacheDir)) return { ok: false, detail: 'no cache — run npm run warm' }

  // Counted, not just checked for presence. One sprite left at the right height
  // by an unrelated run would otherwise pass this while every other Pokemon
  // still stalls for two seconds on its first appearance.
  const byRows = new Map()

  for (const file of readdirSync(cacheDir)) {
    if (!file.endsWith('.json')) continue

    try {
      const { rows } = JSON.parse(readFileSync(join(cacheDir, file), 'utf8'))

      byRows.set(rows, (byRows.get(rows) ?? 0) + 1)
    } catch {}
  }

  // Two sprites each — one for waiting, one for working.
  const wanted = available().length * 2
  const got = byRows.get(paneRows) ?? 0

  if (got >= wanted) return { ok: true, detail: `all ${available().length} warmed for ${paneRows} rows` }

  const others = [...byRows.entries()]
    .filter(([rows]) => rows !== paneRows)
    .map(([rows, n]) => `${n} at ${rows}`)
    .join(', ')

  return {
    ok: false,
    detail:
      `pane is ${paneRows} rows but only ${got} of ${wanted} sprites are warmed for it` +
      `${others ? ` (${others})` : ''} — run: npm run warm -- ${paneRows}`,
  }
})

// Guests are the ones not in the roster: fetched when summoned, evicted when
// the space is wanted. Worth showing because the disk they use is invisible
// otherwise, and because it is the number that decides when they start leaving.
check('guest Pokemon', () => {
  const guests = fetchedGuests()
  const budget = (config.guestBudgetMb ?? 200) * 1024 * 1024
  const used = guests.reduce((total, name) => total + guestCost(name), 0)
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

  return {
    ok: true,
    detail: guests.length
      ? `${guests.length} of ${knownCount()} fetched — ${mb(used)} of ${mb(budget)}: ${guests.slice(0, 6).join(', ')}${guests.length > 6 ? '...' : ''}`
      : `none fetched — ${knownCount()} available on request`,
  }
})

// Which Pokemon are spoken for, and what the next terminal would therefore be
// given. Pikachu goes to whoever is free to have it, so the useful thing to see
// is whether anything is holding it.
check('Pokemon in use', () => {
  const taken = speciesInUse()
  const next = pickFor('the-next-session', taken)

  return {
    ok: true,
    detail: `${taken.size ? [...taken].sort().join(', ') : 'none'} — next terminal gets ${next ?? 'nothing, no sprites fetched'}`,
  }
})

check('auto-open', () => {
  if (!config.autoWindow) return { ok: true, warn: true, detail: 'off — start it with npm run window' }

  if (config.windowMode !== 'split') return { ok: true, detail: 'on, separate window (no permission needed)' }

  // Accessibility is the price of opening a split by pressing the key that
  // splits it, and that is the macOS Ghostty path alone. WezTerm and kitty are
  // handed the request over their own socket, which macOS has no opinion about
  // — so probing for the permission there would report a problem that does not
  // exist and cannot be fixed.
  if (launcher && !launcher.applescript) {
    return { ok: true, detail: `on, split mode via ${launcher.label} (no permission needed)` }
  }

  // The permission belongs to whichever app runs the script, so this can only
  // report what it sees from here.
  const probe = spawnSync(
    'osascript',
    ['-e', 'tell application "System Events" to return count of processes'],
    { encoding: 'utf8' },
  )

  const allowed = probe.status === 0

  return {
    ok: true,
    warn: !allowed,
    detail: allowed
      ? 'on, split mode, accessibility granted here'
      : 'on, split mode — accessibility NOT granted to this terminal.\n' +
        '      System Settings > Privacy & Security > Accessibility > enable Ghostty,\n' +
        '      then restart Ghostty. Or set windowMode to "window" to skip permissions.',
  }
})

console.log(`\n  ${DIM}pokemanion${RESET}\n`)

for (const { name, ok, warn, detail } of results) {
  const mark = !ok ? `${RED}✘${RESET}` : warn ? `${YELLOW}•${RESET}` : `${GREEN}✔${RESET}`

  console.log(`  ${mark} ${name.padEnd(22)} ${DIM}${detail}${RESET}`)
}

const broken = results.filter((r) => !r.ok).length
const warned = results.filter((r) => r.ok && r.warn).length

console.log(
  `\n  ${broken ? `${RED}${broken} broken${RESET}, ` : ''}${warned ? `${YELLOW}${warned} to look at${RESET}, ` : ''}` +
    `${results.length - broken - warned} fine\n`,
)

process.exitCode = broken ? 1 : 0
