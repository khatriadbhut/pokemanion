// Installs the two things this needs that are not Node: chafa, and a terminal
// that can draw in.
//
// Separate from `npm run setup` on purpose. Setup edits config files you own
// and can undo; this installs software, and the second of those is a whole
// terminal emulator. Downloading an application because someone ran a setup
// script is not a thing to do quietly, so setup checks and names what is
// missing, and this is what you run when you want it done for you.
//
// It will not install a package manager for you. Homebrew's installer wants a
// password, writes to /opt, edits your shell profile and does not put `brew` on
// the PATH of the shell that ran it — a chain of things to go wrong in the
// middle of someone else's install script, to set up software they did not ask
// for. If there is no package manager it recognises, this says what to do
// instead and stops. Every tool here has a route that needs no package manager.
//
// The terminal half is macOS only, and the comment above `terminalPresent` says
// why: on Linux there are three that work, packaged differently everywhere, and
// choosing one on someone's behalf is further than this should go. It names
// them instead.
//
// Usage: npm run deps          — install what is missing
//        npm run deps -- --dry — say what it would do

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

const dry = process.argv.includes('--dry')
const say = (line = '') => console.log(line)

const have = (command) => spawnSync('command', ['-v', command], { shell: true, encoding: 'utf8' }).status === 0

// Which package manager is here, and how it installs one package.
//
// Homebrew first because on a Mac it has both of these, MacPorts second because
// it has chafa. The Linux entries are the five that cover almost everything —
// and they are here rather than in a comment because chafa is packaged
// everywhere, so on Linux this is a one-line install rather than the source
// build macOS needs when Homebrew is absent.
//
// `sudo` where the manager needs it and not where it does not. Homebrew refuses
// to run under sudo outright, and prefixing it would turn a working install into
// an error message about not running Homebrew as root.
const MANAGERS = [
  { name: 'brew', install: (pkg) => ['brew', ['install', pkg]] },
  { name: 'port', install: (pkg) => ['sudo', ['port', 'install', pkg]] },
  { name: 'apt-get', install: (pkg) => ['sudo', ['apt-get', 'install', '-y', pkg]] },
  { name: 'dnf', install: (pkg) => ['sudo', ['dnf', 'install', '-y', pkg]] },
  { name: 'pacman', install: (pkg) => ['sudo', ['pacman', '-S', '--noconfirm', pkg]] },
  { name: 'zypper', install: (pkg) => ['sudo', ['zypper', 'install', '-y', pkg]] },
  { name: 'apk', install: (pkg) => ['sudo', ['apk', 'add', pkg]] },
]

const found = MANAGERS.find((entry) => have(entry.name)) ?? null
const manager = found?.name ?? null

const mac = process.platform === 'darwin'

const GHOSTTY_APP = '/Applications/Ghostty.app'

// The terminal half of this is a macOS question and a Linux non-question.
//
// On a Mac the pane is a Ghostty split, Ghostty is a cask, and `brew install
// --cask ghostty` is a real answer. On Linux there are three terminals that
// work, they are packaged differently in every distribution, and two of them
// are usually installed from the project's own repository — so this names them
// and installs none of them. Downloading a terminal emulator someone did not
// ask for is already at the edge of what this script should do; guessing which
// one, on a platform where the guess is likely wrong, is over it.
const terminalPresent = () =>
  mac ? existsSync(GHOSTTY_APP) : have('wezterm') || have('kitty') || have('ghostty')

const NEEDED = [
  {
    name: 'chafa',
    why: 'turns the sprites into terminal graphics',
    present: () => have('chafa'),
    // MacPorts ships it too, which is worth knowing: without it the only route
    // is building from source, since there is no prebuilt macOS binary.
    command: () => found?.install('chafa') ?? null,
    without: mac
      ? [
          'MacPorts:     sudo port install chafa',
          'from source:  https://hpjansson.org/chafa/download/',
          `${DIM}there is no prebuilt macOS binary, so one of those two it is${RESET}`,
        ]
      : [
          'Debian/Ubuntu:  sudo apt-get install chafa',
          'Fedora:         sudo dnf install chafa',
          'Arch:           sudo pacman -S chafa',
          `${DIM}it is packaged just about everywhere — that list is not exhaustive${RESET}`,
        ],
  },
  {
    name: mac ? 'Ghostty' : 'a terminal that can draw the sprite',
    why: 'the terminal the pane opens in',
    present: terminalPresent,
    // Not in MacPorts — it is a GUI app, and the project ships its own build.
    // Nothing on Linux: see the note above terminalPresent.
    command: () => (mac && manager === 'brew' ? ['brew', ['install', '--cask', 'ghostty']] : null),
    without: mac
      ? [
          'download the .dmg:  https://ghostty.org/download',
          `${DIM}a universal build, macOS 13+, no package manager needed${RESET}`,
        ]
      : [
          'WezTerm:  https://wezterm.org/installation  — nothing to configure, and the',
          `${DIM}          pane is sized in cells, so it is the one that just works${RESET}`,
          'kitty:    https://sw.kovidgoyal.net/kitty/binary/  — then: npm run kitty -- --install',
          'Ghostty:  https://ghostty.org/download  — opens the pane as its own window',
          `${DIM}this installs none of them: they are packaged differently in every${RESET}`,
          `${DIM}distribution, and picking one for you is not this script's call${RESET}`,
        ],
  },
]

say()

const missing = NEEDED.filter((item) => !item.present())

for (const item of NEEDED.filter((entry) => entry.present())) {
  say(`  ${GREEN}✓${RESET} ${item.name}${DIM} — already installed${RESET}`)
}

if (missing.length === 0) {
  say(`\n  ${DIM}nothing to do. run npm run setup next.${RESET}\n`)
  process.exit(0)
}

// Anything this cannot install here, with the route that needs no package
// manager. Printed before the installs so someone reading a wall of brew output
// does not miss it.
const unhandled = missing.filter((item) => item.command() === null)

if (unhandled.length > 0) {
  if (!manager) {
    say(
      mac
        ? `  ${YELLOW}no Homebrew or MacPorts here${RESET}${DIM} — and this will not install one for you${RESET}`
        : `  ${YELLOW}no package manager this recognises${RESET}${DIM} — it knows apt, dnf, pacman, zypper and apk${RESET}`,
    )
    say(`  ${DIM}${mac ? 'https://brew.sh if you want one. Otherwise, per tool:' : 'per tool:'}${RESET}`)
  }

  for (const item of unhandled) {
    say()
    say(`  ${BOLD}${item.name}${RESET}${DIM} — ${item.why}${RESET}`)

    for (const line of item.without) say(`    ${line}`)
  }

  say()
}

const installable = missing.filter((item) => item.command() !== null)

for (const item of installable) {
  const [command, args] = item.command()

  if (dry) {
    say(`  ${DIM}would run:${RESET} ${command} ${args.join(' ')}${DIM} — ${item.why}${RESET}`)

    continue
  }

  say(`  installing ${item.name}${DIM} — ${item.why}${RESET}`)

  // Inherited, because these ask for a password and print progress worth
  // watching. Swallowing that output would look like a hang.
  const result = spawnSync(command, args, { stdio: 'inherit' })

  if (result.status !== 0) {
    say(`\n  ${RED}${command} ${args.join(' ')} failed${RESET}`)
    say(`  ${DIM}install ${item.name} yourself, then run npm run setup${RESET}\n`)
    process.exit(1)
  }
}

if (dry) {
  say(`\n  ${DIM}--dry, so nothing was installed${RESET}\n`)
  process.exit(0)
}

const stillMissing = NEEDED.filter((item) => !item.present())

say()

if (stillMissing.length > 0) {
  say(`  ${YELLOW}still missing: ${stillMissing.map((item) => item.name).join(', ')}${RESET}`)
  say(`  ${DIM}install those, then run npm run setup${RESET}\n`)
  process.exit(1)
}

say(`  ${GREEN}${mac ? 'both installed.' : 'installed.'}${RESET} now run: npm run setup\n`)
