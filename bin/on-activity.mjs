// Hook handler. Records whether Claude is working so the status line knows
// whether to animate. Writes one small file and exits; it must never be the
// reason a prompt is slow, so everything here is best effort.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, STATE_DIR, clearState, loadConfig, readState, writeState } from '../src/config.mjs'
import { closeWindow, openWindow, windowIsRunning } from '../src/companion.mjs'

const WORKING = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse'])
const IDLE = new Set(['Stop', 'SessionEnd', 'SessionStart'])

// The same state under two names. Claude Code calls it Notification, Codex
// calls it PermissionRequest, and both mean the agent has stopped to ask you
// something — which is not working, whatever the last tool hook said.
//
// Everything else about the two is identical: same event names, same JSON on
// stdin, same field names, same exit-2-to-block. This file needed no other
// change to serve both, which is the only reason Codex support is a config
// question rather than a port.
const WAITING = new Set(['Notification', 'PermissionRequest'])

const read = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

try {
  const payload = read()

  // Which hooks actually fire, and when. Claude Code documents the events but
  // not what it does with them at the edges — whether interrupting a tool still
  // reports its PostToolUse, whether Stop fires when you press escape — and the
  // sprite is wrong exactly when an assumption about that is wrong. `npm run
  // watch` reads the other half; this is the hooks' own account.
  if (process.env.PIXEL_RUNNER_LOG_HOOK || loadConfig().logHooks) {
    const { appendFileSync, mkdirSync } = await import('node:fs')
    const { STATE_DIR } = await import('../src/config.mjs')

    try {
      mkdirSync(STATE_DIR, { recursive: true })
      // Session events are logged whole. They are rare, and they are the ones
      // whose payload we have to reason about — which sessions deserve a pane
      // is decided from what SessionStart says about itself.
      const session = /^Session/.test(payload?.hook_event_name ?? '')

      // Whether `claude --pikachu` reached this far. The flag is lifted by a
      // shell function and carried in the environment, and every link in that
      // chain is testable except this one — whether Claude Code hands its own
      // environment to the hooks it runs. Recorded so it can be seen rather
      // than assumed.
      const asked = process.env.PIXEL_RUNNER_SPECIES ?? null

      appendFileSync(
        `${STATE_DIR}/hooks.jsonl`,
        `${JSON.stringify(
          session
            ? { at: Date.now(), asked, ...payload }
            : {
                at: Date.now(),
                asked,
                event: payload?.hook_event_name,
                session: payload?.session_id,
                tool: payload?.tool_name ?? null,
              },
        )}\n`,
      )
    } catch {}
  }

  const event = payload?.hook_event_name

  // Two installs, one pane.
  //
  // Installing the plugin when a clone is already wired up used to give you two
  // Pokemon beside one session: both sets of hooks fire, each with its own state
  // directory, neither aware of the other. It reads as a bug in the pane rather
  // than as having installed the same thing twice.
  //
  // The plugin is the one that stands down, because the clone is the deliberate
  // install — someone cloned it and ran setup — and it owns the shell wrapper.
  // Nothing is uninstalled and nothing is refused: the plugin stays listed and
  // enabled, it simply does not act, and says so once. Remove the clone's hooks
  // and it takes over on the next session.
  //
  // Checked live rather than recorded, so removing one is noticed immediately.
  {
    const { isPluginRoot } = await import('../src/shell.mjs')

    // The clone noticing the plugin, rather than the other way round.
    //
    // Everything below this is the plugin standing down and explaining itself,
    // and none of it can run in the session where the plugin was installed —
    // hooks are read when the agent starts, so a plugin installed into a running
    // session has nothing running. `/plugin install` reports success and then
    // the pane carries on exactly as before, with no message, which reads as the
    // install having failed.
    //
    // So the copy that *is* running says it. Same facts, no restart, delivered
    // in the session where the question was asked.
    if (!isPluginRoot() && event === 'UserPromptSubmit') {
      const { pluginInstalls } = await import('../src/agents.mjs')
      const plugins = pluginInstalls()

      if (plugins.length > 0) {
        const { installedVersion, isNewer } = await import('../src/update.mjs')
        const note = join(STATE_DIR, 'plugin-seen')

        const ours = installedVersion()
        const theirs = plugins[0].version

        const said = (() => {
          try {
            return JSON.parse(readFileSync(note, 'utf8'))
          } catch {
            return null
          }
        })()

        // Once per plugin version. Updating the plugin while this copy holds the
        // hooks changes nothing visible, so a plugin that has just moved past us
        // is worth another line — it is the moment someone would otherwise sit
        // waiting for a new version that is installed and idle.
        if (!said || said.version !== theirs) {
          try {
            mkdirSync(STATE_DIR, { recursive: true })
            writeFileSync(note, JSON.stringify({ version: theirs }))
          } catch {}

          const newer = ours && theirs && isNewer(theirs, ours)

          process.stderr.write(
            newer
              ? `Plugin v${theirs} installed and idle — this clone is v${ours} and still the one running.\n\n` +
                '  --pokemanion use plugin   hand over to it\n' +
                '  or update this one        git pull && npm run setup\n'
              : `Plugin v${theirs ?? '?'} installed, but this clone is the one running it — one Pokemon, not two.\n\n` +
                '  --pokemanion use plugin   hand over to the plugin\n',
          )
          process.exit(2)
        }
      }
    }

    if (isPluginRoot()) {
      const { otherInstalls } = await import('../src/agents.mjs')
      const others = otherInstalls(ROOT)

      if (others.length > 0) {
        if (event === 'UserPromptSubmit') {
          // The switch, typed rather than run in a terminal. Handled by the copy
          // standing down, because it is the only one that knows both paths.
          //
          // It unregisters the other install's hooks; it does not delete
          // anything. Removing the folder frees disk and is the one step with no
          // undo — that stays the owner's decision, not a hook's.
          if (/^\s*--pokemanion\s+use\s+plugin\s*$/i.test(payload.prompt ?? '')) {
            const { spawnSync: switchOver } = await import('node:child_process')
            const done = switchOver(process.execPath, [join(others[0], 'install.mjs'), '--uninstall'], { encoding: 'utf8' })

            process.stderr.write(
              done.status === 0
                ? `switched — this plugin now runs it, ${others[0]} no longer does\n\n  restart the agent\n`
                : `could not switch: ${(done.stderr || done.stdout || 'no output').trim().split('\n')[0]}\n\n` +
                  `  try: cd ${others[0]} && npm run uninstall-statusline\n`,
            )
            process.exit(2)
          }

          const { installedVersion, versionAt, isNewer } = await import('../src/update.mjs')
          const note = join(STATE_DIR, 'deferred')

          const ours = installedVersion()
          const theirs = versionAt(others[0])

          // Said once — and said again whenever this copy becomes newer than the
          // one actually running.
          //
          // Updating the plugin while the source install holds the hooks changes
          // nothing you can see: the pane goes on running the older copy, and the
          // one message that would explain it has already been spent. So the
          // record is keyed by version, and a plugin that has just been updated
          // past the running install gets to say so.
          const said = (() => {
            try {
              return JSON.parse(readFileSync(note, 'utf8'))
            } catch {
              return null
            }
          })()

          const stale = ours && theirs && isNewer(ours, theirs)
          const owed = !said || (stale && said.version !== ours)

          if (owed) {
            try {
              mkdirSync(STATE_DIR, { recursive: true })
              writeFileSync(note, JSON.stringify({ version: ours, roots: others }))
            } catch {}

            // `~` rather than the full path. It is the only long thing in
            // either message, and the message is read in a chat window.
            const { homedir } = await import('node:os')
            const short = others[0].startsWith(homedir()) ? `~${others[0].slice(homedir().length)}` : others[0]

            process.stderr.write(
              stale
                ? `Running v${theirs} from ${short}. This plugin is v${ours}.\n\n` +
                  '  --pokemanion use plugin   run this one instead\n' +
                  `  or update it   cd ${short} && git pull && npm run setup\n`
                : `Already running from ${short}, so the plugin is idle — one Pokemon, not two.\n\n` +
                  '  --pokemanion use plugin   run the plugin instead\n',
            )
            process.exit(2)
          }
        }

        process.exit(0)
      }
    }
  }

  // Arm the hello on the very first hook of any kind.
  //
  // It used to be armed by SessionStart, which cannot fire until the agent has
  // been restarted — so the notice could only ever arrive after the restart it
  // was asking for. Any hook will do, and the first one after `/plugin install`
  // is usually a prompt in the session you are already in.
  //
  // Two files rather than one: `greet` means owed, `greeted` means spent. With
  // only `greet`, deleting it on show would re-arm on the next hook and the
  // notice would repeat forever.
  const owed = join(STATE_DIR, 'greet')
  const spent = join(STATE_DIR, 'greeted')

  if (!existsSync(spent) && !existsSync(owed) && !existsSync(join(STATE_DIR, 'node-path'))) {
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      writeFileSync(owed, '')
    } catch {}
  }

  // Everything is keyed by the session that sent the hook, so two Claude
  // windows never see each other's state.
  const session = payload.session_id

  // A prompt that is only `--pikachu` is aimed at the pane, not at Claude.
  //
  // Handled before anything else, and before the state is marked working: this
  // prompt is about to be blocked, so no turn is starting and saying one did
  // would leave the sprite running against a turn that never happened.
  if (event === 'UserPromptSubmit') {
    // The one hello, on the first prompt after an install that had no setup step.
    //
    // A plugin registers the hooks and stops there. What is left are three things
    // no plugin can do: restart the agent so it reads its new hooks, restart
    // Ghostty so it reads its new keybind, and allow Ghostty in Accessibility so
    // macOS stops blocking the keystroke that opens the split. Skip that last one
    // and the install is perfect, no pane ever appears, and nothing anywhere says
    // why.
    //
    // Blocking a prompt is the only channel that reaches anyone — a hook that
    // exits 0 writes to a stderr nobody reads. So it spends exactly one prompt.
    // Marked spent before it is printed rather than after: a crash on the next
    // line then costs the message instead of repeating it every prompt forever.
    if (existsSync(owed)) {
      try {
        writeFileSync(spent, new Date().toISOString())
        rmSync(owed, { force: true })
      } catch {}

      const { hasGhostty } = await import('../src/bootstrap.mjs')
      const { rcFile } = await import('../src/shell.mjs')

      const { homedir: home } = await import('node:os')
      const rc = rcFile().startsWith(home()) ? `~${rcFile().slice(home().length)}` : rcFile()

      process.stderr.write(
        'pokemanion is installed. Three things left, none of them optional:\n\n' +
          '  1. Allow Ghostty in Accessibility — System Settings > Privacy &\n' +
          '     Security. No pane appears at all without it.\n' +
          '  2. Restart this agent, and Ghostty.\n' +
          `  3. Open a new terminal, or: source ${rc}   (for claude --pikachu)\n\n` +
          (hasGhostty() ? '' : 'Ghostty is missing — the pane is a Ghostty split: https://ghostty.org\n\n') +
          'Then send that message again. --pokemon lists who ships. Shown once.\n',
      )
      process.exit(2)
    }

    // A version you do not have, mentioned once and never installed for you.
    //
    // Same one-prompt cost as the hello, and for the same reason: a hook that
    // lets your prompt through has no way to tell you anything. Marked announced
    // before it is written, so a crash costs the message rather than repeating
    // it. The check itself is a detached background fetch, throttled to once a
    // day, that nothing ever waits on.
    if (loadConfig().updateCheck !== false) {
      const { checkInBackground, pendingUpdate, markAnnounced, notice } = await import('../src/update.mjs')

      checkInBackground()

      const pending = pendingUpdate()

      if (pending) {
        markAnnounced(pending.latest)
        process.stderr.write(notice(pending))
        process.exit(2)
      }
    }

    const { parse, describe } = await import('../src/switch.mjs')
    const { available, ensure, isFetched, knownCount } = await import('../src/roster.mjs')
    const { speciesFileFor } = await import('../src/companion.mjs')

    const asked = parse(payload.prompt)

    if (asked) {
      const pool = available()
      const file = speciesFileFor(session)

      let current = null

      try {
        current = readFileSync(file, 'utf8').trim() || null
      } catch {}

      // `--dex` answers and changes nothing. It is still blocked, because the
      // point is to look something up without spending a turn on it.
      // Handing the job to the agent, rather than doing it in a hook.
      //
      // This is the one command here that does not block. A blocked prompt shows
      // its stderr to you and stops; this needs the opposite — Claude Code adds a
      // UserPromptSubmit hook's stdout to the context when it exits 0, so writing
      // there and standing aside puts the instructions in front of the model and
      // lets the prompt through.
      //
      // Which is the whole point. Everything else in this file is answerable by a
      // program: switch the sprite, look up a name, report a version. Adding a
      // character is not — something has to look at a sheet, work out which
      // frames are the walk cycle, and write a Pokedex entry. So the flag is a
      // way of asking the agent, and the skill is what it reads.
      if (asked.kind === 'add') {
        const who = asked.name ? `called "${asked.name}"` : '— they have not said which yet'

        process.stdout.write(
          `The user typed \`--pokemanion add\`: they want to add a character ${who} to pokemanion.\n\n` +
            'Use the adding-a-character skill. Ask them, one at a time:\n' +
            '  1. the resting animation — a gif or png of what it does while waiting\n' +
            '  2. the working animation — what it does while the agent is busy\n' +
            '     (the same file again is fine if both cycles live in one sheet)\n' +
            '  3. whether anything needs cutting — frame ranges for a sheet of\n' +
            '     several cycles, a crop for figures side by side, a recolour if the\n' +
            '     two halves disagree\n\n' +
            'Then look at the files before installing them, render them at the size\n' +
            'the pane draws and check they read, run npm run add, and write the card\n' +
            'if this is not a Pokemon.\n',
        )
        process.exit(0)
      }

      // What the pane's corner cannot fit.
      if (asked.kind === 'update') {
        const { available, installedVersion, updateCommand } = await import('../src/update.mjs')
        const latest = available()

        process.stderr.write(
          latest
            ? `pokemanion v${latest} is out — you have v${installedVersion()}\n\n  ${updateCommand()}\n`
            : `pokemanion v${installedVersion()} — nothing newer that I know of\n`,
        )
        process.exit(2)
      }

      if (asked.kind === 'dex') {
        const { render, search, detail, entry, exactMatch, paneCard, all } = await import('../src/dex.mjs')
        const { fetchedGuests } = await import('../src/roster.mjs')

        if (!asked.query) {
          const here = [...pool.map(entry), ...fetchedGuests().map(entry)]

          process.stderr.write(
            `${all().length} available, ${pool.length} residents, ${fetchedGuests().length} guests on disk\n\n` +
              `${render(here, 40, false)}\n\n--dex <name|type|number> to search\n`,
          )
        } else {
          // `--dex current` means this pane, not "whatever panes exist" — the
          // session asking already knows which Pokemon it is holding, so it
          // answers with that one's card rather than a list of every window.
          const asking = asked.query.trim().toLowerCase()
          // Naming the one you are looking at counts as asking about it.
          // `current` was the only word that reached the pane, so `--dex ash`
          // with Ash sitting right there answered in the conversation instead —
          // the same question routed away from the thing it was about, purely
          // because it was asked by name. The rule this branch is built on is
          // "the answer belongs beside it", and a name satisfies that as well as
          // the word "current" does.
          const mine = asking === 'current' || (current && exactMatch(asking) === current) ? current : null

          // Without a claim of its own, "current" has no answer. Falling back
          // to a search would list what *other* windows are holding, under a
          // word that promises this one.
          if (asking === 'current' && !mine) {
            process.stderr.write('no Pokemon claimed for this session yet\n')
            process.exit(2)
          }

          // `--dex current` answers in the pane and nowhere else.
          //
          // It used to do both, and the pane was the smaller half of what you
          // got: the same stats arrived in the conversation at the same moment,
          // which is the thing this command exists to avoid. You asked about the
          // Pokemon you are already looking at, so the answer belongs beside it.
          //
          // `--dex random` still answers in the conversation, because there is
          // nothing to look at — it is one you have not summoned, and putting
          // its card in the pane would label the wrong Pokemon.
          if (mine) {
            const { mkdirSync, writeFileSync } = await import('node:fs')
            const { STATE_DIR } = await import('../src/config.mjs')

            try {
              mkdirSync(STATE_DIR, { recursive: true })
              writeFileSync(`${STATE_DIR}/window-${String(session).replace(/[^\w.-]/g, '')}.card`, paneCard(entry(mine)).join('\n'))
            } catch {}

            // One line rather than none. The prompt is erased either way, and a
            // prompt that vanishes in silence reads as a command that failed —
            // so this says where the answer went without being the answer.
            process.stderr.write(`${entry(mine).title} — beside the pane\n`)
            process.exit(2)
          }

          const found = search(asked.query)
          const hit = exactMatch(asked.query)

          // An exact name, or a single answer, gets the card; several get the
          // table. The same split the command line makes, because it is about
          // the shape of the answer rather than where it is being read.
          if (found.length === 0 && !hit) {
            const { suggest, unregistered } = await import('../src/switch.mjs')
            const meant = suggest(asked.query, pool)
            // Spelled correctly, drawn never. Worth saying, because "nothing
            // matches" invites you to try spelling it again.
            const known = unregistered(asked.query)

            process.stderr.write(
              known
                ? `${known.title} — #${known.num}, no data\n\nreal, but never drawn as a Gen 5 sprite, so it cannot be summoned\n`
                : `nothing matches "${asked.query}"${meant ? `\n\ndid you mean: ${meant}` : ''}\n`,
            )
          } else if (hit || found.length === 1) {
            const row = hit ? entry(hit) : found[0]
            // Forms, not everything that matched — the same count the command
            // line makes, and wrong here for the same reason: the follow-up it
            // offers searches the prefix, so a match without that prefix is
            // something that line cannot find.
            const others = found.filter((other) => other.name.startsWith(`${row.name}-`)).length

            process.stderr.write(
              `${detail(row, false)}\n` +
                (others > 0 ? `\n${others} other form${others === 1 ? '' : 's'} — --dex ${row.name}-\n` : ''),
            )
          } else {
            process.stderr.write(`${render(found, 25, false)}\n\n${found.length} found — type --<name> to summon\n`)
          }
        }

        process.exit(2)
      }

      // Rolled here rather than in the parser, and turned into an ordinary
      // switch, so everything downstream — fetching, the claim, the reply — is
      // the same code that handles a name typed out in full.
      if (asked.kind === 'random') {
        const { pickRandom, entry } = await import('../src/dex.mjs')

        // Whatever it lands on, without going to the network to find out whether
        // it can be had. The dice roll from names the sprite folder has, so a
        // miss means a download that has not happened yet rather than a Pokemon
        // that does not exist — and downloading is the background's job now.
        //
        // It used to try five times, fetching each candidate until one worked,
        // which is how `--random` came to take fourteen seconds against a five
        // second budget.
        const pick = pickRandom()
        const row = entry(pick)

        asked.kind = 'switch'
        asked.name = pick
        asked.guest = true
        asked.rolled = `${row.title} #${row.num || '?'} ${row.types}`
      }

      // A guest has to be on disk before the claim names it, because the pane
      // refuses to switch to a species whose files are missing — and refuses
      // silently, which would read as the command doing nothing. This is the
      // one place a hook goes to the network, and only the first time a given
      // Pokemon is asked for.
      // A guest that is not on disk yet is fetched in the background, never here.
      //
      // Downloading one takes about three seconds and a hook is allowed five, so
      // `--kyogre` spent its whole budget on the network and was killed with its
      // output discarded — the command appearing to do nothing, twice, before
      // working on the third try. The claim is written either way; the pane
      // ignores it until the files exist and picks it up when src/fetch.mjs
      // rewrites it.
      if (asked.kind === 'switch' && asked.guest && !isFetched(asked.name)) {
        const { spawn } = await import('node:child_process')
        const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs')
        const { STATE_DIR } = await import('../src/config.mjs')
        const { rememberSpecies } = await import('../src/assigned.mjs')

        // Kept so the fetch can put it back if the download fails.
        //
        // `ensure` deletes the whole directory when either half fails to arrive,
        // on the rule that half a sprite is worse than none. That leaves the
        // claim naming a Pokemon that is not there, which every later pane in
        // the session then inherits — so one failed download made it look like
        // the tool had stopped working entirely.
        let previous = ''

        try {
          previous = readFileSync(file, 'utf8')
        } catch {}

        mkdirSync(STATE_DIR, { recursive: true })
        writeFileSync(file, asked.name)
        rememberSpecies(session, asked.name, asked.rolled ? 'rolled' : 'switched')

        // No pane and a Pokemon that has to be downloaded — both at once, which
        // is the worst version of this and the one worth handling properly.
        // Opening the pane covers the download too: it puts the Pokeball on
        // screen and starts the fetch itself, so the wait happens somewhere you
        // can see it rather than in silence.
        //
        // Only if that actually opened something. A machine with no Ghostty gets
        // false back, and the download still has to happen for the pane it will
        // eventually have.
        const opened = !windowIsRunning(session) && openWindow(session, 'switch', asked.name)

        if (!opened) {
          const child = spawn(process.execPath, [join(ROOT, 'src', 'fetch.mjs'), asked.name, file, previous], {
            detached: true,
            stdio: 'ignore',
          })

          child.unref()
        }

        process.stderr.write(
          asked.rolled
            ? `rolled ${asked.rolled} — fetching it, back in a moment\n`
            : `fetching ${asked.name} — it will arrive in a moment\n`,
        )
        process.exit(2)
      }

      // Written even when it is the name already showing. The pane reloads on
      // any write, so asking for the one you have is how you make it pick up a
      // sprite that changed on disk.
      if (asked.kind === 'switch') {
        const { mkdirSync, writeFileSync } = await import('node:fs')
        const { STATE_DIR } = await import('../src/config.mjs')
        const { rememberSpecies } = await import('../src/assigned.mjs')

        // The pane watches this file. Writing it is the whole switch — no new
        // window, no restart, and the claim stays correct for other terminals.
        mkdirSync(STATE_DIR, { recursive: true })
        writeFileSync(file, asked.name)

        // And remembered, because the claim above dies with the pane. Typing
        // `--gengar` and having the pane come back as something else after a
        // restart is the same bug as the rotation one, arrived at from the
        // other direction: the switch was never written anywhere that lasts.
        rememberSpecies(session, asked.name, asked.rolled ? 'rolled' : 'switched')

        // Close the pane and `--gengar` had nothing to switch. The claim was
        // written correctly, into a file nothing was reading, and the command
        // looked ignored — a pane was only ever opened at the start of a
        // session, so the only way to get one back was to start another session.
        //
        // Naming a Pokemon is a clear enough request for a pane to show it in.
        // Forced, because the pane has to come back as the one just typed rather
        // than re-running the usual decision, which a launch flag outranks.
        if (!windowIsRunning(session)) openWindow(session, 'switch', asked.name)
      }

      // Exit 2 blocks the prompt and erases it, and shows this to you as the
      // reason. That is what keeps `--pikachu` from being sent to Claude as a
      // message and answered as one.
      // A flag that is nobody's Pokemon belongs to whoever typed it.
      //
      // Any prompt that is only `--word` used to be caught here and answered with
      // "no such one" — so asking Claude `--update` while working on something
      // else got a Pokemon roster back and the prompt never arrived. Every flag
      // this project owns is a Pokemon or a word about Pokemon; anything a long
      // way from all of them was meant for something else.
      //
      // Near misses are still caught, which is the point of the suggestion:
      // `--charizrd` deserves a "did you mean", and so does `--urshifu`, spelled
      // correctly and simply never drawn.
      if (asked.kind === 'unknown') {
        const { nearest, unregistered } = await import('../src/switch.mjs')

        if (!nearest(asked.word) && !unregistered(asked.word)) process.exit(0)
      }

      // The one place we can actually reach someone.
      //
      // Every other channel is a hook whose output goes nowhere: SessionStart
      // writes to a stderr nobody reads, and a pane that never opens looks the
      // same as one you did not ask for. A blocked prompt is different — its
      // stderr is shown to you, in the conversation, as the reason.
      //
      // So if the two things the sprite cannot work without are missing, this
      // is where to say so. Only when something is actually wrong, and only on
      // a command that was going to answer anyway.
      const { hasGhostty, chafaFix } = await import('../src/bootstrap.mjs')
      const { spawnSync: probe } = await import('node:child_process')
      const missing = [
        hasGhostty() ? null : 'Ghostty — the pane is a Ghostty split (https://ghostty.org)',
        probe('command', ['-v', 'chafa'], { shell: true }).status === 0 ? null : chafaFix(),
      ].filter(Boolean)

      process.stderr.write(
        `${describe(asked, pool, current, knownCount() - pool.length)}\n` +
          (missing.length > 0 ? `\nno pane yet, missing:\n  ${missing.join('\n  ')}\n` : ''),
      )
      process.exit(2)
    }
  }

  if (WORKING.has(event)) {
    const now = Date.now()
    const previous = event === 'UserPromptSubmit' ? null : readState(session)

    writeState(session, {
      state: 'working',
      at: now,
      // When this turn began. Only a prompt starts one, and the tool hooks that
      // follow carry it forward unchanged — so an interruption can be compared
      // against the turn it interrupted rather than against whichever hook
      // happened to fire last. A tool interrupted mid-run still reports its
      // PostToolUse afterwards, and without this that lands newer than the
      // interruption and the sprite carries on running.
      promptAt: previous?.state === 'working' ? (previous.promptAt ?? previous.at ?? now) : now,
      // Where Claude writes this session's transcript. Pressing escape appends
      // an interruptedMessageId to it, which is the only trace an interruption
      // leaves anywhere — there is no hook for it.
      transcript: payload.transcript_path ?? null,
      // Only PreToolUse means a tool is in flight. PostToolUse means it
      // finished, so the tool is cleared and the heartbeat takes over deciding
      // whether Claude is still busy.
      tool: event === 'PreToolUse' ? (payload.tool_name ?? null) : null,
    })

    // Opening a pane here as well was tried, and removed.
    //
    // The idea was to paper over the two agents disagreeing about when a session
    // starts — Claude Code fires SessionStart at launch, Codex when you send
    // your first prompt. It does not help: on Codex those two events arrive in
    // the same second, because that second is when Codex decides a session
    // exists at all. There is no earlier hook to use.
    //
    // And it broke something. With randomPokemon off, chooseSpecies returns null
    // and nothing is recorded, so "has this session been given a Pokemon yet"
    // was false forever and every prompt attempted another split.
    //
    // The honest position is that the pane appears at launch on Claude and at
    // the first message on Codex, and that this is a difference between the
    // agents rather than something to work around.
  } else if (event === 'SessionEnd') {
    // The sprite belongs to this session, so it goes when the session does.
    closeWindow(session)
    clearState(session)
  } else if (IDLE.has(event)) {
    writeState(session, {
      state: 'idle',
      at: Date.now(),
      tool: null,
      transcript: payload.transcript_path ?? null,
    })

    // A new session gets a sprite of its own, unless one is already up for it
    // — or unless it is a background agent, which has no terminal to put one in.
    if (event === 'SessionStart' && loadConfig().autoWindow) {
      // Installed as a plugin, nothing ran `npm run setup`, so the one Ghostty
      // keybind the pane needs was never written — and without it the split
      // never collapses and the sprite arrives in a pane taking half the
      // window. That reads as broken rather than as unconfigured.
      //
      // Done here rather than left to the user because there is nowhere to tell
      // them: a SessionStart hook's output goes nowhere anyone reads. It is the
      // same idempotent write `npm run setup` performs — backed up, inside its
      // own markers, removed by `npm run ghostty -- --remove` — and a config
      // that already has the binding, by our hand or theirs, is left alone.
      //
      // Once per install. `install` is cheap when there is nothing to do, but
      // reading one file is cheaper, and this runs on every session.
      const done = join(STATE_DIR, 'bootstrapped')

      if (!existsSync(done)) {
        try {
          const { install } = await import('../src/ghostty.mjs')
          const { bootstrapChafa, hasGhostty } = await import('../src/bootstrap.mjs')

          // Only if Ghostty is actually here. Writing a config file for an
          // application someone does not have is litter, and it would sit in
          // ~/.config waiting to confuse them later.
          if (hasGhostty()) install()

          // The shell wrapper, so a plugin install is the same install as a
          // clone. It is the one thing the plugin used to leave out, which made
          // `claude --pikachu` a reason to clone rather than a feature.
          //
          // Only from a plugin. A clone gets this from `npm run setup`, and
          // doing it here as well would write to a shell file that someone
          // running the pane by hand never asked us to touch.
          const { install: installShell, isPluginRoot } = await import('../src/shell.mjs')

          if (isPluginRoot()) installShell()

          bootstrapChafa()
          mkdirSync(STATE_DIR, { recursive: true })
          writeFileSync(done, new Date().toISOString())
        } catch {}
      }

      openWindow(session, payload.source ?? null)
    }
  } else if (WAITING.has(event)) {
    // Claude wants something from you, so it is not working — whatever the last
    // tool hook said. The transcript is kept so the sprite can go on watching
    // it, and the tool cleared so nothing counts as still in flight.
    writeState(session, {
      state: 'waiting',
      at: Date.now(),
      tool: null,
      transcript: payload.transcript_path ?? readState(session)?.transcript ?? null,
    })
  }
} catch {}

process.exit(0)
