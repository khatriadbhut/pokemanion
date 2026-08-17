// Telling you a new version exists, and never installing it.
//
// Both install routes update with one command, and neither does it on its own.
// The gap that leaves is not the command — it is that nobody knows there is
// anything to run. So this checks, at most once a day, in a process that has
// already been let go of, and says so once per version.
//
// It deliberately stops there. Auto-updating a clone means running `git pull`
// inside someone's repository from a hook, which fails badly the moment they
// have edits of their own — and people are expected to have edits, since that is
// the whole reason to clone rather than install the plugin. Auto-updating a
// plugin means invoking the agent's own CLI from inside that agent's hook. Both
// trade a mild annoyance for a rare disaster.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ROOT, STATE_DIR } from './config.mjs'
import { isPluginRoot } from './shell.mjs'

const LATEST = join(STATE_DIR, 'latest-version')
const ANNOUNCED = join(STATE_DIR, 'announced-version')

// When we last *tried*, as opposed to when we last succeeded.
//
// The throttle used to be keyed on the answer, and the answer is only written
// when the fetch works — so a machine that was offline, or behind a proxy, or
// simply unlucky, was not throttled at all. It spawned a fresh curl on every
// hook: every prompt, every tool call, each one failing quietly. Nothing was
// ever slow, because none of it blocks, but a process per hook to ask a question
// that had just gone unanswered is not a reasonable thing to do to someone's
// laptop.
const TRIED = join(STATE_DIR, 'checked-at')

// Six hours rather than a day. The check is one detached curl with a five second
// cap and nothing waits on it, so the old interval was buying nothing and cost a
// day of not knowing. Bounded properly now that failures back off too.
const EVERY = 6 * 60 * 60 * 1000

const SOURCE = 'https://raw.githubusercontent.com/khatriadbhut/pokemanion/main/package.json'

export const installedVersion = () => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

// 1.10.0 is newer than 1.9.0, which string comparison gets backwards — the same
// trap the plugin path resolver has, and worth the six lines to avoid twice.
export const isNewer = (candidate, current) => {
  const parts = (text) => String(text ?? '').split('.').map((piece) => Number.parseInt(piece, 10) || 0)
  const [a, b] = [parts(candidate), parts(current)]

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }

  return false
}

const stamp = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// Detached, disowned, and given five seconds. The hook that starts this has
// exited long before curl answers, which is the point: a version check must
// never be a reason a prompt is slow, and offline must cost nothing at all.
export const checkInBackground = (now = Date.now()) => {
  const last = stamp(LATEST)

  if (last && now - (last.at ?? 0) < EVERY) return 'checked recently'

  // Both, because they answer different questions: the answer may be old and
  // still current, while an attempt that found nothing still counts as an
  // attempt. Asking only the first is what let a failing check run on every hook.
  const tried = stamp(TRIED)

  if (tried && now - (tried.at ?? 0) < EVERY) return 'tried recently'

  try {
    mkdirSync(STATE_DIR, { recursive: true })

    // Written before the fetch rather than after, so a check that never comes
    // back is still a check that happened.
    try {
      writeFileSync(TRIED, JSON.stringify({ at: now }))
    } catch {}

    // Written by the child rather than parsed here, so nothing waits on it.
    const script =
      `v=$(curl -fsS -m 5 ${JSON.stringify(SOURCE)} 2>/dev/null | ` +
      `sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -1); ` +
      `[ -n "$v" ] && printf '{"at":%s,"version":"%s"}' "${now}" "$v" > ${JSON.stringify(LATEST)}`

    const child = spawn('sh', ['-c', script], { detached: true, stdio: 'ignore' })

    child.unref()

    return 'started'
  } catch {
    return 'failed'
  }
}

// The version of another install, read off its own package.json.
export const versionAt = (root) => {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

// What to run, which depends on how it was installed — and telling a plugin user
// to `git pull` is how a helpful message becomes a confusing one.
export const updateCommand = (root = ROOT, { short = false } = {}) => {
  const home = homedir()
  const where = short && root.startsWith(home) ? `~${root.slice(home.length)}` : root

  // The pane gets no `cd`. A clone can live at any path, and CI's is long enough
  // that the card ran to five lines there while fitting in three on my machine —
  // the card would have overflowed onto the sprite for anyone whose clone sits
  // somewhere deep. You know where your own clone is; the message says it in
  // full.
  if (!isPluginRoot(root)) return short ? 'git pull && npm run setup' : `cd ${where} && git pull && npm run setup`

  // Codex takes two steps, and the pane has room for one. It gets the first —
  // the one that fetches — while the message, which has a whole chat window to
  // itself, carries both. A pane is a status display, not documentation.
  return root.includes('.codex')
    ? short
      ? 'codex plugin marketplace upgrade'
      : 'codex plugin marketplace upgrade && codex plugin add pokemanion@pokemanion'
    : '/plugin update pokemanion@pokemanion'
}

// Is there a newer one, regardless of whether it has been mentioned.
//
// `pendingUpdate` goes quiet once the message has been shown, which is right for
// a message and wrong for the pane: the pane is a status display, and a version
// you are behind on stays true after you have been told once.
export const available = () => {
  const current = installedVersion()
  const latest = stamp(LATEST)?.version

  return current && latest && isNewer(latest, current) ? latest : null
}

// A version worth mentioning: newer than this one, and not already mentioned.
export const pendingUpdate = () => {
  const current = installedVersion()
  const latest = stamp(LATEST)?.version

  if (!current || !latest || !isNewer(latest, current)) return null

  if (stamp(ANNOUNCED)?.version === latest) return null

  return { current, latest, command: updateCommand() }
}

export const markAnnounced = (version) => {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(ANNOUNCED, JSON.stringify({ version }))
  } catch {}
}

// Both halves from the same root. They used to disagree: the command was derived
// from the root passed in and the restart line from whatever this process
// happened to be, so a message built for one install could carry the other's
// advice. Harmless in production, where they are always the same root — which is
// exactly the kind of thing that is wrong for months without showing.
// The longest thing that fits, given the room there actually is.
//
// The pane is a horizontal split, so its width is the terminal's — a hundred
// columns and more, not the thirty-eight a separate window would get. Wide
// enough for what Claude Code prints on its own update line, which is the whole
// command. Narrow panes still get something true, just shorter.
export const cornerText = (current, latest, width, root = ROOT) => {
  if (!latest) return `v${current}`

  const forms = [
    `pokemanion v${latest} available — run: ${updateCommand(root)}`,
    `v${latest} available — ${updateCommand(root, { short: true })}`,
    `v${latest} available — --pokemanion to update`,
    `v${latest} available`,
    `v${current}`,
  ]

  return forms.find((form) => form.length <= width) ?? `v${current}`
}

export const notice = ({ current, latest, command }, root = ROOT) =>
  `pokemanion v${latest} is out — you have v${current}\n\n  ${command}\n` +
  `${isPluginRoot(root) ? '  then restart the agent\n' : ''}`

// Reading it by hand: npm run update-check
if (process.argv[1] && process.argv[1].endsWith('update.mjs')) {
  console.log(`\n  installed: ${installedVersion()}`)
  console.log(`  latest seen: ${stamp(LATEST)?.version ?? 'not checked yet'}`)
  console.log(`  check: ${checkInBackground(Date.now())}`)
  console.log(`  update with: ${updateCommand()}\n`)
}
