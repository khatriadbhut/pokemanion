// The whole install, in one command.
//
// It was four: roster, warm, install-statusline, shell --install. Each one is
// still there and still does exactly what it did, because they are the things
// you reach for afterwards when only one part needs redoing. But four commands
// in order, where three of them mean nothing to someone who has just cloned
// this, is a setup step that people abandon halfway through and then report as
// broken.
//
// Checks first, because the failures worth catching are the ones that happen
// before anything has been written: no chafa, no Ghostty, wrong platform. A
// missing chafa surfaces four minutes in as a render error otherwise, which
// reads as "this project does not work" rather than "run brew install chafa".
//
// Safe to run again. Every step underneath it already is — roster skips sprites
// it has, warm skips frames it has, and both installers rewrite their own block
// rather than appending a second one.
//
// Usage: npm run setup

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { ROOT } from './config.mjs'
import { AGENTS, chosen, isStale } from './agents.mjs'
import { chooseLauncher } from './launcher.mjs'
import { rcFile } from './shell.mjs'
import { ROSTER } from './roster.mjs'

const DIM = '[2m'
const BOLD = '[1m'
const GREEN = '[32m'
const RED = '[31m'
const YELLOW = '[33m'
const RESET = '[0m'

const say = (line = '') => console.log(line)

// Every reason to stop before touching anything, gathered together so someone
// missing two of them hears about both at once rather than one per attempt.
const blockers = []
const warnings = []

// Which terminal will be asked to open the pane, decided once so every message
// below can name it.
//
// This used to be a blocker reading `process.platform !== 'darwin'`, and it was
// honest at the time: the pane was a Ghostty split, a split was a keystroke, and
// the keystroke was AppleScript. It is not true any more — WezTerm and kitty are
// driven by a command line that is the same on both platforms — so the question
// stopped being which operating system this is and became which terminal you
// are sitting in.
//
// A warning rather than a blocker, and deliberately. Everything else setup does
// is worth doing without a pane: the sprites are downloaded and rendered, the
// hooks are registered, the wrapper is written. Someone installing over SSH, or
// in a terminal this cannot drive today, gets a working install and a sentence
// about the one part that will not run — rather than being turned away at the
// door with nothing.
const launcher = chooseLauncher()

if (!launcher) {
  warnings.push([
    `no terminal here that the pane can be opened in${process.env.TERM_PROGRAM ? ` — this is ${process.env.TERM_PROGRAM}` : ''}`,
    'it needs Ghostty on macOS, or WezTerm, or kitty with remote control on. everything else here still installs',
  ])
}

// package.json says node >= 20, but `engines` is advice npm does not enforce
// unless it is asked to. Without this an old node reaches the sprite renderer
// and dies somewhere far from the cause, which reads as the project being
// broken rather than the runtime being too old.
const NODE_MINIMUM = 20
const nodeMajor = Number(process.versions.node.split('.')[0])

if (Number.isFinite(nodeMajor) && nodeMajor < NODE_MINIMUM) {
  blockers.push([
    `node ${process.versions.node} is too old — this needs ${NODE_MINIMUM} or newer`,
    'brew upgrade node, or nvm install --lts, then run this again',
  ])
}

if (spawnSync('chafa', ['--version'], { encoding: 'utf8' }).status !== 0) {
  // npm run deps knows the routes that do not involve Homebrew, so point at it
  // rather than repeating them here and having two places to keep right.
  blockers.push(['chafa is not installed', 'brew install chafa — or: npm run deps, which knows the other ways'])
}

// Not a blocker: everything installs fine without it, and the pane can be run
// by hand. It is only the automatic split that needs the app itself.
//
// Only worth saying on a Mac with no other terminal to fall back to. Told to
// install Ghostty while sitting in the WezTerm that is about to open the pane
// perfectly well is advice that makes someone doubt a working install.
if (process.platform === 'darwin' && !launcher && !existsSync('/Applications/Ghostty.app')) {
  warnings.push(['Ghostty is not in /Applications', 'the sprite needs it — https://ghostty.org'])
}

// zsh and bash both work — the function is plain POSIX-ish shell and runs the
// same under bash 3.2, which is what macOS ships. Anything else gets the
// warning, because the file it would be written to is a guess.
if (!/(zsh|bash)$/.test(process.env.SHELL ?? '')) {
  warnings.push([
    `your shell is ${process.env.SHELL ?? 'unknown'}, not zsh or bash`,
    'the shell wrapper will be written to ~/.zshrc, so launch flags may not load — everything typed inside a session still works',
  ])
}

// Which agents this is for, decided here so every message below can name them
// rather than assuming Claude. `--claude` / `--codex` force it; otherwise it is
// whichever binaries are actually on the machine.
const agents = chosen()

if (agents.length === 0) {
  const stale = AGENTS.filter(isStale)

  blockers.push([
    'no coding agent found',
    stale.length > 0
      ? `install Claude Code or Codex — ${stale.map((agent) => agent.dir()).join(', ')} exists, but the program does not`
      : 'install Claude Code or Codex first',
  ])
}

say()
say(`  ${BOLD}pokemanion${RESET}${DIM} — a Pokemon beside every coding session${RESET}`)
say()

if (agents.length > 0) {
  say(`  ${DIM}found:${RESET} ${agents.map((agent) => agent.label).join(', ')}`)
  say()
}

if (blockers.length > 0) {
  for (const [what, fix] of blockers) say(`  ${RED}✗${RESET} ${what}\n    ${DIM}${fix}${RESET}`)

  say()
  say(`  ${DIM}nothing was changed.${RESET}`)
  say()

  process.exit(1)
}

for (const [what, fix] of warnings) say(`  ${YELLOW}!${RESET} ${what}\n    ${DIM}${fix}${RESET}`)

if (warnings.length > 0) say()

// Kept in this order deliberately: sprites have to exist before they can be
// rendered, and both have to exist before a hook can point at them.
const steps = [
  ['downloading sprites', ['src/roster.mjs'], `the ${ROSTER.length} that ship with it`],
  ['rendering them for your pane', ['src/warm.mjs'], 'once, so a session starts instantly'],
  ['registering the hooks', ['install.mjs'], `into ${agents.map((agent) => `~/.${agent.name}`).join(' and ')}`],
  [`adding the ${agents.map((agent) => `${agent.name}()`).join(' and ')} wrapper`, ['src/shell.mjs', '--install'], 'for the launch flags'],
  // Both of these configure the terminal that will open the pane, so only the
  // one that applies is run. Writing a Ghostty keybind on a machine whose pane
  // comes from kitty is editing a config file for no reason, which is the sort
  // of thing an install should not do.
  //
  // Without the Ghostty one the pane still opens — at half the window height,
  // because the keystroke that collapses it is bound to nothing. That read as a
  // layout bug for anyone but the one machine where the keybind had been added
  // by hand. Without the kitty one the pane does not open at all: `kitty @` is
  // a request over a socket kitty is not listening on until told to.
  ...(launcher?.name === 'ghostty-macos'
    ? [['setting the Ghostty resize keybind', ['src/ghostty.mjs', '--install'], 'so the pane is a strip, not half the window']]
    : []),
  ...(launcher?.name === 'kitty'
    ? [['setting the kitty options the pane needs', ['src/kitty.mjs', '--install'], 'remote control, and the splits layout']]
    : []),
  // The plugin ships this to both agents; a clone has the same file and no way
  // to offer it, so it is linked into ~/.claude/skills here.
  ['teaching your agent to add characters', ['src/skill.mjs', '--install'], 'the skill the plugin ships'],
]

let done = 0

for (const [label, args, why] of steps) {
  process.stdout.write(`  ${DIM}${String(done + 1)}/${steps.length}${RESET} ${label}${DIM} — ${why}${RESET} `)

  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })

  if (result.status !== 0) {
    say(`${RED}✗${RESET}`)
    say()
    say(`  ${RED}stopped at: ${label}${RESET}`)

    // The step's own output, which is where the actual reason is. Indented so
    // it reads as quoted rather than as this script's own words.
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()

    if (output) {
      say()
      for (const line of output.split('\n').slice(-12)) say(`    ${DIM}${line}${RESET}`)
    }

    say()
    say(`  ${DIM}the steps before it did complete. run npm run setup again once it is fixed.${RESET}`)
    say()

    process.exit(1)
  }

  say(`${GREEN}✓${RESET}`)
  done++
}

say()

// What is left to do by hand, which depends on which terminal is going to open
// the pane.
//
// This was three fixed lines ending in a paragraph about macOS Accessibility.
// That paragraph is the single most confusing thing this script can print to
// someone on Linux — it names a System Settings pane they do not have, for a
// permission their pane does not need, and reads as "this did not work". The
// keystroke it is about belongs to the Ghostty path and to nothing else.
const needsRestart = launcher?.name === 'ghostty-macos' ? 'Ghostty' : launcher?.name === 'kitty' ? 'kitty' : null

const remaining = [
  [`restart ${agents.map((agent) => agent.label).join(' and ')}`, 'hooks are read at startup'],
  ...(needsRestart ? [[`restart ${needsRestart}`, 'it reads its config at startup']] : []),
  ['open a new terminal', `or: source ${rcFile()}`],
]

say(`  ${GREEN}installed.${RESET} ${remaining.length === 3 ? 'three' : 'two'} things left, and none of them is optional:`)
say()

const column = Math.max(...remaining.map(([what]) => what.length)) + 4
const pad = (text) => text + ' '.repeat(Math.max(1, column - text.length))

remaining.forEach(([what, why], index) => {
  say(`    ${BOLD}${index + 1}.${RESET} ${pad(what)}${DIM}${why}${RESET}`)
})

say()

// The permission, and only where there is one. It is the price of opening a
// split by pressing the key that splits it, which is the macOS Ghostty path
// alone — the others hand the request to the terminal over its own socket, and
// macOS has no opinion about that.
if (launcher?.name === 'ghostty-macos') {
  say(`  ${DIM}and once, by hand: System Settings > Privacy & Security > Accessibility${RESET}`)
  say(`  ${DIM}> enable Ghostty. Opening a split means pressing keys, and macOS will${RESET}`)
  say(`  ${DIM}not let anything press keys until you allow it.${RESET}`)
  say()
} else if (!launcher) {
  say(`  ${YELLOW}there is still no terminal here that can open the pane for you.${RESET}`)
  say(`  ${DIM}run it yourself in a second terminal that speaks the kitty graphics${RESET}`)
  say(`  ${DIM}protocol:${RESET} npm run window 4 --session=<id>`)
  say()
}

say(`  ${DIM}then a Pokemon appears beside your next session. it rests while the${RESET}`)
say(`  ${DIM}agent waits and animates while it works.${RESET}`)
say()
say(`  ${DIM}type${RESET} --pokemon ${DIM}at your agent to see the roster,${RESET} --random ${DIM}to be handed one,${RESET}`)
say(`  ${DIM}or${RESET} --dex pikachu ${DIM}to look one up. ${RESET}npm run doctor${DIM} if anything looks wrong.${RESET}`)
say()
