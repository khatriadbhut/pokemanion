// The two kitty settings the pane needs, written into ~/.config/kitty/kitty.conf.
//
// The same job src/ghostty.mjs does for Ghostty, and it exists for the same
// reason that one does: a requirement that lives only in a README is a
// requirement nobody has met. Ghostty's resize keybind spent a long time being
// documented and unset, so the pane arrived at half the window height for
// everyone except the machine where it had been added by hand.
//
// kitty needs two things, and neither is on by default:
//
//   - **allow_remote_control** — `kitty @ launch` is a request over a socket,
//     and kitty refuses to listen for one unless told to. Without it the pane
//     never opens and kitty's own error talks about a socket, which reads as a
//     bug in this rather than a line missing from a config file.
//
//   - **enabled_layouts** must include `splits`. `--location=hsplit` is only
//     honoured by the splits layout; under the default `*` the first layout is
//     `fat` and the request is quietly ignored, so the pane opens as a whole
//     extra window on top of the session instead of a strip beside it. Quietly
//     is the problem — nothing fails, it is just wrong.
//
// `splits,stack` rather than replacing the list outright: stack is the one kitty
// users actually switch to (ctrl-shift-l cycles them), and taking it away to
// install a Pokemon would be rude.
//
// kitty reads its config at startup, so it takes a restart of kitty — not of the
// pane, and not of the agent.
//
// Usage: npm run kitty -- --install   (or --remove)

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const CONFIG = join(homedir(), '.config', 'kitty', 'kitty.conf')

const BEGIN = '# >>> pokemanion >>>'
const END = '# <<< pokemanion <<<'

export const SETTINGS = ['allow_remote_control yes', 'enabled_layouts splits,stack']

export const snippet = () =>
  `${BEGIN}
# The pane is opened with "kitty @ launch", which is a request over a socket:
# kitty does not listen for one unless allowed to. And --location=hsplit is only
# honoured by the splits layout, so it has to be in the list.
#
# Remove with: npm run kitty -- --remove
${SETTINGS.join('\n')}
${END}`

const readConfig = () => {
  try {
    return readFileSync(CONFIG, 'utf8')
  } catch {
    return ''
  }
}

// Already set, by us or by hand.
//
// Loosely matched on purpose, and more loosely than the Ghostty equivalent,
// because both of these have forms that are not the string we would write.
// `allow_remote_control` takes yes, socket-only or password; `enabled_layouts`
// is a list in any order with any amount of whitespace. Someone who has set
// either of them has made a decision about it, and writing a second declaration
// underneath — kitty takes the last one — would silently overrule it.
export const alreadySet = (text = readConfig()) => ({
  remote: /^\s*allow_remote_control\s+(yes|socket-only|password)\b/m.test(text),
  splits: /^\s*enabled_layouts\s+.*\bsplits\b/m.test(text) || /^\s*enabled_layouts\s+\*/m.test(text),
})

const withoutOurs = (text) => {
  const from = text.indexOf(BEGIN)

  if (from === -1) return text

  const to = text.indexOf(END, from)

  if (to === -1) return text

  return `${text.slice(0, from)}${text.slice(to + END.length)}`.replace(/\n{3,}/g, '\n\n')
}

export const install = () => {
  const text = readConfig()
  const set = alreadySet(withoutOurs(text))

  // Both already set by hand, and not by us. Left exactly as it is — it does
  // the job, and a second declaration of a setting kitty resolves last-wins is
  // the kind of thing someone finds a year later and cannot explain.
  if (set.remote && set.splits && !text.includes(BEGIN)) return 'already set'

  mkdirSync(dirname(CONFIG), { recursive: true })

  if (existsSync(CONFIG) && !existsSync(`${CONFIG}.pokemanion-backup`)) {
    copyFileSync(CONFIG, `${CONFIG}.pokemanion-backup`)
  }

  const body = withoutOurs(text).trimEnd()

  writeFileSync(CONFIG, `${body ? `${body}\n\n` : ''}${snippet()}\n`)

  return text.includes(BEGIN) ? 'updated' : 'added'
}

export const remove = () => {
  const text = readConfig()

  if (!text.includes(BEGIN)) return 'nothing of ours to remove'

  writeFileSync(CONFIG, `${withoutOurs(text).trimEnd()}\n`)

  return 'removed'
}

if (process.argv[1] && process.argv[1].endsWith('kitty.mjs')) {
  if (process.argv.includes('--remove')) {
    console.log(`\n  ${remove()} — ${CONFIG}\n  restart kitty\n`)
  } else if (process.argv.includes('--install')) {
    console.log(`\n  ${install()} — ${CONFIG}\n  restart kitty for it to take effect\n`)
  } else {
    const set = alreadySet()

    console.log(
      `\n  remote control: ${set.remote ? 'on' : 'off'}\n  splits layout:  ${set.splits ? 'available' : 'not enabled'}\n` +
        `${set.remote && set.splits ? '' : '\n  npm run kitty -- --install\n'}`,
    )
  }
}
