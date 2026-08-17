// Opens the sprite window alongside a Claude session, once.
//
// macOS does not let Ghostty be driven from the command line — `+new-window`
// refuses outright — so a split cannot be scripted. What does work is asking
// macOS to launch another Ghostty with arguments, which gives a small window of
// its own running the sprite.
//
// Called from the SessionStart hook. Several Claude sessions may start at once,
// or one may be resumed repeatedly, so this has to be safe to call over and
// over: a pid file records the running window and a second call does nothing.

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync as fileExists, readdirSync } from 'node:fs'
import { ROOT, STATE_DIR, loadConfig } from './config.mjs'
import { isFetched, pickFor, requestedName, requestedSpecies } from './roster.mjs'
import { rememberSpecies, rememberedSpecies } from './assigned.mjs'

// One sprite per session, so the pid is recorded per session too. A window
// belonging to one Claude must not be closed when a different one exits.
const safe = (id) => String(id ?? 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)

export const pidFileFor = (id) => join(STATE_DIR, `window-${safe(id)}.pid`)

// A pid file outlives a crash, so the number in it means nothing until the
// process is checked. Signal 0 asks the kernel whether it is alive without
// actually sending anything.
export const readPid = (id) => {
  const file = pidFileFor(id)

  if (!existsSync(file)) return null

  const pid = Number(readFileSync(file, 'utf8').trim())

  return Number.isInteger(pid) && pid > 0 ? pid : null
}

export const windowIsRunning = (id) => {
  const file = pidFileFor(id)

  if (!existsSync(file)) return false

  const pid = Number(readFileSync(file, 'utf8').trim())

  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)

    return true
  } catch {
    try {
      unlinkSync(file)
    } catch {}

    return false
  }
}

// Closing is a signal to the sprite, not to the pane. The sprite exits, its
// shell was replaced by it via exec, and Ghostty closes the pane when its shell
// goes — so the whole strip disappears with the session that owned it.
export const closedFileFor = (id) => join(STATE_DIR, `window-${safe(id)}.closed`)

// A pane being opened right now, by somebody.
//
// `windowIsRunning` cannot answer that. It asks whether a pid is alive, and a
// pane does not have one until it has been through splitting a terminal, typing
// a command and booting node — a second or more during which two callers both
// see no pane and both open one.
//
// That happened on a session restart: two SessionStart hooks a thirty-third of a
// second apart, two splits, and because the launcher script is named after the
// session, both wrote and ran the same file. One won. The other caught it
// mid-write, failed to exec, and sat there as a bare shell prompt beside the
// Pokemon — which reads as the pane having crashed.
export const openingFileFor = (id) => join(STATE_DIR, `window-${safe(id)}.opening`)

export const closeWindow = (id) => {
  const pid = readPid(id)

  // The claim goes either way. A session that is ending has no use for its
  // Pokemon whether or not there was still a pane holding it.
  releaseSpecies(id)

  if (!pid) {
    // No pid yet does not mean no pane. Opening one means splitting a terminal,
    // typing a command into it and waiting for node to boot — a second or two
    // during which the pane exists but has not written its pid. A session that
    // starts and ends inside that window (a one-shot `claude -p`, or quitting
    // straight after launch) finds nothing to kill, and the pane finishes
    // starting a moment later with nobody left to own it. It then runs forever:
    // a sprite for a session that is gone, holding a Pokemon it never claimed
    // back, which is how a second Pikachu appears beside your Gengar.
    //
    // So leave a note instead. The pane looks for it as it starts and on every
    // poll, and exits if it finds one.
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      writeFileSync(closedFileFor(id), String(Date.now()))
    } catch {}

    return false
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }

  try {
    unlinkSync(pidFileFor(id))
  } catch {}

  return true
}

// Ghostty can only be told to split by pressing the key that splits it. There
// is no command line route on macOS — `ghostty +new-window` answers "not
// supported on this platform" — so this drives the keyboard through System
// Events, the same way a macro would.
//
// It is the only way to get the sprite inside the Claude window rather than
// floating in one of its own, and the cost is that macOS must grant Ghostty
// permission to control the computer, and that the command is typed rather
// than passed, so the split has to have taken focus first.
// Every pane Ghostty opens gets its own login shell, so a new one appearing is
// proof the split exists — better than waiting a fixed period and hoping. A
// delay long enough to always be safe is long enough to be visible; this waits
// exactly as long as it needs to, and typing into the wrong pane stops being a
// question of timing.

// Which login shells exist, not how many.
//
// This counted them and waited for the count to rise. That is only equivalent
// while nothing else is closing: shut a tab, end another session, let a sprite
// pane exit — any of which happens constantly around a session starting — and
// the count drops, so the new shell merely restores it rather than exceeding
// it. The wait then times out, concludes the split never opened, and types
// nothing into a pane that is sitting there empty.
//
// Comparing the actual pids has no such blind spot: a pid that was not there
// before is a new shell, whatever else has come and gone. The measured cost is
// unchanged, since it is the same pgrep either way.
const shellPids = () => {
  const probe = spawnSync('pgrep', ['-f', '^/usr/bin/login -flp'], { encoding: 'utf8' })

  return new Set((probe.stdout ?? '').trim().split('\n').filter(Boolean))
}

const waitForNewShell = (before, timeoutMs) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    for (const pid of shellPids()) if (!before.has(pid)) return true

    // pgrep itself takes a few milliseconds, which is the whole poll interval.
    spawnSync('sleep', ['0.02'])
  }

  return false
}

const runScript = (body) => spawnSync('osascript', ['-e', body], { encoding: 'utf8' })

// How far opening the split got.
//
// Every way this fails is silent from where you are sitting. It runs from a
// SessionStart hook, so its stderr goes nowhere you will read; the split either
// appears with a sprite in it or it does not, and a pane that opens empty looks
// identical whether the keystroke was refused, the shell never arrived, or the
// command was typed into the wrong window. Diagnosing one meant reconstructing
// it afterwards from timestamps and guesswork.
//
// Same file and same switch as the rest of the hook logging, so it is already
// on for anyone who has logHooks set and costs a line per session otherwise.
const logSplit = (id, detail) => {
  try {
    if (!(process.env.PIXEL_RUNNER_LOG_HOOK || loadConfig().logHooks)) return

    mkdirSync(STATE_DIR, { recursive: true })
    appendFileSync(join(STATE_DIR, 'hooks.jsonl'), `${JSON.stringify({ at: Date.now(), event: 'split', session: id, ...detail })}\n`)
  } catch {}
}

const openSplit = (rows, shrink, grow, id, species, pending = null) => {
  // Before driving AppleScript at an application that may not exist.
  //
  // Without this, a machine with no Ghostty gets the whole keystroke dance and
  // then "Can't get application (-1728)" written to a stderr nobody reads — so
  // the symptom is a session that starts and simply never grows a pane, with no
  // clue anywhere. The plugin route makes that likely rather than exotic:
  // installing it takes two commands and neither of them checks anything.
  //
  // -1728 was also not in the list of errors the handler below recognises, so
  // it did not even get the one message it might have produced.
  if (!existsSync('/Applications/Ghostty.app')) {
    console.error('pokemanion: Ghostty is not installed — the pane is a Ghostty split. https://ghostty.org')
    logSplit(id, { step: 'no Ghostty' })

    return false
  }

  // And chafa, for the same reason but a worse symptom.
  //
  // Without it the pane opens, the renderer exits 1 on its first frame, and the
  // split closes again — so a terminal flashes and vanishes, which is harder to
  // interpret than nothing happening at all. Better to open nothing and say so
  // in the log, leaving the next command someone types to explain it.
  if (spawnSync('command', ['-v', 'chafa'], { shell: true, encoding: 'utf8' }).status !== 0) {
    console.error('pokemanion: chafa is not installed — it renders the sprite. brew install chafa')
    logSplit(id, { step: 'no chafa' })

    return false
  }

  // System Events types a keystroke string one character at a time, so the
  // length of this command is paid for in wall clock — the full node
  // invocation ran to 134 characters, close to a second of watching it appear.
  // Writing it to a script and typing the script's path instead is the same
  // command in a sixth of the keystrokes.
  // Quoted, because this is a shell command and the repo may be somewhere with
  // a space in it — `~/Documents/My Projects/pokemanion` is an ordinary place to
  // put things, and unquoted it becomes two arguments and a pane that never
  // starts.
  const full =
    `exec "${process.execPath}" "${join(ROOT, 'src', 'window.mjs')}" ${rows} --session=${safe(id)}` +
    (species ? ` --species=${species}` : '') +
    (pending ? ` --pending=${pending}` : '')

  // Not tmpdir(): on macOS that is a forty character path under /var/folders,
  // and every character of it is another keystroke. /tmp is a symlink to the
  // same place and costs four.
  const launcher = `/tmp/pxr${safe(id).slice(0, 6)}`

  try {
    writeFileSync(launcher, `#!/bin/sh\n${full}\n`, { mode: 0o755 })
  } catch {
    // If the launcher cannot be written, typing the whole thing still works.
  }

  const command = existsSync(launcher) ? `exec ${launcher}` : full

  // One press of the big-step keybind pixel-runner adds to ~/.config/ghostty/
  // config, rather than a hundred presses of the built-in ten pixel one. The
  // built-in step is slow enough that you watch the pane crawl down; this is
  // instant.
  const squeeze = '        key code 125 using {command down, control down, shift down}'

  const before = shellPids()

  const split = runScript(`
    tell application "Ghostty" to activate
    delay 0.15
    tell application "System Events"
      keystroke "d" using {command down, shift down}
    end tell
  `)

  if (split.status !== 0) {
    const message = (split.stderr ?? '').trim()

    console.error(
      /not allowed|assistive|-1719|-25211/i.test(message)
        ? 'pokemanion: macOS has not granted permission to control the computer.\n' +
            '  System Settings > Privacy & Security > Accessibility > enable Ghostty, then restart it.'
        : `pokemanion: could not open the split — ${message}`,
    )

    logSplit(id, { step: 'split keystroke failed', error: message.slice(0, 200) })

    return false
  }

  // If the shell never appears the split did not happen, and typing a command
  // now would send it to whatever is focused instead — most likely the Claude
  // prompt. Better to do nothing.
  //
  // The wait is generous rather than tight. It costs nothing when the shell
  // turns up quickly, because this returns the moment it sees one; the only
  // thing a longer limit buys is a machine under load still getting its pane.
  //
  // It was raised from two seconds on the theory that an empty split meant the
  // wait had timed out. That theory was wrong: every pane since has found its
  // shell in 25-85ms, against a limit twenty-three times that. The real cause
  // was counting shells rather than identifying them — see shellPids above. The
  // larger ceiling is kept because it is free, not because it fixed anything.
  const waited = Date.now()

  if (!waitForNewShell(before, 6000)) {
    console.error('pokemanion: the split did not open, so nothing was typed into it')
    logSplit(id, { step: 'no shell appeared', shellsBefore: before.size, waitedMs: Date.now() - waited })

    return false
  }

  const appeared = Date.now() - waited

  // Squash the empty pane, then start the sprite in it.
  const result = runScript(`
    tell application "System Events"
${squeeze}
      keystroke ${JSON.stringify(command)}
      key code 36
    end tell
  `)

  logSplit(id, {
    step: result.status === 0 ? 'typed' : 'typing failed',
    shellsBefore: before.size,
    shellAppearedMs: appeared,
    error: result.status === 0 ? null : (result.stderr ?? '').trim().slice(0, 200),
  })

  return result.status === 0
}

// Which Pokemon the panes that are already up have taken.
//
// Recorded here rather than by the pane, because the choice has to be made
// before the pane exists: opening one means launching a terminal and waiting
// for it to start, and two sessions beginning together would both look at an
// empty room and both pick Pikachu. Writing the claim at the moment of the
// decision is what makes the decision exclusive.
export const speciesFileFor = (id) => join(STATE_DIR, `window-${safe(id)}.species`)

// A claim that no pane ever arrived to back — the split failed, the terminal
// was killed while starting — would otherwise hold its Pokemon forever. So a
// claim counts while it is still young enough that its pane may yet appear, and
// after that only for as long as there is a live process behind it.
const STARTUP_GRACE_MS = 30_000

export const releaseSpecies = (id) => {
  try {
    unlinkSync(speciesFileFor(id))
  } catch {}
}

export const speciesInUse = (exceptId = null) => {
  const taken = new Set()

  if (!fileExists(STATE_DIR)) return taken

  for (const file of readdirSync(STATE_DIR)) {
    // A note left for a pane that never arrived. closeWindow writes one when it
    // has no pid to signal, and the pane deletes it on the way in — but if the
    // pane failed to start at all, nobody ever comes to read it and it sits
    // there. Harmless, and it would still be sitting there in a year, so it is
    // swept alongside the claims rather than left to accumulate.
    // `.opening` is swept on the same rule and for the same reason: a pane that
    // never started leaves one behind, and a claim trusted forever would block
    // every later attempt for that session.
    if (file.endsWith('.closed') || file.endsWith('.opening')) {
      try {
        if (Date.now() - statSync(join(STATE_DIR, file)).mtimeMs > STARTUP_GRACE_MS) unlinkSync(join(STATE_DIR, file))
      } catch {}

      continue
    }

    if (!file.endsWith('.species')) continue

    const id = file.slice('window-'.length, -'.species'.length)

    if (exceptId !== null && id === safe(exceptId)) continue

    const path = join(STATE_DIR, file)

    let species
    let claimedAt

    try {
      species = readFileSync(path, 'utf8').trim()
      claimedAt = statSync(path).mtimeMs
    } catch {
      continue
    }

    if (!species) continue

    if (windowIsRunning(id) || Date.now() - claimedAt < STARTUP_GRACE_MS) {
      taken.add(species)

      continue
    }

    // Nothing behind it and no longer new. Let the Pokemon go.
    try {
      unlinkSync(path)
    } catch {}
  }

  return taken
}

// A background agent is a session like any other and reports SessionStart like
// any other, but nobody is watching it: it has no terminal of its own. Giving
// it a pane is wrong twice over — a Pokemon for something you cannot see, and,
// in split mode, one that takes half of whichever Ghostty window happens to be
// focused, because a split is opened by pressing the key that splits it and the
// key lands wherever the focus is. Open the agents list and every agent in it
// cuts your terminal in half again.
//
// Claude Code keeps these under ~/.claude/jobs, one directory per agent, named
// with the first eight characters of its session id, written when the job is
// created — which is before the agent it describes has started, so it is
// already there by the time that agent's SessionStart arrives.
//
// `source` is what SessionStart says about itself. It is deliberately not
// judged here yet: a whitelist of the values seen so far would quietly stop
// opening panes at all the day Claude Code adds another one, and the directory
// alone identifies every agent observed. It is passed in and logged so the test
// can be tightened against real payloads rather than against a guess.
const JOBS_DIR = join(homedir(), '.claude', 'jobs')

export const isBackgroundAgent = (id, source = null) =>
  fileExists(join(JOBS_DIR, String(id ?? '').slice(0, 8)))

// Who this session gets, and the whole of that decision.
//
// Three rules, in this order, and the order is the point:
//
//   1. Asked for by name — `claude --ash` — you get that one. Always. Not if
//      it happens to be free, not unless something better is available: that
//      one. It outranks Pikachu-comes-first, it outranks Pikachu being free,
//      it outranks the Pokemon already being out in another window, and it
//      outranks randomPokemon being switched off altogether. Naming something
//      is not a preference to be weighed against other preferences.
//
//   2. Not asked for now, but asked for — or picked — by this session before.
//      You get that one back. This is the rule that was missing: without it a
//      pane that closed and reopened ran rule 3 again, against a list that had
//      changed underneath it, and came back as a different Pokemon with nothing
//      typed. Sitting below rule 1 so a fresh `--ash` still overrules whatever
//      is remembered, and below the randomPokemon switch so turning the whole
//      thing off still means off.
//
//   3. Nothing to go on — the rotation. Pikachu whenever Pikachu is free,
//      otherwise one nobody else currently holds.
//
// Split out from openWindow so it can be tested, because openWindow's other
// half launches a terminal and cannot be run to find out what it would decide.
//
// `reason` is filled in for the caller to log. Which Pokemon a pane was given
// used to be written down only when it was asked for by name, so a rotation
// pick left no trace at all and a sprite that changed on its own could not be
// explained afterwards, only reproduced.
export const chooseSpecies = (id, config = loadConfig(), env = process.env, reason = {}) => {
  const asked = requestedSpecies(env)

  if (asked) {
    reason.why = 'asked'

    return asked
  }

  if (config.randomPokemon === false) {
    reason.why = 'disabled'

    return null
  }

  const remembered = rememberedSpecies(id)

  if (remembered) {
    // Two ways a remembered name is no longer usable. The sprite may be gone —
    // a guest the pruner evicted while the session was closed — and the pane
    // refuses to draw a species whose files are missing. Or another terminal
    // may have taken it in the meantime, and two panes quietly showing the same
    // Pokemon is the thing the rotation exists to avoid. `speciesInUse` skips
    // this session's own claim, so a stale claim of your own never blocks you.
    //
    // `isFetched` rather than `available`, which is the residents alone: a guest
    // summoned by name is exactly the case worth remembering, and testing it
    // against the resident list would have quietly sent every one of them back
    // to the rotation.
    if (!isFetched(remembered)) reason.why = 'remembered, sprite gone'
    else if (speciesInUse(id).has(remembered)) reason.why = 'remembered, taken elsewhere'
    else {
      reason.why = 'remembered'

      return remembered
    }
  }

  reason.why = reason.why ?? 'rotation'

  return pickFor(id, speciesInUse(id))
}

// Why this pane is showing what it is showing.
//
// The hook log already records what was asked for by name. It never recorded
// what was actually chosen, so a rotation pick left no trace: when a pane came
// back as a different Pokemon the only way to explain it was to reconstruct the
// pick from the state of the disk afterwards and hope nothing else had moved.
// One line at the moment of the decision is the difference between reading the
// answer and re-deriving it.
//
// Best effort and last in the function, like everything else the hooks do: this
// must never be the reason a session is slow to start.
export const logChoice = (id, species, why) => {
  try {
    if (!(process.env.PIXEL_RUNNER_LOG_HOOK || loadConfig().logHooks)) return

    mkdirSync(STATE_DIR, { recursive: true })
    appendFileSync(
      join(STATE_DIR, 'hooks.jsonl'),
      `${JSON.stringify({ at: Date.now(), event: 'choose', session: id, species: species ?? null, why: why ?? null })}\n`,
    )
  } catch {}
}

// `forced` is a Pokemon this pane must open as, rather than one it works out
// for itself.
//
// Typing `--gengar` after closing the pane reopens it, and the answer to "which
// Pokemon" is already settled — you just said it. Without this the reopened pane
// runs the usual decision, where a launch flag still set from `claude --kyogre`
// outranks anything typed later, so the pane came back as the wrong Pokemon and
// looked like the command had been ignored.
export const openWindow = (id, source = null, forced = null) => {
  const config = loadConfig()

  // A way to drive the real handler without splitting the terminal it is being
  // driven from.
  //
  // The suite runs the actual hook rather than a stand-in, which is the whole
  // reason it catches anything — and that used to be safe because SessionStart
  // was the only event that opened a pane, so the suite simply never sent one.
  // Reopening on `--<name>` made a second event open panes, the suite had no
  // idea, and `npm test` left sprites running on the machine beside the real
  // sessions.
  //
  // Set here rather than remembered in the suite, because the next path that
  // opens a pane will not know it was supposed to tell anyone.
  if (process.env.PIXEL_RUNNER_NO_WINDOW === '1') return false

  if (isBackgroundAgent(id, source)) return false

  // A note left by `closeWindow` when a session ended before its pane had
  // written a pid. It tells a pane that is still starting to stop, and it is
  // read by whichever pane starts next — including this one.
  //
  // Which is a problem the moment the same session comes back. `claude --resume`
  // reuses the session id, so a session quit during the second or two its pane
  // takes to start leaves a note that kills the pane the resume opens. The split
  // appears and closes again, which is the same nothing-happened this project has
  // spent long enough chasing.
  //
  // The note carries the time it was written, so it can be told apart from a
  // useful one: while a pane could still be starting it has a job to do, and
  // after that it is litter. An explicit ask clears it whatever its age, because
  // naming a Pokemon is a clear request for a pane to put it in.
  //
  // The grace period is the shared one: it is the same question every time —
  // could a pane still be on its way in?
  try {
    const note = closedFileFor(id)
    const left = Number(readFileSync(note, 'utf8').trim())

    if (forced || !Number.isFinite(left) || Date.now() - left > STARTUP_GRACE_MS) unlinkSync(note)
  } catch {}

  // A pane is already up for this session — resuming one whose window never
  // closed. Nothing needs opening, but an explicit ask still has to land, and
  // returning here is how `claude --resume --random` used to do nothing at all.
  //
  // Writing the claim is the whole switch: the pane watches that file and picks
  // it up within a frame or two, exactly as `--random` does mid-session.
  if (windowIsRunning(id)) {
    const asked = forced ?? requestedName()

    if (asked) {
      // Resolved rather than fetched, for the same reason the launch path below
      // stopped fetching: `claude --resume --somethingNew` against a live pane
      // used to download here, inside a hook with five seconds to live. It was
      // the last place that could still be killed mid-download.
      //
      // A pane that is already up needs no Pokeball — it has a Pokemon on screen
      // and can go on showing it. So the claim is only written once the files
      // are real, which `src/fetch.mjs` does when they land, and the pane picks
      // the new name up on its next poll.
      if (isFetched(asked)) {
        try {
          mkdirSync(STATE_DIR, { recursive: true })
          writeFileSync(speciesFileFor(id), asked)
        } catch {}
      } else {
        try {
          const fetcher = spawn(
            process.execPath,
            [join(ROOT, 'src', 'fetch.mjs'), asked, speciesFileFor(id), ''],
            { detached: true, stdio: 'ignore' },
          )

          fetcher.unref()
        } catch {}
      }

      // Remembered as well as claimed. `claude --resume --gengar` against a
      // pane that is already up changes what you are looking at, so it is the
      // answer this session should come back to next time, not the one it had
      // before the resume.
      rememberSpecies(id, asked, 'asked')
    }

    return false
  }

  // Claim the pane before anything is launched.
  //
  // Written with the exclusive flag, so of two callers arriving together exactly
  // one succeeds — the check above cannot do this, because a pane has no pid to
  // find until a second after it was asked for.
  //
  // A stale claim is taken over rather than obeyed. Opening can fail outright —
  // no Ghostty, no accessibility permission — and a claim nobody ever came back
  // for would otherwise mean no pane for the rest of the session.
  {
    const claim = openingFileFor(id)

    try {
      mkdirSync(STATE_DIR, { recursive: true })
      writeFileSync(claim, String(Date.now()), { flag: 'wx' })
    } catch {
      let at = 0

      try {
        at = Number(readFileSync(claim, 'utf8').trim())
      } catch {}

      if (Number.isFinite(at) && at > 0 && Date.now() - at < STARTUP_GRACE_MS) return false

      try {
        writeFileSync(claim, String(Date.now()))
      } catch {}
    }
  }

  const rows = config.windowRows ?? 3
  const reason = {}

  // Asked for by name, and not downloaded yet.
  //
  // `chooseSpecies` would fetch it right here, and this whole function runs
  // inside a hook that is killed at five seconds. A download is two seconds on a
  // good connection and fourteen on a bad one, and the split is opened further
  // down — so an unlucky launch was killed before it ever opened one. No pane,
  // no error, and the half-finished download meant the next session lost the
  // same race from the start.
  //
  // So the split opens now, with the Pokeball sitting in it, and the download
  // runs behind it. `src/fetch.mjs` writes the name into the claim file when it
  // lands; the pane is already watching that file and greets a new name with the
  // ball bursting open, which is the arrival it plays for any switch. The wait
  // becomes the ceremony instead of an empty pane.
  const wanted = forced ?? requestedName()
  const pending = wanted && !isFetched(wanted) ? wanted : null

  const species = pending ? null : (forced ?? chooseSpecies(id, config, process.env, reason))

  if (forced || pending) reason.why = `${forced ? 'reopened' : 'asked'}${pending ? ', arriving' : ''}`

  // Claimed before the terminal is launched, so a second session starting in
  // the same moment sees this one taken rather than an empty room.
  if (species) {
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      writeFileSync(speciesFileFor(id), species)
    } catch {}

    // The durable half. Writing it here rather than inside chooseSpecies keeps
    // that function what it was — a decision with no side effects, which is the
    // only reason it can be tested without launching a terminal.
    rememberSpecies(id, species, reason.why)
  }

  // Started before the split rather than after, so the download and the two
  // seconds of opening a terminal overlap. Detached, because this hook has
  // milliseconds to live and the download outlives it by design.
  //
  // It writes the name into the claim file when both halves are on disk, and
  // puts back whatever was there if they never arrive — so a failed download
  // leaves a ball that quietly goes back to an ordinary Pokemon rather than a
  // pane waiting on something that is never coming.
  if (pending) {
    try {
      mkdirSync(STATE_DIR, { recursive: true })

      const fetcher = spawn(
        process.execPath,
        [join(ROOT, 'src', 'fetch.mjs'), pending, speciesFileFor(id), ''],
        { detached: true, stdio: 'ignore' },
      )

      fetcher.unref()
    } catch {}

    rememberSpecies(id, pending, reason.why)
  }

  logChoice(id, species, reason.why)

  if (config.windowMode === 'split') return openSplit(rows, config.splitShrink ?? 120, config.splitGrow ?? 0, id, species, pending)

  const args = [
    '-na',
    'Ghostty.app',
    '--args',
    // A window just tall enough for the sprite, and narrow. Ghostty sizes in
    // cells, which is what the sprite is measured in too.
    `--window-height=${rows + 1}`,
    `--window-width=${config.windowCols ?? 34}`,
    '--window-title=pikachu',
    '--window-decoration=false',
    '-e',
    process.execPath,
    join(ROOT, 'src', 'window.mjs'),
    String(rows),
    `--session=${safe(id)}`,
    ...(species ? [`--species=${species}`] : []),
    ...(pending ? [`--pending=${pending}`] : []),
  ]

  // Detached and with its streams released, so the hook can exit immediately
  // and the window is not tied to the lifetime of a hook that lives for
  // milliseconds.
  const child = spawn('open', args, { detached: true, stdio: 'ignore' })

  child.unref()

  return true
}

// Allow running it by hand: npm run companion
if (process.argv[1] && process.argv[1].endsWith('companion.mjs')) {
  const id = process.argv[2] ?? 'manual'

  console.log(openWindow(id) ? `opened the sprite window for ${id}` : 'already running')
}
