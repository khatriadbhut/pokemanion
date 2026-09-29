// How this terminal wants to be given a picture.
//
// The sprite was always a kitty-graphics image, which is why the requirements
// table had a column of "no" down it: a terminal that does not speak that
// protocol drew nothing at all. But the image is produced by chafa, and chafa
// has four output formats — three real pixel protocols and one that is just
// coloured characters. The last of those works in anything that can print a
// Unicode block, which is every terminal on both platforms.
//
// So the question stopped being "does this terminal support the protocol" and
// became "which of the four does it want", and there is always an answer.
//
//   kitty    the best: pixels, and place.mjs can send a frame once and then
//            refer to it by id, which is the difference between 0.02MB and
//            35.9MB for four hundred draws
//   iterm    pixels, one inline image per frame
//   sixels   pixels, one per frame, and the oldest of the three
//   symbols  no pixels — half-blocks and octants in truecolor. Smaller, and it
//            is what Terminal.app, Alacritty and GNOME Terminal get instead of
//            nothing
//
// Two ways of finding out, and both are needed:
//
//   - **Ask the terminal.** The pane has a tty, so it can send the kitty
//     graphics query and a Primary Device Attributes request together and read
//     what comes back. This is the one that is right about terminals nobody
//     has heard of, and about a terminal that gains support in a later version.
//
//   - **Guess from the environment.** `npm run warm` renders every sprite ahead
//     of time with no tty at all, and a probe that cannot run has to fall back
//     to something rather than to nothing. It is also the answer while the
//     probe is still in flight.
//
// The probe wins when it runs, and what it learns is written down, so the guess
// is only ever load-bearing once per terminal.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from './config.mjs'

// In preference order, which is also quality order for the first three. A
// terminal that can do more than one gets the best it can do.
export const FORMATS = ['kitty', 'iterm', 'sixels', 'symbols']

// The two questions, asked in one write.
//
// The kitty query is an APC sequence asking the terminal to acknowledge a
// one-pixel image it should then forget. A terminal that speaks the protocol
// answers `\x1b_Gi=31;OK\x1b\\`; one that does not is supposed to ignore an APC
// it does not recognise, which every terminal tested does.
//
// That "supposed to" is the reason DA1 is sent immediately after it. Primary
// Device Attributes is answered by everything, going back to the VT100, so it
// is the fence: once the DA1 reply arrives, any kitty reply that was coming has
// already come. Without it there is nothing to wait *for* on a terminal with no
// kitty support, and the probe could only ever time out — a delay paid at the
// start of every pane on exactly the terminals that are slowest already.
//
// DA1's own reply carries the sixel answer. `\x1b[?62;1;4;...c` — a `4` among
// those parameters means sixel graphics.
const KITTY_QUERY = '\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\'
const DA1_QUERY = '\x1b[c'

export const QUERY = `${KITTY_QUERY}${DA1_QUERY}`

// What a reply says, as a pure function of the bytes.
//
// Split out so the parsing can be tested against captured replies from real
// terminals rather than against whatever this machine answers — the whole
// point is the terminals this machine is not.
export const readReply = (reply) => ({
  // The id is ours and is echoed back, so a stray APC from something else in
  // the scrollback cannot be mistaken for an answer.
  kitty: /\x1b_Gi=31;OK/.test(reply),

  // Only the parameters of the DA1 reply, and only as whole numbers: a naive
  // search for "4" matches the 4 in "64" and reports sixel support on a VT420
  // that has none.
  sixel: (() => {
    const da1 = /\x1b\[\?([0-9;]*)c/.exec(reply)

    return da1 ? da1[1].split(';').includes('4') : false
  })(),
})

// Ask, and wait no longer than it takes.
//
// Raw mode, because the reply is not a line and nothing is going to press
// return. Restored in a finally: leaving a terminal in raw mode is how a shell
// stops echoing what you type, and this runs inside a pane that may exit for
// any number of reasons.
//
// The timeout is a ceiling, not a wait. Every terminal tested answered DA1 in
// under 15ms; the ceiling only matters for one that answers nothing at all,
// and there the cost is paid once and written down.
export const probe = async ({ input = process.stdin, output = process.stdout, timeoutMs = 300 } = {}) => {
  if (!input.isTTY || !output.isTTY) return null

  const wasRaw = input.isRaw

  return new Promise((resolve) => {
    let reply = ''
    let done = false

    const finish = (value) => {
      if (done) return
      done = true

      clearTimeout(timer)
      input.off('data', onData)

      try {
        if (!wasRaw) input.setRawMode(false)
      } catch {}

      // Paused rather than left flowing. The pane does not read stdin for any
      // other reason, and a resumed stdin keeps the process alive.
      try {
        input.pause()
      } catch {}

      resolve(value)
    }

    const onData = (chunk) => {
      reply += chunk.toString('latin1')

      // The DA1 reply is the fence, so its arrival is the end of the answer —
      // there is nothing further to wait for and no reason to spend the rest
      // of the timeout.
      if (/\x1b\[\?[0-9;]*c/.test(reply)) finish(readReply(reply))
    }

    const timer = setTimeout(() => finish(reply ? readReply(reply) : null), timeoutMs)

    try {
      input.setRawMode(true)
      input.resume()
      input.on('data', onData)
      output.write(QUERY)
    } catch {
      finish(null)
    }
  })
}

// What to use when nobody has asked the terminal.
//
// Named on purpose rather than inferred from a general capability database:
// this is a list of things known to be true, and being wrong here is cheap —
// the probe overrules it the moment a pane with a tty starts.
//
// $TERM_PROGRAM is set by the terminal's own shell integration and is the most
// reliable of the three; $TERM is the terminfo name and survives when shell
// integration does not; the rest are variables a terminal exports about itself.
export const guessFormat = (env = process.env) => {
  const program = String(env.TERM_PROGRAM ?? '').toLowerCase()
  const term = String(env.TERM ?? '').toLowerCase()

  // The kitty protocol, in the four that implement it.
  //
  // $TERM and $TERM_PROGRAM only, and $GHOSTTY_RESOURCES_DIR deliberately not —
  // it was here, and it was wrong. Ghostty exports it into the environment, and
  // an exported variable is inherited by everything started from that shell: it
  // was still set inside a Terminal.app opened later, so this guessed kitty for
  // a terminal that cannot draw a pixel. $TERM is set per terminal by its own
  // terminfo and does not leak, which is the property that matters here.
  //
  // Found by running the probe inside Terminal.app and reading the environment
  // back, which is the only way it was ever going to show up: on the machine
  // this was written on, the wrong answer and the right one agreed.
  if (program === 'ghostty' || term === 'xterm-ghostty') return 'kitty'
  if (env.KITTY_WINDOW_ID || term.startsWith('xterm-kitty')) return 'kitty'
  if (program === 'wezterm' || env.WEZTERM_PANE) return 'kitty'
  if (program === 'rio' || term.startsWith('rio')) return 'kitty'

  // iTerm2's own inline-image protocol. $LC_TERMINAL is the one that survives
  // ssh, because iTerm2 sends it through as a locale variable.
  if (program === 'iterm.app' || env.LC_TERMINAL === 'iTerm2') return 'iterm'

  // Sixel, in terminals that have it and nothing better.
  if (/foot|contour|mlterm|yaft/.test(term) || program === 'contour') return 'sixels'
  if (env.KONSOLE_VERSION) return 'sixels'

  // Everything else, which is the point of this file. Terminal.app, Alacritty,
  // GNOME Terminal, xterm without sixel, a tmux nobody has configured, an ssh
  // session into something unnamed — all of them draw the sprite now, in
  // coloured blocks rather than pixels.
  return 'symbols'
}

// Whether a sixel written here would actually reach a screen.
//
// Outside tmux, DA1 is answered by the terminal, so `caps.sixel` is the
// terminal's own answer and there is nothing to second-guess.
//
// Inside tmux it is answered by *tmux*, and tmux reports what tmux was built
// with rather than what the terminal on the other end can show. Every tmux
// since 3.4 is built with sixel support, so the reply says sixel no matter what
// it is attached to — and the pane believed it. Attached to Ghostty or
// Terminal.app or xterm, none of which have sixel, tmux received an image it
// could not pass on and drew its placeholder instead: the literal text
// `SIXEL IMAGE (33x16)` and rows of `+` where the Pokemon should be. Seen in
// Ghostty, which is the setup everything else here is tested against.
//
// tmux knows the difference and will say so. `client_termfeatures` is its own
// account of what the attached terminal can do, and `sixel` appears in it only
// when the terminal really has it — absent for Ghostty and Terminal.app,
// present for WezTerm and foot.
//
// Unknown counts as no. The cost of guessing wrong in that direction is blocks
// instead of pixels; the cost in the other direction is no sprite at all.
export const sixelReachesTheScreen = (env = process.env) => {
  if (!env.TMUX) return true

  try {
    // `env` is passed through rather than left to default, so that asking about
    // a given environment asks tmux about *that* one — the suite hands it a
    // TMUX that points at no server and gets the same answer every time,
    // including when the suite itself is being run inside tmux.
    const asked = spawnSync('tmux', ['display', '-p', '#{client_termfeatures}'], {
      encoding: 'utf8',
      timeout: 1000,
      env,
    })

    if (asked.status !== 0 || typeof asked.stdout !== 'string') return false

    return asked.stdout
      .trim()
      .split(',')
      .map((feature) => feature.trim())
      .includes('sixel')
  } catch {
    return false
  }
}

// The probe's answer, as a format.
export const formatFromCaps = (caps, env = process.env) => {
  if (!caps) return guessFormat(env)

  if (caps.kitty) return 'kitty'

  // iTerm2 cannot be probed — it answers no query about inline images — so the
  // environment is the only evidence either way, and it is good evidence: the
  // variable is set by iTerm2 itself.
  const guess = guessFormat(env)

  if (guess === 'iterm') return 'iterm'

  if (caps.sixel && sixelReachesTheScreen(env)) return 'sixels'

  return 'symbols'
}

// Where a probed answer is kept.
//
// Per terminal rather than one global file, because a machine runs several and
// the answer differs: this one has Ghostty, WezTerm, kitty, iTerm2 and
// Terminal.app on it, and caching one answer across all five would mean four of
// them drawing in the wrong format until something cleared it.
const identity = (env = process.env) =>
  (env.TERM_PROGRAM || env.TERM || 'unknown').toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 40)

const recordFile = (env = process.env) => join(STATE_DIR, `graphics-${identity(env)}.json`)

// Cached rather than re-probed, because the pane is not the only thing that
// needs the answer: `npm run warm` renders every sprite ahead of time with no
// tty, and it has to render them in the format the pane is going to ask for or
// the cache it fills is one nobody reads.
export const remembered = (env = process.env) => {
  try {
    const saved = JSON.parse(readFileSync(recordFile(env), 'utf8'))

    return FORMATS.includes(saved.format) ? saved.format : null
  } catch {
    return null
  }
}

export const remember = (format, env = process.env) => {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(recordFile(env), JSON.stringify({ format, at: Date.now() }))
  } catch {}
}

// The answer, without asking: an override, then what was learnt last time, then
// the guess. This is what everything except the pane itself uses.
//
// The override is first and is a plain config key rather than a debug flag,
// because "my terminal claims kitty support and renders it wrong" is a real
// report with no other remedy — and because it is the only way to see the other
// formats on a terminal that supports the best one.
export const currentFormat = (config = {}, env = process.env) => {
  if (FORMATS.includes(config.graphicsFormat)) return config.graphicsFormat

  return remembered(env) ?? guessFormat(env)
}

// Asked once by the pane, which is the only thing with a tty to ask on.
export const detectFormat = async (config = {}, env = process.env, options = {}) => {
  if (FORMATS.includes(config.graphicsFormat)) return config.graphicsFormat

  const caps = await probe(options)

  if (!caps) return remembered(env) ?? guessFormat(env)

  const format = formatFromCaps(caps, env)

  remember(format, env)

  return format
}

// Which chafa this is, because the symbol set depends on it.
//
// Asked once and remembered: it is a process launch, and the sprite renderer
// would otherwise pay it per frame.
let seenVersion

export const chafaVersion = (ask = () => spawnSync('chafa', ['--version'], { encoding: 'utf8' }).stdout) => {
  if (seenVersion !== undefined) return seenVersion

  const found = /(\d+)\.(\d+)\.(\d+)/.exec(ask() ?? '')

  seenVersion = found ? [Number(found[1]), Number(found[2]), Number(found[3])] : null

  return seenVersion
}

// The symbol set to draw blocks with, and the reason this is a function rather
// than the config key being passed through.
//
// Two separate things can make the wrong choice here produce a pane full of
// rectangles, and both were found by rendering a Pikachu in xterm on Linux and
// looking at the screenshot.
//
//   - **chafa has to know the tag.** `octant` is the finest of them — Unicode 16
//     octants divide a cell into eight where sextants manage six — and chafa
//     only learned it in 1.16. Debian's current stable ships 1.14.5, which
//     answers "Unrecognized symbol tag 'octant'" and exits 1. chafa exiting is
//     the sprite renderer exiting: the pane opened, died instantly, and the
//     window closed with it.
//
//   - **The font has to have the characters**, and this is the one that decides
//     the default. Asking fontconfig which fonts cover what, on a Debian with
//     the usual packages:
//
//       U+2580 half blocks, U+2596 quadrants   DejaVu Sans Mono
//       U+1FB00 sextants, U+1CD00 octants      Unifont Upper, and nothing else
//
//     DejaVu Sans Mono is the default monospace font on most Linux desktops.
//     Unifont Upper is a fallback package that most systems do not install. So
//     sextants and octants are a coin flip on the exact machines that end up in
//     symbols mode in the first place — the plain terminals, which tend to have
//     plain fonts — and a missing glyph is a row of tofu, which is worse than
//     the coarser picture it was trying to improve on.
//
// So the default is `block`: half blocks and quadrants, in Unicode since 1993,
// present in every monospace font anyone has. Coarser, and it is a Pokemon
// rather than a row of rectangles.
//
// Anything named explicitly is honoured, because someone who set it has looked
// at their own font. `octant` still steps down to `sextant` on a chafa too old
// to know it, which is the difference between a coarser sprite and no pane.
export const symbolsFor = (config = {}, version = chafaVersion()) => {
  // `paneSymbols` and not `chafaSymbols`: that one is the statusline renderer's,
  // read by src/build.mjs, and it is set to octant for a job where the font is
  // the one this machine already draws the prompt in. The pane draws in a
  // terminal that may be somewhere else entirely.
  const want = config.paneSymbols ?? 'block'

  if (want !== 'octant') return want

  if (!version) return 'sextant'

  return version[0] > 1 || (version[0] === 1 && version[1] >= 16) ? 'octant' : 'sextant'
}

// Whether to wrap each frame in a multiplexer's passthrough envelope, which is
// how an escape sequence reaches the terminal *outside* tmux instead of tmux
// itself.
//
// The first version of this turned it on whenever $TMUX was set, on the
// reasoning that tmux swallows graphics. Testing inside a real tmux showed that
// is the wrong rule, and why: the probe asks whoever answers, and inside tmux
// the thing that answers is tmux. tmux 3.4 and later render sixels themselves
// and say so in their DA1 reply — so the pane correctly chose sixels, and
// wrapping them for passthrough would have sent them straight past the one
// program that was going to draw them.
//
// The principle that replaced it: **the thing that answered the query is the
// thing that draws.** A probed format is always sent plainly, because whoever
// claimed the capability is who receives it. An older tmux that claims nothing
// gets symbols, which need no passthrough either — they are ordinary text.
//
// That leaves exactly one case where passthrough is right, and it is the case
// it is now limited to: someone who has forced `graphicsFormat` in config
// precisely because they want to bypass the multiplexer and reach the terminal
// behind it — a kitty-inside-tmux who wants real kitty graphics. There the
// override is the statement of intent, and this is the other half of it.
export const passthroughFor = (config = {}, env = process.env) => {
  if (!FORMATS.includes(config.graphicsFormat)) return 'none'

  if (env.TMUX) return 'tmux'
  if (/^screen(\.|$)/.test(String(env.TERM ?? '')) && env.STY) return 'screen'

  return 'none'
}

// How many colours to ask chafa for.
//
// It normally works this out from the terminal it is writing to, and it cannot
// here: the output is a pipe into the frame cache, so chafa sees no terminal
// and falls back to a conservative default. That default is 16 colours, which
// turns a sprite into mud — and it only shows up in symbols mode, because the
// pixel formats carry their own colour.
export const coloursFor = (env = process.env) => {
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 'full'
  if (/-256color/.test(String(env.TERM ?? ''))) return '256'

  return '256'
}

// Ask this terminal, from this terminal, and say what came back.
//
// `npm run doctor` cannot do this properly: it reports the format but is
// usually run somewhere its stdin is not a tty, so it falls back to the guess
// and says so. This is the command that actually asks — run it in the terminal
// you are asking about.
//
// Usage: npm run graphics
if (process.argv[1] && process.argv[1].endsWith('graphics.mjs')) {
  const { loadConfig } = await import('./config.mjs')
  const config = loadConfig()

  const DIM = '\x1b[2m'
  const BOLD = '\x1b[1m'
  const RESET = '\x1b[0m'

  const caps = await probe()

  console.log()

  if (config.graphicsFormat) {
    console.log(`  ${BOLD}${config.graphicsFormat}${RESET}${DIM} — forced by graphicsFormat in config.json${RESET}`)
    console.log(`  ${DIM}remove that key to let the terminal decide${RESET}`)
  } else if (!caps) {
    console.log(`  ${BOLD}${guessFormat()}${RESET}${DIM} — guessed. this is not a terminal, so nothing could be asked${RESET}`)
    console.log(`  ${DIM}run it in the terminal you want to know about${RESET}`)
  } else {
    console.log(`  ${BOLD}${formatFromCaps(caps)}${RESET}${DIM} — the terminal was asked${RESET}`)
    console.log()
    console.log(`  ${DIM}kitty graphics${RESET}  ${caps.kitty ? 'yes' : 'no'}`)
    console.log(`  ${DIM}sixel${RESET}           ${caps.sixel ? 'yes' : 'no'}`)
    console.log(`  ${DIM}guess would be${RESET}  ${guessFormat()}`)
  }

  console.log()
  console.log(`  ${DIM}force one with "graphicsFormat" in config.json: ${FORMATS.join(', ')}${RESET}`)
  console.log()
}
