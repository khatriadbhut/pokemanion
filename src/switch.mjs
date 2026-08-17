// Changing Pokemon without leaving Claude.
//
// `claude --pikachu` only works at the moment you start Claude, because it is
// the shell function that lifts the flag out and the real binary never sees it.
// Once you are inside a session the same words are just text, and there is
// nowhere for them to go.
//
// So the UserPromptSubmit hook reads them. A prompt that is nothing but
// `--pikachu` is treated as an instruction to the pane rather than a message to
// Claude: the species is written to the claim file the pane already watches, and
// the prompt is blocked so it never reaches the model and never costs a turn.
//
// Only a prompt that is *entirely* the flag counts. Asking Claude about
// `--pikachu` in a sentence is a real question and has to stay one.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'
import { allNames, available, resolveName } from './roster.mjs'

// `--pokemon` and its plural list; `--<name>` switches. Anything else that
// looks like a bare flag is a typo worth answering, since the alternative is
// silently sending "--pikchu" to Claude as a prompt.
//
// `pool` is only the residents. Any of the twelve hundred names the sprite
// folder has is accepted too — they are simply fetched on the way in — so the
// check is against every known name rather than against what is on disk.
export const parse = (prompt, pool = available()) => {
  const text = String(prompt ?? '').trim()

  // The one command that takes an argument, so it is matched before the
  // single-word forms. `--dex` alone is the summary; `--dex fire` searches.
  const dex = text.match(/^--dex(?:\s+(.+))?$/i)

  // The argument is taken exactly as typed. `--dex --current` is a miss, not a
  // silent correction: one way to write a command is easier to remember than
  // one way plus a set of things that happen to also work. The miss is where
  // the help goes — see `suggest` below, which is what turns it from a dead end
  // into a pointer.
  if (dex) return { kind: 'dex', query: (dex[1] ?? '').trim() }

  // The two `--pokemanion <verb>` commands, which take a word after them and so
  // cannot go through the bare-flag match below.
  const adding = text.match(/^--pokemanion\s+add(?:\s+([a-z][a-z0-9-]*))?$/i)

  if (adding) return { kind: 'add', name: adding[1] ?? null }

  // Only meaningful where two installs exist, and answered by the one standing
  // down.
  if (/^--pokemanion\s+use\s+plugin$/i.test(text)) return { kind: 'use-plugin' }

  const match = text.match(/^--([a-z][a-z0-9.:-]*)$/i)

  if (!match) return null

  const word = match[1].toLowerCase()

  if (word === 'pokemon' || word === 'pokemons') return { kind: 'list' }



  // Named after the project, not after what it does.
  //
  // It was `--update`, which is a generic verb this has no business claiming: a
  // hook that answers it blocks the prompt, so asking Claude to update anything
  // else — a dependency, a branch, the repo you are actually in — would have been
  // caught here and answered with a version number. Every other flag is a
  // Pokemon and could never be meant for something else.
  if (word === 'pokemanion') return { kind: 'update' }

  // Resolved to an actual name by the caller, not here, so that parsing stays
  // a pure reading of the text and the dice are rolled once.
  if (word === 'random') return { kind: 'random' }

  if (pool.includes(word)) return { kind: 'switch', name: word }

  const resolved = resolveName(word)

  if (resolved) return { kind: 'switch', name: resolved, guest: true }

  return { kind: 'unknown', word }
}

// Real Pokemon that this cannot show, and the reason they are missing.
//
// The sprites are Gen 5 animations, and Gen 5 ended at #649. Everything after
// it exists only where an artist went back and drew it in that style, which
// they did for most of Gen 6 and 7 and much less of Gen 8 and 9. So `--urshifu`
// is not a typo — it is a correctly spelled Pokemon that was never drawn.
//
// Without this list the two are indistinguishable, because the bundled dex only
// contains what has a sprite: a name that is missing from it is missing whether
// it is a Pokemon or nonsense. 159 names is a small price for telling someone
// they spelled it right.
//
// Generated once by diffing the national dex (PokeAPI's species list, 1025
// entries) against the names this project can resolve. If a new sprite set ever
// lands, that diff is how to rebuild it — there is no script, because it is a
// thing that happens roughly never.
const UNREGISTERED = JSON.parse(readFileSync(join(ROOT, 'assets', 'no-gen5-sprite.json'), 'utf8'))

const UNREGISTERED_BY_NAME = new Map(UNREGISTERED.map((row) => [row.n, row]))

export const unregistered = (word) => {
  const key = String(word ?? '').trim().toLowerCase()

  if (!key) return null

  // Their names carry hyphens the way ours do not, so try both spellings.
  const row = UNREGISTERED_BY_NAME.get(key) ?? UNREGISTERED.find((entry) => entry.n.replace(/[^a-z0-9]/g, '') === key.replace(/[^a-z0-9]/g, ''))

  if (!row) return null

  return { name: row.n, num: row.d, title: row.n.replace(/(^|-)([a-z])/g, (_, dash, letter) => (dash ? '-' : '') + letter.toUpperCase()) }
}

// The closest real name to something that matched nothing.
//
// Levenshtein, capped. The cap is what keeps this from being annoying: over
// fourteen hundred names, *something* is always within four edits of anything
// you type, and a confident wrong guess is worse than no guess. One edit for
// short names, two for longer ones, and never more than a third of the word —
// so `pikchu` finds Pikachu and `--resume` finds nothing at all, which matters
// because the shell wrapper hands unknown flags to Claude and must not start
// second-guessing `--resume`.
const distance = (a, b, cap) => {
  if (Math.abs(a.length - b.length) > cap) return cap + 1

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let best = i

    for (let j = 1; j <= b.length; j++) {
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )

      current[j] = value
      best = Math.min(best, value)
    }

    // Every path through this row already costs more than the cap allows.
    if (best > cap) return cap + 1

    previous = current
  }

  return previous[b.length]
}

export const nearest = (word, { pool = null, maxEdits = 2 } = {}) => {
  const key = String(word ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')

  if (key.length < 3) return null

  const cap = Math.min(key.length <= 5 ? 1 : maxEdits, Math.floor(key.length / 3), maxEdits)

  if (cap < 1) return null

  const candidates = pool ?? [...allNames(), ...UNREGISTERED.map((row) => row.n)]
  const residents = new Set(available())

  let best = null
  let bestAt = cap + 1

  for (const name of candidates) {
    const flat = name.replace(/[^a-z0-9]/g, '')

    if (flat === key) return name

    const at = distance(key, flat, cap)

    // Ties broken towards a resident. `pikchu` is one edit from both Pichu and
    // Pikachu, and whichever the list reaches first is not an argument — the one
    // sitting in the pane every day is the better guess.
    if (at < bestAt || (at === bestAt && residents.has(name) && !residents.has(best))) {
      bestAt = at
      best = name
    }
  }

  if (bestAt <= cap) return best

  // Second pass: letters dropped rather than mistyped.
  //
  // `charzd` is three edits from `charizard`, so no cap loose enough to catch it
  // is tight enough to be safe. But every letter of it appears in `charizard`,
  // in order — that is what typing fast and missing keys looks like, and it is a
  // far more specific signal than distance. Levenshtein says charzd is as close
  // to a dozen other names; subsequence says it is charizard and nothing else.
  //
  // Guarded three ways, because a short subsequence matches half the dex: it
  // must start with the same letter, be at least four characters, and account
  // for more than half the name. Checked against Claude's own flags — all 22
  // stay silent, `--version` included, which is why this can be used outside
  // where a false positive would talk over a real command.
  if (key.length < 4) return null

  const covers = (typed, name) => {
    let i = 0

    for (const letter of name) if (letter === typed[i]) i++

    return i === typed.length
  }

  let loose = null

  for (const name of candidates) {
    const flat = name.replace(/[^a-z0-9]/g, '')

    if (flat[0] !== key[0] || key.length < flat.length * 0.55 || !covers(key, flat)) continue

    if (!loose || (residents.has(name) && !residents.has(loose)) || (!residents.has(loose) && flat.length < loose.replace(/[^a-z0-9]/g, '').length)) {
      loose = name
    }
  }

  return loose
}

// What the user probably meant, when `--dex <something>` matched nothing.
//
// The command is strict on purpose — one spelling is easier to remember than
// one spelling plus a set of near-misses that happen to work — so the help has
// to live in the failure. `--dex --current` is the case that prompted this:
// every other command here is `--something`, so the dash is a habit, and
// `nothing matches "--current"` reads as a broken command rather than a typo.
//
// Returns null when there is nothing useful to say, so the caller can leave the
// plain miss alone rather than pad it with a guess.
export const suggest = (query, pool = available()) => {
  const text = String(query ?? '').trim()

  if (!text) return null

  // Worth suggesting only if the corrected form actually leads somewhere.
  // Pointing at a second miss is worse than saying nothing.
  const leadsSomewhere = (value) => {
    const word = value.toLowerCase()

    return word === 'current' || word === 'random' || pool.includes(word) || Boolean(resolveName(word)) || /^\d+$/.test(word)
  }

  // Already a valid query. Whatever went wrong is not the spelling, so there is
  // nothing to correct — `--dex current` with no pane claimed lands here.
  //
  // Leading dashes disqualify it from being "already valid" even though
  // `resolveName` would happily strip them: `--dex --pikachu` did not match, and
  // pointing at `--dex pikachu` is the entire job.
  if (!text.startsWith('-') && leadsSomewhere(text)) return null

  // Only leading dashes are ever a mistake. A trailing one is real syntax —
  // `--dex pikachu-` asks for every Pikachu form — so it is left on.
  const stripped = text.replace(/^-+/, '')

  if (stripped && stripped !== text && leadsSomewhere(stripped)) return `--dex ${stripped}`

  // Not a dash problem, then — a spelling one. `--dex pikchu` should land in
  // the same place `--pikchu` does.
  const close = nearest(stripped)

  return close ? `--dex ${close}` : null
}

// Written to stderr, which is what Claude Code shows when a hook blocks a
// prompt. Kept short: it lands in the transcript where the message would have.
export const describe = (result, pool = available(), current = null, extra = 0) => {
  if (result.kind === 'switch') {
    // A rolled one says what it rolled. "flygon it is" after asking for a
    // surprise tells you the name but not that it was a surprise, nor what the
    // thing actually is.
    if (result.rolled) return `rolled ${result.rolled}\n\n${result.name} it is`

    return result.name === current ? `${result.name} already` : `${result.name} it is`
  }

  const list = pool.map((name) => (name === current ? `${name} (current)` : name)).join('  ')

  // The residents are worth listing; the twelve hundred guests are not. Saying
  // how many there are, and that any of them can be named, is the useful part.
  const rest = extra > 0 ? `\n\n...or name any of ${extra} others — they are fetched on the spot` : ''

  if (result.kind === 'list') return `${list}\n\ntype --<name> to switch${rest}`

  // A real Pokemon that simply has no sprite reads as a typo otherwise, and it
  // is the opposite: you spelled it correctly and it does not exist *here*.
  // The Pokedex has a word for that, so it may as well use it.
  const known = unregistered(result.word)

  if (known) {
    return (
      `${known.title} — #${known.num}, no data\n\n` +
      `Gen 5 ended at #649 and nothing after it was ever drawn in this style. ` +
      `${UNREGISTERED.length} species are missing for that reason.\n\n${list}${rest}`
    )
  }

  // Reaching here with nothing to name means a command nobody handled, not a
  // Pokemon nobody has heard of. `--pokemanion use plugin` did exactly that on
  // the copy with no branch for it, and what came back was "no such one:
  // undefined" above a list of Pokemon — which blames the person typing for a
  // gap in here.
  if (!result.word) return `nothing here handles that\n\n${list}${rest}`

  const close = nearest(result.word)

  if (close) return `no such one: ${result.word}\n\ndid you mean: --${close}\n\n${list}${rest}`

  return `no such one: ${result.word}\n\n${list}${rest}`
}
