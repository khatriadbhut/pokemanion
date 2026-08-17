// Throwing guests out.
//
// Residents — the roster — are pinned: hand-tuned, always on disk, pre-rendered
// so a session starts instantly. Guests are every other Pokemon the sprite
// folder has, fetched the first time they are asked for. There are over twelve
// hundred of them, and keeping them all would cost about 2.7GB of frame cache,
// so they have to leave when the space is wanted.
//
// Least recently shown goes first, which is the only ordering that matches how
// they are actually used: a Pokemon summoned once out of curiosity should go
// before one summoned every day.
//
// Two things get deleted per guest, and both matter. The sprites are small; the
// rendered frames are not — one Pokemon is about 3MB of escape sequences at a
// four-row pane, which is where all the weight is.
//
// Usage: npm run prune [-- --dry]

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE_VERSION, ROOT, STATE_DIR, loadConfig } from './config.mjs'
import { POKEMON_DIR, busyFile, forget, guestsByAge, idleFile, isGuest } from './roster.mjs'
import { speciesInUse } from './companion.mjs'

const CACHE_DIR = join(STATE_DIR, 'cache')

const sizeOf = (path) => {
  try {
    const stat = statSync(path)

    if (!stat.isDirectory()) return stat.size

    return readdirSync(path).reduce((total, child) => total + sizeOf(join(path, child)), 0)
  } catch {
    return 0
  }
}

// Which cache entries belong to which sprite file. The cache is keyed by a hash
// of the file path and its size, so the mapping is not recoverable from the
// name — every entry records the sprite it was rendered from instead.
const cacheBySprite = () => {
  const map = new Map()

  if (!existsSync(CACHE_DIR)) return map

  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith('.json')) continue

    const path = join(CACHE_DIR, file)

    let entry

    try {
      entry = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      continue
    }

    // Written by an older version of the renderer, so its key can never be
    // computed again and it can never be hit. Marked with a name nothing owns,
    // which puts it straight in the orphan sweep below.
    const from = entry.v === CACHE_VERSION ? entry.name : '\u0000stale'

    if (!from) continue

    if (!map.has(from)) map.set(from, [])

    map.get(from).push(path)
  }

  return map
}

export const guestCost = (name) => {
  const cache = cacheBySprite()
  const files = [idleFile(name), busyFile(name)].flatMap((sprite) => cache.get(sprite) ?? [])

  return sizeOf(join(POKEMON_DIR, name)) + files.reduce((total, file) => total + sizeOf(file), 0)
}

// Cache entries whose sprite no longer exists can never be hit again. They are
// swept whether or not anything is being evicted, because a roster edit orphans
// them too — the 42MB left behind by one such change is what prompted this.
export const sweepOrphans = (dry = false) => {
  let freed = 0
  let count = 0

  for (const [sprite, files] of cacheBySprite()) {
    const path = sprite.startsWith('/') ? sprite : join(ROOT, sprite)

    if (existsSync(path)) continue

    for (const file of files) {
      freed += sizeOf(file)
      count++

      if (!dry) {
        try {
          rmSync(file)
        } catch {}
      }
    }
  }

  return { count, freed }
}

export const prune = ({ dry = false, budgetMb, keepDays } = {}) => {
  const config = loadConfig()
  const budget = (budgetMb ?? config.guestBudgetMb ?? 200) * 1024 * 1024
  const keepMs = (keepDays ?? config.guestKeepDays ?? 14) * 24 * 60 * 60 * 1000

  const orphans = sweepOrphans(dry)

  const used = (() => {
    try {
      return JSON.parse(readFileSync(join(STATE_DIR, 'guests.json'), 'utf8'))
    } catch {
      return {}
    }
  })()

  // When the ledger has nothing to say about a guest, ask the disk rather than
  // assuming 1970.
  //
  // The ledger is one JSON file, read and rewritten whole, with no lock. Two
  // writers at once — and a guest is now fetched in a detached process, so there
  // can be — means one of them reads, the other writes, and the first writes its
  // stale copy back over the top. The entry that goes missing that way belonged
  // to a Pokemon downloaded seconds ago, and `?? 0` dated it to the epoch, which
  // is a fortnight stale by any reckoning. The next pane to open deleted it.
  //
  // The files' own timestamp cannot be lost by a race and says the same thing
  // the ledger was trying to say: when this guest last turned up.
  const arrived = (name) => {
    try {
      return statSync(join(POKEMON_DIR, name)).mtimeMs
    } catch {
      return 0
    }
  }

  const guests = guestsByAge().map((name) => ({
    name,
    size: guestCost(name),
    at: used[name] ?? arrived(name),
  }))

  // A guest a pane is showing right now is not a candidate, however old the
  // last-used stamp looks. Nothing touches that stamp while a Pokemon simply
  // sits there being displayed, so a pane left open for a fortnight had its own
  // sprite deleted underneath it — and the pane refuses to draw a species whose
  // files are missing, so it would fail at the next switch to working.
  const held = speciesInUse()

  const evicted = []
  let total = guests.reduce((sum, guest) => sum + guest.size, 0)

  // Stale first, regardless of how much room there is. A guest nobody has
  // wanted in a fortnight is not earning its disk.
  for (const guest of guests) {
    if (held.has(guest.name)) continue

    if (Date.now() - guest.at <= keepMs) continue

    evicted.push({ ...guest, why: 'stale' })
    total -= guest.size

    if (!dry) forget(guest.name)
  }

  // Then oldest-first until the rest fits the budget. A held guest is skipped
  // here too, which can leave the total over budget — correct, because the
  // alternative is breaking a pane that is on screen to save disk.
  for (const guest of guests) {
    if (total <= budget) break

    if (held.has(guest.name)) continue

    if (evicted.some((gone) => gone.name === guest.name)) continue

    evicted.push({ ...guest, why: 'over budget' })
    total -= guest.size

    if (!dry) forget(guest.name)
  }

  // The evicted guests' frames are now orphaned too.
  const after = evicted.length > 0 ? sweepOrphans(dry) : { count: 0, freed: 0 }

  return {
    orphans: { count: orphans.count + after.count, freed: orphans.freed + after.freed },
    guests: guests.length,
    evicted,
    remaining: total,
    budget,
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

if (process.argv[1] && process.argv[1].endsWith('prune.mjs')) {
  const dry = process.argv.includes('--dry')

  // `prune()` has always taken these; nothing on the command line could reach
  // them, so the only way to try a different budget was to edit config.json and
  // remember to put it back. Paired with --dry they answer "what would go?"
  // without touching anything.
  const flag = (name) => {
    const found = process.argv.find((arg) => arg.startsWith(`--${name}=`))
    const value = found ? Number(found.slice(name.length + 3)) : NaN

    return Number.isFinite(value) ? value : undefined
  }

  const result = prune({ dry, keepDays: flag('keep-days'), budgetMb: flag('budget-mb') })

  console.log(`\n  ${dry ? 'would free' : 'freed'}\n`)

  if (result.orphans.count) {
    console.log(`   ${String(result.orphans.count).padStart(4)} orphaned frames   ${mb(result.orphans.freed)}`)
  }

  for (const guest of result.evicted) {
    console.log(`   ${guest.name.padEnd(16)} ${mb(guest.size).padStart(8)}   ${guest.why}`)
  }

  if (!result.orphans.count && result.evicted.length === 0) console.log('   nothing to do')

  console.log(`\n  ${result.guests - result.evicted.length} guests kept, ${mb(result.remaining)} of ${mb(result.budget)}\n`)
}
