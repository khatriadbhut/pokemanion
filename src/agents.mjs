// The coding agents this can attach itself to, and how to tell which you have.
//
// Claude Code and Codex have near-identical hook systems — same event names,
// same JSON on stdin, same field names, same "exit 2 and write to stderr to
// block a prompt". That is why `bin/on-activity.mjs` needed no changes at all
// to serve both: it reads `hook_event_name`, `session_id` and `prompt`, and
// both supply exactly those.
//
// What differs is only where the registration goes, and one event's name.
//
// Detection is on the binary, not the config directory. A directory proves
// somebody once ran something; the binary proves you can run it now. The
// machine this was written on has a ~/.codex directory and no codex installed,
// which would have produced hooks pointing at a program that is not there.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Claude calls it Notification, Codex calls it PermissionRequest. Both mean the
// same thing to us — the agent is waiting on you rather than working — and
// on-activity.mjs treats them identically.
export const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'SessionEnd']

export const AGENTS = [
  {
    name: 'claude',
    label: 'Claude Code',
    // Merged into a settings file that holds much more than hooks, so its own
    // entries have to be picked back out by hand on uninstall.
    file: () => join(homedir(), '.claude', 'settings.json'),
    shape: 'settings',
    waiting: 'Notification',
    dir: () => join(homedir(), '.claude'),
  },
  {
    name: 'codex',
    label: 'Codex',
    // A file of its own, whose entire contents are hooks.
    file: () => join(homedir(), '.codex', 'hooks.json'),
    shape: 'hooks-file',
    waiting: 'PermissionRequest',
    dir: () => join(homedir(), '.codex'),
  },
]

export const eventsFor = (agent) => [...HOOK_EVENTS, agent.waiting]

const onPath = (binary) => spawnSync('command', ['-v', binary], { shell: true, encoding: 'utf8' }).status === 0

export const isInstalled = (agent) => onPath(agent.name)

// Has a config directory but no binary — worth saying out loud, because it is
// the state that makes a directory check look like a working detector.
export const isStale = (agent) => !isInstalled(agent) && existsSync(agent.dir())

export const detected = () => AGENTS.filter(isInstalled)

// Other copies of this project already wired into an agent.
//
// A clone registers its hooks in the agent's own config; a plugin registers its
// own separately. Install both and both fire, each with its own state
// directory, and you get two Pokemon beside one session — which looks like a
// bug in the pane rather than like having installed the same thing twice.
//
// Read live rather than cached, so removing one is noticed the next time a hook
// runs rather than needing anything to be re-run.
export const otherInstalls = (ours) => {
  const roots = new Set()

  for (const agent of AGENTS) {
    let text = ''

    try {
      text = readFileSync(agent.file(), 'utf8')
    } catch {
      continue
    }

    // The command is a quoted path to bin/run.sh. Whatever sits before it is a
    // root, and any root that is not this one is another install.
    // Only installs that are still there. Deleting a clone by hand leaves its
    // hooks behind in the config, and counting those would have the plugin
    // stand down for something that no longer exists — leaving no pane at all,
    // which is worse than the two panes this whole check exists to prevent.
    for (const [, root] of text.matchAll(/"?([^"\s]+)\/bin\/run\.sh"?/g)) {
      if (root !== ours && existsSync(join(root, 'bin', 'run.sh'))) roots.add(root)
    }
  }

  return [...roots]
}

// The same question from the other side: is there a plugin copy of this?
//
// `otherInstalls` cannot answer it. A clone writes its hooks into the agent's
// settings, where they can be read back; a plugin's live in its own manifest
// under a variable the agent expands, so nothing about it appears where that
// function looks.
//
// It matters because of when each copy can speak. Hooks are read at startup, so
// a plugin installed into a running session has nothing running — which is why
// `/plugin install` says the plugin is active and then absolutely nothing
// happens, and why the message explaining that could only ever arrive after a
// restart. The clone is already running and can say it immediately.
//
// Returns the installed copies, newest first, as { root, version }.
export const pluginInstalls = () => {
  const found = new Map()

  // What the agent believes is installed, which is not the same as what is on
  // disk — the cache keeps old versions after an update.
  try {
    const text = readFileSync(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')
    const entries = JSON.parse(text).plugins ?? {}

    for (const [name, installs] of Object.entries(entries)) {
      if (!name.startsWith('pokemanion')) continue

      for (const install of [installs].flat()) {
        const root = install?.installPath

        if (!root || !existsSync(join(root, 'bin', 'run.sh'))) continue

        const at = Date.parse(install.lastUpdated ?? install.installedAt ?? '')

        found.set(root, [install.version ?? null, Number.isFinite(at) ? at : 0])
      }
    }
  } catch {}

  // Most recently installed first, and sorted rather than assumed.
  //
  // An update leaves the version it replaced listed alongside the new one — the
  // cache is stamped by version and the record keeps both — in whatever order
  // the file happens to hold them. Taking the first without sorting meant taking
  // whichever was written first, so a plugin that had just been updated was
  // reported as the version it had just replaced, and the notice meant to
  // announce the update decided it had already given it.
  //
  // By time rather than by version number, which would mean importing the
  // comparison from update.mjs and that imports shell.mjs, which imports this
  // file. The record already carries the answer, and "the one installed most
  // recently" is the more honest question anyway — a downgrade is still the
  // copy that is now in use.
  return [...found]
    .map(([root, [version, at]]) => ({ root, version, at }))
    .sort((a, b) => b.at - a.at)
}

// Is this copy still installed anywhere?
//
// Asked by the pane, about itself. A pane is a long-lived process and nothing
// tells it when its install goes away: `/plugin uninstall` is the agent's own
// command and never runs a line of ours, so the hooks vanish and the sprite goes
// on animating for a session nothing is watching any more. The same happens when
// a copy hands over, and when someone simply deletes the folder.
//
// Both kinds of registration count, because a copy can be either: a clone writes
// a path to its run.sh into the agent's settings, a plugin is listed by the
// agent's plugin record. Unreadable is not the same as absent — a settings file
// caught mid-write says nothing about whether we are installed — so anything
// unreadable answers yes and the question gets asked again later.
export const isRegistered = (root) => {
  if (!root) return true

  for (const agent of AGENTS) {
    let text = ''

    try {
      text = readFileSync(agent.file(), 'utf8')
    } catch {
      continue
    }

    if (text.includes(`${root}/bin/run.sh`)) return true
  }

  // A plugin is live only if both halves agree, because they answer different
  // questions and each is wrong on its own.
  //
  // `enabledPlugins` in a settings file is the switch: installing adds the name,
  // uninstalling takes it away. `installed_plugins.json` says which version's
  // folder is the current one, and it lags — after an uninstall it still listed
  // the plugin, which is how this check first came to tell a pane it was fine
  // while its plugin was being removed out from under it.
  //
  // Together they cover both ways a copy stops being the one in use: the whole
  // plugin uninstalled, and this particular version replaced by a newer folder.
  let switchedOn = null

  for (const file of [join(homedir(), '.claude', 'settings.json'), join(process.cwd(), '.claude', 'settings.json')]) {
    let enabled

    try {
      enabled = JSON.parse(readFileSync(file, 'utf8')).enabledPlugins
    } catch {
      continue
    }

    if (!enabled || typeof enabled !== 'object') continue

    for (const [name, on] of Object.entries(enabled)) {
      if (!name.startsWith('pokemanion')) continue

      switchedOn = switchedOn || on !== false
    }

    if (switchedOn === null) switchedOn = false
  }

  // Nothing readable said anything either way. Not evidence of removal.
  if (switchedOn === null) return true

  if (!switchedOn) return false

  try {
    const text = readFileSync(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')

    for (const [name, installs] of Object.entries(JSON.parse(text).plugins ?? {})) {
      if (!name.startsWith('pokemanion')) continue

      for (const install of [installs].flat()) if (install?.installPath === root) return true
    }
  } catch {
    // Switched on, and no record to say which folder — believe the switch.
    return true
  }

  return false
}

// `--claude` / `--codex` force a choice. Without one, whatever is installed.
export const chosen = (argv = process.argv) => {
  const asked = AGENTS.filter((agent) => argv.includes(`--${agent.name}`))

  return asked.length > 0 ? asked : detected()
}

export const byName = (name) => AGENTS.find((agent) => agent.name === name) ?? null
