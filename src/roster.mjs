// A different Pokemon per Claude session, each with two real animations.
//
//   waiting  its Gen-5 Black/White front sprite, as drawn
//   working  the same sprite in its shiny palette
//
// Both halves are the same kind of thing from the same rip, which is the whole
// point. Gen 5 holds exactly two animations per Pokemon — the front sprite and
// the back one — so a *different* animation of the same Pokemon cannot come
// from Gen 5 at all. Every attempt to find one somewhere else lost on quality,
// and quality is what is actually being judged:
//
//   source            artwork   shown at   frames
//   Gen-5 front        37-74px   0.9-1.8x   24-86    the bar
//   Gen-5 back         32-98px   0.8-1.8x   28-86    same bar, facing away
//   Showdown ani (XY)  45-133px  0.5-1.5x   25-106   pale, smooth-shaded, soft
//   PMDCollab          18-31px   2.5-3.6x    3-12    blobby, thick outline
//
// PMDCollab is the one that was in here, and the table says why it read as
// cheap: a third of the resolution magnified twice as far, and three frames
// where the idle has fifty. Showdown's XY set is the opposite failure — more
// pixels than Gen 5, but 3D renders rather than drawn pixel art, so beside the
// idle it looks washed out.
//
// The shiny palette sidesteps the whole problem. It is the same file recoloured
// — so it cannot be lower resolution, cannot clash in style, faces you, and
// stays the same Pokemon. Only the colour changes, which at this size is the
// signal that reads fastest anyway.
//
// The evolved form was tried here and works well, but evolving is being saved
// for a different idea: a session that has run long enough evolves what is
// sitting next to it. Spending it on "Claude is busy" would waste the moment.
// The silhouette flicker in window.mjs is already built and waiting for it.
//
// Where a shiny is not enough, an entry can be handed its own `busy` file and
// it overrides all of this — Pikachu, Ash and Psyduck all do.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'

export const POKEMON_DIR = join(ROOT, 'assets', 'pokemon')

// An entry with neither `busy` nor `shiny: false` works as its own shiny.
//
// Shiny is the same sprite in a different palette — same artist, same size,
// same motion, drawn for the same game. So the working half cannot clash with
// the resting half, cannot be lower resolution than it, and stays the same
// Pokemon throughout. What changes is the colour, and colour is a better signal
// at this size than a pose is: the pane is glanced at, not studied.
//
// The honest cost: the *motion* is identical. Resting Meowth and working Meowth
// do the same thing, in different colours. Where that is not enough, hand a
// entry its own `busy` file — Psyduck has one — and it overrides all of this.
//
// How far each shiny actually moves the colour, measured over the lit pixels of
// the first frame:
//
//   psyduck 27%   bulbasaur 21%   eevee 20%   jigglypuff 17%   charmander 13%
//   munchlax 12%  squirtle 10%    haunter 8%  meowth 6%
//
// Read those with care — the number is an average over the whole sprite, and it
// understates the ones that recolour only their accents. Meowth scores 6% and is
// obvious in the pane, because the parts that change (paws, ears, tail) go from
// brown to pink while the cream body stays put. Haunter is the genuinely weak
// one. Look before believing the number.
export const ROSTER = [
  // The one everything was built around, using the sprites chosen for it. Not
  // evolved: Raichu would be a change to Pikachu, and Pikachu does not change.
  { name: 'pikachu', idle: 'assets/3-standing.gif', busy: 'assets/9-pikachu-run.gif', busySpeed: 1 },
  // Not a Pokemon and not from PokeAPI — supplied by hand, and the only entry
  // whose two halves are of the trainer rather than of a Pokemon. Standing
  // while it waits, running while it works. Its run is already a run cycle at
  // 100ms a frame, so like Pikachu it plays as drawn.
  //
  // The standing half was cut out of a sheet of five trainers with `npm run
  // crop -- <in> <out> --find=3` — Ash is the middle one. Cropping is the one
  // operation here that cannot be a byte patch: `recolour` and `key` relabel a
  // palette, but this moves every pixel to a new address, so the frames are
  // decoded and re-encoded the way `flip` does.
  //
  // At 66x85 it draws at 0.8x, which is the Gen-5 range rather than the 0.14x
  // the previous standing sprite needed — that one was 329x498 of smooth
  // artwork with no pixel grid to recover, and it read as soft beside sprites
  // that snap to the terminal's cells.
  //
  // The running half deliberately keeps Pikachu in frame. It makes the two
  // halves different scales — Ash is smaller when running, because the pane
  // fits the whole scene rather than the figure — but that is the same trade
  // Charizard makes, where the fire fills the empty half of the pane.
  //
  // `card` is what a resident who is not a Pokemon needs, and the only extra
  // field one of them needs anywhere. The pokedex is built from Showdown's data,
  // which has no trainers in it, so without this `--dex ash` has nothing to
  // answer with. Everything else — summoning, the launch flag, the picker,
  // "did you mean" — reads the roster and needs nothing added.
  {
    name: 'ash',
    idle: 'assets/27-ash-standing.gif',
    busy: 'assets/28-ash-pikachu-running.gif',
    busySpeed: 1,
    card: {
      title: 'Ash Ketchum',
      blurb:
        'A young Pokémon Trainer from Pallet Town whose lifelong dream is to become a ' +
        'Pokémon Master. Accompanied by his loyal partner Pikachu, he starred in the ' +
        'anime for 25 seasons before finally achieving his goal of becoming a world champion.',
      facts: [
        ['species', 'Human'],
        ['from', 'Pallet Town'],
        ['partner', 'Pikachu'],
        ['goal', 'Become a "Pokémon Master"'],
      ],
      // The card as it appears in the pane, written whole rather than wrapped
      // from the blurb: the pane is a few cells wide and sizes itself to its
      // longest line, so short lines belong there and sentences do not.
      pane: ['Ash Ketchum (Satoshi)', 'Pallet Town', 'Partner : Pikachu', 'Goal : Become a "Pokémon Master"'],
    },
  },
  { name: 'charmander' },
  // The second trainer, and the first sprite here that came with its own walk
  // cycles rather than needing them invented.
  //
  // The source is one GIF of 36 frames: a small overworld Brock walking in four
  // directions. Frames 0-8 face you, 12-17 are side on, and the rest walk away.
  // Front while it waits, side on while it works — the same division Ash has,
  // out of one file, so the two halves cannot disagree about anything.
  //
  // Keyed on saturation rather than on brightness. It is a smoothed upscale, so
  // the figure carries a soft grey halo that no white test could take off
  // without eating his skin as well; everything actually drawn has colour in it
  // and the halo has none, which separates them cleanly.
  {
    name: 'brock',
    idle: 'assets/32-brock-standing.gif',
    busy: 'assets/33-brock-walking.gif',
    busySpeed: 1,
    card: {
      title: 'Brock',
      blurb:
        'The Rock-type Gym Leader of Pewter City, who handed the gym to his father and ' +
        'left to travel with Ash as the group\'s cook, nurse and voice of reason. He ' +
        'wants to become the world\'s best Pokémon Breeder.',
      facts: [
        ['species', 'Human'],
        ['from', 'Pewter City'],
        ['gym', 'Rock type'],
        ['goal', 'Pokémon Breeder'],
      ],
      pane: ['Brock', 'Pewter City Gym', 'Type : Rock', 'Goal : Pokemon Breeder'],
    },
  },
  { name: 'squirtle' },
  { name: 'bulbasaur' },
  { name: 'eevee' },
  { name: 'munchlax' },
  { name: 'haunter' },
  // The only mixed entry: its Gen-5 sprite while it waits, a supplied GIF while
  // it works — so it stays Psyduck rather than working as its shiny.
  //
  // The file arrived as 600x640 but is really 75x80 blown up eight times, which
  // `recoverNative` divides back out — so it is drawn at 1.6x against the idle's
  // 1.5x, which is why the two sit together as well as they do.
  //
  // `assets/13-psyduck-pikachu.gif` was tried here: Psyduck running alongside
  // Pikachu, two characters in one frame. It fits the pane at 11 of 34 columns,
  // but it did not read cleanly at this size — 407x295 of smooth artwork with no
  // pixel grid to recover, reduced to a quarter of its size, so nothing snaps to
  // the terminal's grid the way the pixel-art sprites do. Still on disk.
  //
  // `busySpeed: 1` because the animation is already timed by whoever drew it.
  { name: 'psyduck', busy: 'assets/12-psyduck-running.gif', busySpeed: 1 },
  { name: 'jigglypuff' },
  // Rests as its Gen-5 sprite, breathes fire while Claude works.
  //
  // The firing animation is 233x95 against the resting sprite's 87x89, because
  // the frame has to be wide enough for the flame — and the flame goes *left*,
  // so Charizard itself sits at the right-hand end of its own box. Drawn from
  // the left edge like everything else, its body would jump eleven columns
  // sideways the moment Claude started working.
  //
  // The file itself is mirrored — `npm run flip` — rather than flipped as it
  // loads. It has to be: GitHub strips `style` from images, so a README cannot
  // mirror anything, and Charizard was facing one way there and the other way
  // in the pane. One flipped file, and the two agree.
  //
  // The mirroring is what puts the body on the left where the resting sprite
  // is, with the fire going right across the empty pane. Drawn as it came, its
  // body sat at the right-hand end and jumped eleven columns on every switch.
  //
  // No `transition`. Breathing fire is the same Charizard doing something, not
  // one sprite becoming another, and a white flash would announce a change that
  // is not happening. `assets/15-charizard-shiny.gif` is kept for later.
  {
    name: 'charizard',
    idle: 'assets/14-charizard.gif',
    busy: 'assets/16-charizard-firing.gif',
    busySpeed: 1,
  },
  // Was working as its own shiny — same animation, pink paws — until a jump
  // turned up. It moves 78% of itself per frame against the resting sprite's
  // 56%, so it is a real change of activity rather than a change of palette.
  //
  // No `transition`: jumping is Meowth doing something, not Meowth becoming
  // something, and the white flash is reserved for recolours.
  { name: 'meowth', busy: 'assets/18-meowth-jumping.gif', busySpeed: 1 },
  // Gengar was never in the roster — Haunter is, left over from when working
  // meant the evolved form — so this is a new entry rather than a change to
  // one. Haunter stays; they are different Pokemon and both are worth having.
  //
  // Rests as itself, attacks while Claude works.
  //
  // The attack frame is 141x68 against the resting sprite's 74x63, because it
  // is a battle scene rather than a portrait: Gengar fires a beam at a small
  // opponent, and the frame has to be wide enough for both. Worth knowing that
  // the second creature is in there — it is not a solo animation.
  //
  // No `flipBusy`, unlike Charizard. Gengar already starts at the left of its
  // frame and fires rightward, so it lands where the resting sprite is. The
  // union of all frames looks like a body at the right-hand end, but that mass
  // is the beam travelling across — per frame, the body stays put and the
  // attack is what moves. Mirroring it would have thrown the body across the
  // pane, which is the very thing flipping is for elsewhere.
  //
  // No `transition` either: an attack is Gengar doing something, not Gengar
  // becoming something, and the white flash is kept for recolours.
  {
    name: 'gengar',
    idle: 'assets/23-gengar.gif',
    busy: 'assets/25-gengar-attack.gif',
    busySpeed: 1,
  },
  // Both halves supplied. Swings its bone while Claude works.
  //
  // The two were drawn by different hands and it shows: the average colour of
  // the lit pixels differs by 20%, about as much as a shiny does, so this reads
  // as a change of palette as well as a change of pose. Deliberate — it was
  // asked for by name — but it is why there is no `transition`. Flashing white
  // on top of a recolour that is already happening would be saying it twice.
  {
    name: 'cubone',
    idle: 'assets/21-cubone.gif',
    busy: 'assets/22-cubone-swinging.gif',
    busySpeed: 1,
  },
  // The third trainer, out of a four-direction sheet like Brock's — front while
  // it waits, side on while it works, frames 0-8 and 12-17.
  //
  // Her side-on walk crops tighter than her standing frames, so she is drawn a
  // little larger while working. That is the same trade Ash makes and it reads
  // as leaning into it rather than as an error.
  {
    name: 'misty',
    idle: 'assets/34-misty-resting.gif',
    busy: 'assets/35-misty-working.gif',
    busySpeed: 1,
    card: {
      title: 'Misty',
      blurb:
        'The youngest of the four Sensational Sisters and Gym Leader of Cerulean City, ' +
        'who left the gym to travel with Ash after fishing him out of a river. She ' +
        'trains Water types and means to become the greatest Water Pokémon Master.',
      facts: [
        ['species', 'Human'],
        ['from', 'Cerulean City'],
        ['gym', 'Water type'],
        ['goal', 'Water Pokémon Master'],
      ],
      pane: ['Misty', 'Cerulean City Gym', 'Type : Water', 'Goal : Water Master'],
    },
  },
]

// Showdown's Gen-5 animated set rather than PokeAPI's, which is the same
// artwork reached by name instead of by dex number — and a good deal more of
// it. PokeAPI stops at the 649 Pokemon that existed in Gen 5. Showdown carries
// 895, because Smogon's sprite project kept drawing in the Black/White style
// long after Game Freak stopped: Sylveon, Toxtricity and Dragapult are all
// there at the same quality as the real ones (0.8-1.1x, 60-76 frames).
//
// Coverage of Gen 7 onward is partial — Decidueye, Cinderace and Meowscarada
// are missing — so a new entry is worth fetching before it is believed. That is
// what `npm run roster` reports on.
const GEN5 = 'https://play.pokemonshowdown.com/sprites/gen5ani'

// The shiny palette lives in a folder of its own, the same sprites recoloured.
const SPRITE_URL = (name, shiny = false) => `${GEN5}${shiny ? '-shiny' : ''}/${name}.gif`

// Every name the sprite folder has, bundled rather than fetched, so asking for
// a Pokemon that does not exist is answered instantly and offline.
//
// The roster above is the *residents*: hand-tuned, always on disk, and the only
// ones the rotation hands out. Everything else in this list is a *guest* —
// summoned by name, fetched the first time, and thrown away again when the
// space is wanted. That split is what keeps this from costing 2.7GB: the whole
// set pre-rendered would be 1790 sprites and about twenty-five minutes.
//
// Forms are included as the folder names them, so `--charizard-mega-x` and
// `--rotom-wash` work. It also means the list is not filtered for real names
// with hyphens in them — ho-oh, porygon-z, mr-mime — which any cleverer filter
// would have quietly eaten.
const KNOWN = new Set(JSON.parse(readFileSync(join(ROOT, 'assets', 'gen5-names.json'), 'utf8')))

// Every name the sprite folder has, for anything that needs to search the set
// rather than ask about one member of it — the "did you mean" matcher, mostly.
// Residents included, because a resident who is not in the sprite folder was
// invisible to it: `--ashh` got no "did you mean --ash", the one case where a
// suggestion is most obviously owed.
export const allNames = () => [...new Set([...ROSTER.map((row) => row.name), ...KNOWN])]

// What someone types, turned into what the folder calls it.
//
// The folder strips punctuation out of names — Ho-Oh is `hooh`, Porygon-Z is
// `porygonz`, Mr. Mime is `mrmime`, Type: Null is `typenull` — but it keeps
// hyphens for forms, so `rotom-wash` is exactly that. Trying the literal name
// first and the stripped one second gets both without a table of exceptions.
export const resolveName = (input) => {
  const text = String(input ?? '').trim().toLowerCase()

  if (!text) return null

  // The roster before the sprite folder. A resident whose name is not a
  // Pokemon's — Ash — is not in the folder and never will be, and every command
  // that takes a name comes through here. Resolving him here rather than at each
  // call site is what makes adding another one a matter of one roster entry:
  // when this returned null for him, the launch flag silently fell back to the
  // rotation and "did you mean" could not offer him.
  if (ROSTER.some((row) => row.name === text)) return text

  if (KNOWN.has(text)) return text

  const stripped = text.replace(/[^a-z0-9-]/g, '')

  if (KNOWN.has(stripped)) return stripped

  const bare = text.replace(/[^a-z0-9]/g, '')

  return KNOWN.has(bare) ? bare : null
}

export const isKnown = (name) => resolveName(name) !== null

export const knownCount = () => KNOWN.size

const entryFor = (name) => ROSTER.find((entry) => entry.name === name)

// A guest is a name the folder has that the roster does not. It behaves exactly
// like a plain roster entry — Gen-5 sprite resting, its shiny working, flashing
// between — which is why guests need no configuration at all.
export const isResident = (name) => Boolean(entryFor(name))

export const isGuest = (name) => !entryFor(name) && isKnown(name)

// Evolution is deliberately not wired to the working sprite. It is being kept
// back for a different idea — a session that has run long enough evolves what
// is sitting beside it — and the silhouette flicker in window.mjs is already
// built for that. Nothing in the roster sets it, so nothing evolves today.
export const becomes = (name) => entryFor(name)?.becomes ?? null

// Which downloaded entries work as their own shiny: all of them, unless they
// were handed a `busy` file or opted out.
export const isShiny = (name) => {
  const entry = entryFor(name)

  if (!entry) return isKnown(name)

  return !entry.busy && entry.shiny !== false
}

// What to play while one sprite becomes the other. The pane needs to know
// *which* animation, because the two cases look nothing alike:
//
//   'evolve'  two different Pokemon — trade their white silhouettes back and
//             forth, which reads as a shape resolving into another shape
//   'flash'   the same Pokemon recoloured — the silhouettes are identical, so
//             alternating them would just sit there as a white blob. Flash
//             between the silhouette and the sprite instead.
//
// Pikachu and Ash get nothing: standing and running is not a transformation,
// and announcing one would be a lie.
// Which edge of the pane a sprite is pinned to. Left unless an entry says
// otherwise, which is what every sprite did before this existed.
//
// It matters when the two halves of a pair have very different widths for a
// reason — an effect that extends in one direction — because the Pokemon then
// sits somewhere other than the middle of its own frame, and the wrong edge
// makes it leap sideways on the switch.
export const alignFor = (name) => entryFor(name)?.align ?? 'left'

// Mirror the working sprite left-to-right as it loads.
//
// The other way to stop a one-sided animation throwing its Pokemon across the
// pane. Pinning the far edge (`align`) keeps the body still but parks the whole
// sprite against that edge, away from where every other Pokemon sits. Mirroring
// moves the body back to the left where it belongs and sends the effect out
// across the empty pane instead. It costs a facing direction.
export const flipBusyFor = (name) => Boolean(entryFor(name)?.flipBusy)

export const transitionFor = (name) => {
  const entry = entryFor(name)

  if (!entry) return isKnown(name) ? 'flash' : null

  if (entry.becomes) return 'evolve'

  return entry.transition ?? (isShiny(name) ? 'flash' : null)
}

// Named for what it holds rather than something generic, so changing the roster
// asks for a file that is not there yet and fetches it. Named plain `busy.gif`,
// an entry whose working sprite changed would keep drawing the old one for as
// long as the old file sat on disk — no error, just the wrong sprite, which is
// the hardest kind of wrong to notice.
export const busyGifFile = (name) => join(POKEMON_DIR, name, `busy-${isShiny(name) ? 'shiny' : 'form'}.gif`)

// How much of each frame's own delay to keep while Claude works.
//
// Both halves are now Gen-5 sprites timed by the people who drew them, so both
// play as drawn. The configured speed-up existed for the Gen-5 back sprites,
// which mostly stand still and needed the help; nothing uses those any more,
// and applying it here would turn a wingbeat into a flutter.
export const busySpeedFor = (name, fallback) => {
  const entry = entryFor(name)

  // Anything the roster knows about plays as drawn unless it says otherwise —
  // guests included, since their sprites are Gen-5 rips timed by their artists.
  // The configured speed-up only applies to sprites passed on the command line,
  // which have no entry and no name to speak for them.
  if (entry) return entry.busySpeed ?? 1

  return isKnown(name) ? 1 : fallback
}

// A roster entry may point at files that were already here rather than at
// something downloaded.
export const idleFile = (name) => {
  const entry = entryFor(name)

  return entry?.idle ? join(ROOT, entry.idle) : join(POKEMON_DIR, name, 'idle.gif')
}

export const busyFile = (name) => {
  const entry = entryFor(name)

  if (entry?.busy) return join(ROOT, entry.busy)

  return busyGifFile(name)
}

export const isFetched = (name) => existsSync(idleFile(name)) && existsSync(busyFile(name))

const download = (url, to) => {
  const result = spawnSync('curl', ['-sfL', '-o', to, url], { encoding: 'utf8' })

  return result.status === 0 && existsSync(to)
}

// `refresh` re-downloads sprites that are already here. Needed when the source
// changes — the working half has been Showdown, then Gen-5 back sprites, then
// PMDCollab, and without this the old files would simply be found and kept.
// The two halves are decided separately, because an entry may hand-pick one and
// download the other — Psyduck keeps its Gen-5 sprite while it waits and uses a
// supplied GIF while it works. Treating "has any hand-picked file" as "needs no
// downloads" would leave that entry's other half missing on a fresh machine,
// and it would look like a working roster right up until the pane opened.
export const fetchOne = (entry, refresh = false) => {
  const sprite = entry.sprite ?? entry.name

  const wants = [
    entry.idle ? null : { url: SPRITE_URL(sprite), to: idleFile(entry.name), what: entry.name },
    entry.busy
      ? null
      : { url: SPRITE_URL(entry.becomes ?? sprite, isShiny(entry.name)), to: busyGifFile(entry.name), what: `shiny ${sprite}` },
  ].filter(Boolean)

  const supplied = [entry.idle, entry.busy].filter(Boolean).length

  // Nothing to fetch: both halves were supplied by hand.
  if (wants.length === 0) {
    return isFetched(entry.name) ? 'ready (hand-picked)' : 'missing its hand-picked files'
  }

  // A hand-picked file that is not on disk cannot be recovered by downloading,
  // so say so rather than reporting a success that leaves the pane broken.
  if (supplied > 0 && !existsSync(entry.idle ? join(ROOT, entry.idle) : join(ROOT, entry.busy))) {
    return 'missing its hand-picked file'
  }

  if (isFetched(entry.name) && !refresh) return 'ready'

  mkdirSync(join(POKEMON_DIR, entry.name), { recursive: true })

  // Named by the sprite it wants rather than by a number, so adding a Pokemon
  // means writing what it is called.
  for (const want of wants) {
    if (!download(want.url, want.to)) return `no ${want.what} sprite`
  }

  const how = entry.busy ? 'hand-picked working sprite' : isShiny(entry.name) ? 'shiny' : `-> ${entry.becomes}`

  return `${refresh ? 'refreshed' : 'fetched'} (${how})`
}

export const available = () => ROSTER.map((entry) => entry.name).filter(isFetched)

export const names = () => ROSTER.map((entry) => entry.name)

// Bring a guest in. Residents are already on disk and are left alone.
//
// Called from the moment a guest is asked for — the shell wrapper's launch, the
// hook's mid-session switch — because the pane refuses to draw a species whose
// files are missing, and refusing silently is exactly how this would look
// broken. Returns the resolved name, or null if it could not be had.
export const ensure = (input) => {
  const name = resolveName(input)

  if (!name) return null

  if (isFetched(name)) return name

  if (!isGuest(name)) return null

  mkdirSync(join(POKEMON_DIR, name), { recursive: true })

  // Both halves, or neither. A guest with only its resting sprite would draw
  // fine until Claude started working and then fail, which is the worst moment
  // to discover a missing file.
  const ok =
    download(SPRITE_URL(name), idleFile(name)) && download(SPRITE_URL(name, true), busyGifFile(name))

  if (!ok) {
    forget(name)

    return null
  }

  touch(name)

  return name
}

// When each guest was last actually shown. Residents are never recorded — they
// are pinned and the file would only grow.
const USED_FILE = join(ROOT, '.state', 'guests.json')

const readUsed = () => {
  try {
    return JSON.parse(readFileSync(USED_FILE, 'utf8'))
  } catch {
    return {}
  }
}

export const touch = (name) => {
  if (!isGuest(name)) return

  try {
    const used = readUsed()

    used[name] = Date.now()

    mkdirSync(join(ROOT, '.state'), { recursive: true })
    writeFileSync(USED_FILE, JSON.stringify(used))
  } catch {}
}

export const fetchedGuests = () => {
  try {
    return readdirSync(POKEMON_DIR).filter((name) => isGuest(name) && isFetched(name))
  } catch {
    return []
  }
}

// Throw a guest out: its sprites and its place in the ledger. The frame cache is
// keyed by file, so entries for a deleted sprite can never be hit again and are
// swept separately — see src/prune.mjs.
export const forget = (name) => {
  if (!isGuest(name)) return false

  try {
    rmSync(join(POKEMON_DIR, name), { recursive: true, force: true })
  } catch {}

  try {
    const used = readUsed()

    delete used[name]

    writeFileSync(USED_FILE, JSON.stringify(used))
  } catch {}

  return true
}

// Guests oldest-first, which is the order to evict in.
export const guestsByAge = () => {
  const used = readUsed()

  return fetchedGuests().sort((a, b) => (used[a] ?? 0) - (used[b] ?? 0))
}

// Asked for by name rather than picked: `claude --pikachu`, which the shell
// wrapper turns into an environment variable. Claude Code would reject the flag
// itself, so it never reaches it — see src/shell.mjs.
//
// An explicit ask wins over everything, including a Pokemon already being out
// in another window. Asking for Pikachu twice is a thing someone might mean;
// being told no by their own terminal is not.
export const SPECIES_ENV = 'PIXEL_RUNNER_SPECIES'

export const requestedSpecies = (env = process.env) => {
  const asked = String(env[SPECIES_ENV] ?? '').trim().toLowerCase()

  if (!asked) return null

  // Residents answer instantly; a guest is fetched here if this is its first
  // time.  returns null for a name the sprite folder does not have, so
  // a typo falls through to the usual rotation rather than a broken pane.
  return ensure(asked)
}

// The same question without going to the network: what did they ask for, and is
// it here yet?
//
// `claude --kyogre` sets the variable above for the whole session, and answering
// it used to mean downloading before the pane could open — inside a hook that is
// killed after five seconds, which is how a launch flag came to produce no pane
// at all. The launcher asks this instead, opens the split immediately, and lets
// the download run behind it.
export const requestedName = (env = process.env) => {
  const asked = String(env[SPECIES_ENV] ?? '').trim().toLowerCase()

  if (!asked) return null

  return resolveName(asked)
}

// Pikachu whenever Pikachu is free, something else otherwise.
//
// `taken` is the Pokemon the panes currently up are holding. The rule used to
// be "Pikachu if nothing else is running at all", which meant that opening a
// second terminal and closing the first left Pikachu sitting unused while the
// survivor kept whatever it had been given. Asking whether Pikachu itself is
// free instead means it comes back the moment its window closes, and the next
// terminal you open is the familiar one again.
//
// The rest are spread out the same way: prefer a Pokemon nobody has, so a
// handful of terminals side by side are a handful of different Pokemon rather
// than the same one twice. Once every Pokemon is out, the hash decides and
// repeats are unavoidable.
export const pickFor = (sessionId, taken = new Set(), pool = available()) => {
  if (pool.length === 0) return null

  const held = taken instanceof Set ? taken : new Set(taken)

  if (!held.has('pikachu') && pool.includes('pikachu')) return 'pikachu'

  const rest = pool.filter((name) => name !== 'pikachu')
  const spare = rest.filter((name) => !held.has(name))
  const choices = spare.length > 0 ? spare : rest.length > 0 ? rest : pool

  let hash = 0

  for (const character of String(sessionId ?? 'default')) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }

  return choices[hash % choices.length]
}

if (process.argv[1] && process.argv[1].endsWith('roster.mjs')) {
  const refresh = process.argv.includes('--refresh')

  for (const entry of ROSTER) {
    console.log(`  ${entry.name.padEnd(12)} ${fetchOne(entry, refresh)}`)
  }

  const ready = available().length

  console.log(`\n  ${ready} of ${ROSTER.length} ready\n`)

  // Non-zero when any of them is missing, because the caller cannot tell
  // otherwise. This printed its per-entry results and exited 0 regardless, so
  // `npm run setup` ticked "downloading sprites ✓" with a failing network and
  // carried on to report the whole install finished — leaving a pane that opens
  // onto sprites that were never fetched. A step that half-worked has to be
  // able to say so.
  if (ready < ROSTER.length) {
    console.error(`  ${ROSTER.length - ready} could not be fetched — check the network and run this again\n`)
    process.exit(1)
  }
}
