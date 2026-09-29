// Fetching chafa on a plugin install, in the background, once.
//
// `npm run setup` refuses to continue without chafa and tells you how to get
// it. A plugin install has no such moment: nothing runs, nobody is asked
// anything, and the first sign of trouble is a pane that opens and stays empty
// because there is no renderer to draw with. There is nowhere to put a message
// either — a SessionStart hook's output goes nowhere anyone reads.
//
// So it is fetched. Three things make that defensible rather than presumptuous:
//
//   - You installed a plugin whose entire stated purpose is drawing a sprite in
//     a terminal. chafa is what does the drawing. It is not a side quest.
//   - chafa is a Homebrew *formula*, not a cask, so it needs no password and
//     touches nothing outside the Homebrew prefix.
//   - It is attempted once, only when Homebrew is already installed, and it is
//     written down in the log rather than done silently.
//
// Detached, because `brew install` takes tens of seconds and a hook must never
// be the reason a session is slow to start. The consequence is honest: the
// sprite does not work for the first minute of the first session, and then it
// does.
//
// A terminal is deliberately not fetched. Ghostty is a GUI application, a cask,
// and can ask for a password — and the pane opens inside a terminal you are
// already sitting in, so anyone who can see a pane at all already has one.
//
// The question "is there a terminal here that can open the pane?" used to live
// in this file as `hasGhostty`, a check for /Applications/Ghostty.app. It is
// `chooseLauncher` in src/launcher.mjs now, because the answer stopped being a
// single path on a single platform.

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from './config.mjs'

const have = (command) => spawnSync('command', ['-v', command], { shell: true, encoding: 'utf8' }).status === 0

const note = (what) => {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    appendFileSync(join(STATE_DIR, 'hooks.jsonl'), `${JSON.stringify({ at: Date.now(), event: 'bootstrap', ...what })}\n`)
  } catch {}
}

export const bootstrapChafa = () => {
  if (have('chafa')) return 'already installed'

  // Homebrew and nothing else, on purpose, and the reason is the sudo in every
  // other entry of that list. MacPorts, apt, dnf and the rest all want a
  // password, and a background process started by a hook has no terminal to ask
  // on — it would hang forever holding the package manager's lock, which is a
  // considerably worse outcome than no chafa. Homebrew is the one that installs
  // a formula without asking anybody anything.
  //
  // So on Linux this reliably does nothing, and says so in the log. `npm run
  // deps` is the route there, and it has a terminal to ask on.
  if (!have('brew')) {
    note({ step: 'chafa missing, no unattended installer', platform: process.platform, fix: 'npm run deps' })

    return 'no package manager'
  }

  try {
    // Detached and disowned: this outlives the hook, which exits in
    // milliseconds. stdio ignored because there is no terminal to write to.
    const child = spawn('brew', ['install', 'chafa'], { detached: true, stdio: 'ignore' })

    child.unref()
    note({ step: 'installing chafa in the background', pid: child.pid })

    return 'started'
  } catch (error) {
    note({ step: 'chafa install failed to start', error: String(error).slice(0, 120) })

    return 'failed'
  }
}

if (process.argv[1] && process.argv[1].endsWith('bootstrap.mjs')) {
  console.log(`\n  chafa: ${bootstrapChafa()}\n`)
}

// What to tell someone who has no chafa, given what they do have.
//
// "brew install chafa" is a dead end for anyone without Homebrew, and a plugin
// user cannot conveniently run `npm run deps` to be told the alternatives — the
// clone is buried in a plugins directory. So the advice is chosen here, from
// what is actually on the machine.
//
// There is no fourth option on a Mac: chafa publishes no prebuilt macOS binary,
// so without a package manager it is a source build. On Linux it is packaged
// everywhere, which is why that list is longer and none of it ends in a plea to
// install a package manager first.
export const chafaFix = (platform = process.platform, exists = have) => {
  const managers = [
    ['brew', 'brew install chafa'],
    ['port', 'sudo port install chafa'],
    ['apt-get', 'sudo apt-get install chafa'],
    ['dnf', 'sudo dnf install chafa'],
    ['pacman', 'sudo pacman -S chafa'],
    ['zypper', 'sudo zypper install chafa'],
    ['apk', 'sudo apk add chafa'],
  ]

  const found = managers.find(([command]) => exists(command))

  if (found) return `chafa — it draws the sprite (${found[1]})`

  return platform === 'darwin'
    ? 'chafa — it draws the sprite, and needs Homebrew or MacPorts to install (https://brew.sh)'
    : 'chafa — it draws the sprite (https://hpjansson.org/chafa/download/)'
}
