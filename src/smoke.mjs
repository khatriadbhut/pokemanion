// The cheapest test that would have caught a real bug.
//
// `node --check` parses a file; it does not resolve its imports. Extracting the
// renderer into sprite.mjs left `MIN_DELAY` behind in window.mjs, every syntax
// check passed, and the pane died on launch with a ReferenceError. Importing
// each module is what finds that.
//
// Only the modules the pane and the hooks actually load. The tuning tools run
// on import by design — running them is not a smoke test, it is a screenful of
// sprites.
//
// Usage: npm test

import { readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ROOT, STATE_DIR } from './config.mjs'

const MODULES = [
  'config',
  'roster',
  'dex',
  'sprite',
  'switch',
  'companion',
  'prune',
  'interrupt',
  'gif',
  'png',
  'pngwrite',
  'prepare',
  'render',
  'cells',
  'choose',
  'attribution',
  'shell',
  'assigned',
  'ghostty',
  'hint',
  'agents',
  'update',
]

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

// Mark the plugin hello spent before anything drives the hook.
//
// It arms itself when there is no record of a setup having run, which on a fresh
// checkout is true — so on CI it armed and ate the first prompt of whichever
// test ran next, while passing here, where a node-path left by a real install
// happens to sit. It has moved up the file twice now, once per test added above
// the line it used to sit on, so it lives at the top where nothing can be added
// before it. Its own test clears it deliberately and puts it back.
//
// Not wrapped in a catch: the first version was, mkdirSync was not in scope, the
// ReferenceError was swallowed, and the guard did nothing while looking exactly
// like it worked.
// No pane is to be opened by anything this suite runs.
//
// Every hook here is spawned from this process, so setting it once covers all of
// them and anything they start in turn. SessionStart was left out of the event
// list for this reason and that held until a second event learned to open a
// pane — `--<name>` reopening one — at which point `npm test` put sprites on
// screen beside the real sessions again, and the note explaining why SessionStart
// was excluded had quietly become untrue.
process.env.PIXEL_RUNNER_NO_WINDOW = '1'

mkdirSync(STATE_DIR, { recursive: true })
writeFileSync(join(STATE_DIR, 'greeted'), 'smoke')

// And the notice about a plugin being installed, for exactly the same reason.
//
// It is owed once per plugin version, so it fires on a machine that has the
// plugin installed and stays silent on CI, which has none — which is the worst
// shape for a test to have. It cost three checks the first time it ran here, in
// the same way and in the same place as the hello above.
//
// With the version that is actually installed, because the record is keyed by
// version: a made-up one reads as "a different plugin has appeared" and arms the
// notice rather than spending it. That was the first attempt, and it failed in
// precisely the way it was written to prevent.
{
  const { pluginInstalls } = await import('./agents.mjs')

  writeFileSync(join(STATE_DIR, 'plugin-seen'), JSON.stringify({ version: pluginInstalls()[0]?.version ?? null }))
}

for (const name of MODULES) {
  try {
    await import(`./${name}.mjs`)
    check(`import ${name}`, true)
  } catch (error) {
    check(`import ${name}`, false, error.message.split('\n')[0])
  }
}

// The roster is data, and data goes wrong quietly: an entry pointing at a file
// that is not there shows up as a Pokemon that never appears.
const { ROSTER, names, busyFile, idleFile, transitionFor, busySpeedFor } = await import('./roster.mjs')

check('roster has entries', ROSTER.length > 0, `${ROSTER.length} residents`)
check('no duplicate names', new Set(names()).size === names().length)

const missing = ROSTER.flatMap((entry) =>
  [entry.idle, entry.busy].filter(Boolean).filter((file) => !existsSync(join(ROOT, file))),
)

check('hand-picked sprites exist', missing.length === 0, missing.join(', '))
check('everything plays at a sane speed', names().every((name) => busySpeedFor(name, 0.4) > 0))

// A transition is either a recolour or a different creature. Anything else is a
// typo that would silently play nothing.
const kinds = names().map(transitionFor).filter(Boolean)

check('transitions are known kinds', kinds.every((kind) => kind === 'flash' || kind === 'evolve'), [...new Set(kinds)].join(', '))

// The bundled name and dex lists are what makes summoning work offline.
const { isKnown, knownCount, resolveName } = await import('./roster.mjs')

check('names bundled', knownCount() > 1000, `${knownCount()} names`)
check('punctuation resolves', resolveName('ho-oh') === 'hooh')
check('forms resolve', isKnown('rotom-wash'))
check('nonsense does not', !isKnown('zzzznotapokemon'))

const { search, exactMatch, pickRandom, entry } = await import('./dex.mjs')

check('dex searches by name', search('charizard').length > 0)
check('dex searches by type', search('dragon').length > 10)
check('dex searches by number', search('6').every((row) => row.num === 6))
check('an exact name is a lookup', exactMatch('pikachu') === 'pikachu')
check('a trailing dash is a search', exactMatch('pikachu-') === null)
check('the dice only roll real Pokemon', Array.from({ length: 50 }, pickRandom).every((name) => entry(name).num > 0))

// Ash is a resident the pokedex has never heard of, so every part of the dex
// reaches him by a different route than the other twelve.
const { detail, paneCard } = await import('./dex.mjs')

check('a resident who is not a Pokemon is still a lookup', exactMatch('ash') === 'ash')
check('and has a description rather than an empty fact table', detail(entry('ash'), false).includes('Pallet Town'))
check('and never rolls on the dice', !Array.from({ length: 50 }, pickRandom).includes('ash'))
// Ash's card, against the narrowest pane anyone can have.
//
// `windowCols` is the width of a `windowMode: 'window'` pane — a separate window
// rather than a split. A split spans the terminal and has room to spare, so this
// is the worst case rather than the usual one, which is what makes it worth
// checking: a card that fits here fits everywhere.
//
// The card starts at `sprite.cols + CARD_GAP` and runs to the edge, and Ash
// renders 5 columns wide at pane height.
const { DEFAULTS: paneDefaults } = await import('./config.mjs')
const CARD_GAP = 2
const ASH_COLS = 5
const cardWidth = (paneDefaults.windowCols ?? 34) - (ASH_COLS + CARD_GAP) + 1

// Every card, not only Ash's. There are two now, and a card that overflows
// wraps onto the sprite and stays there — the pane erases by overwriting its
// own width, so the remainder outlives the card.
{
  const { ROSTER: withCards } = await import('./roster.mjs')
  const tooWide = withCards
    .filter((row) => row.card)
    .flatMap((row) => paneCard(entry(row.name)).map((line) => ({ who: row.name, line })))
    .filter(({ line }) => line.length > cardWidth)

  check(
    'every pane card fits the pane it is drawn in',
    tooWide.length === 0,
    `${cardWidth} cols; too wide: ${tooWide.map((t) => `${t.who} "${t.line}"`).join(', ')}`,
  )
}

// A setting the README mentions in passing but never lists.
//
// `showVersion` was named in a sentence about turning the corner off and left
// out of the table of settings, so the only way to find it was to have read that
// sentence. The table is deliberately partial — most of these are for tuning how
// a sprite is drawn — but anything the prose tells you to set belongs in it.
{
  const md = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const table = md.slice(md.indexOf('## Settings'), md.indexOf('## Your own sprites'))
  const promised = [...md.matchAll(/`"([a-zA-Z]+)":\s*(?:false|true|\d+)`/g)].map((m) => m[1])
  const unlisted = [...new Set(promised)].filter((key) => !table.includes(`\`${key}\``))

  check('every setting the prose names is in the settings table', unlisted.length === 0, unlisted.join(' '))
}

// The counts written in prose, against the counts that are true.
//
// README, CLAUDE.md and both plugin manifests each state how many ship and how
// many can be summoned. Nothing generated them and nothing checked them, so
// they drifted four behind the sprite folder and stayed there — and the plugin
// manifests are what someone reads before installing.
{
  const { knownCount, ROSTER: everyone } = await import('./roster.mjs')
  const summonable = knownCount() + everyone.filter((row) => row.card).length
  const guests = summonable - everyone.length
  const wrong = []

  // Not wrapped in a try that continues on failure. It was, and that swallowed a
  // ReferenceError for the whole life of this test: every file read threw, every
  // file came back empty, no number was ever examined, and it passed. A test that
  // cannot fail is worse than no test, because it is counted.
  for (const file of ['README.md', 'CLAUDE.md', '.claude-plugin/marketplace.json', '.codex-plugin/plugin.json']) {
    const text = readFileSync(join(ROOT, file), 'utf8')

    // Any four-digit number in this range is one of these two claims.
    for (const [found] of text.matchAll(/\b1[0-9]{3}\b/g)) {
      if (Number(found) !== summonable && Number(found) !== guests) wrong.push(`${file}: ${found}`)
    }
  }

  check('the counts in the docs are the real ones', wrong.length === 0, `${guests} guests, ${summonable} total; found ${wrong.join(', ')}`)

  // The number of residents, which is two digits and so slipped past the check
  // above. Both plugin manifests carried 14 for as long as it took to notice
  // that Brock had made it 15 — and a manifest is the first thing anyone reads
  // about this.
  const shops = ['.claude-plugin/marketplace.json', '.codex-plugin/plugin.json'].map((file) => ({
    file,
    text: readFileSync(join(ROOT, file), 'utf8'),
  }))

  const stale = shops
    .flatMap(({ file, text }) => [...text.matchAll(/(\d+) (?:built in|ship with it)/g)].map((m) => ({ file, said: Number(m[1]) })))
    .filter(({ said }) => said !== everyone.length)

  check(
    'and so is the number of residents in the plugin manifests',
    stale.length === 0,
    `${everyone.length} residents; found ${stale.map((s) => `${s.file}: ${s.said}`).join(', ')}`,
  )
}

// Two installs of this project, one pane.
//
// A clone registers its hooks in the agent's config and a plugin registers its
// own, neither aware of the other, so installing both put two Pokemon beside
// one session. The plugin stands down when it finds another install — which
// rests entirely on being able to pick the other install's path out of two
// different config shapes.
{
  const { mkdtempSync: shopTemp, mkdirSync: shopDir, writeFileSync: shopPut, rmSync: shopDrop } = await import('node:fs')
  const { spawnSync: shopRun } = await import('node:child_process')
  const { tmpdir: shopRoot } = await import('node:os')

  const home = shopTemp(join(shopRoot(), 'pokemanion-dual-'))

  shopDir(join(home, '.claude'), { recursive: true })
  shopDir(join(home, '.codex'), { recursive: true })

  // Two installs that genuinely exist, because an install is only counted if it
  // is still on disk. Pointing the fixture at invented paths tested nothing —
  // both were skipped as missing and the check passed for the wrong reason.
  const cloneA = join(home, 'clone-a')
  const cloneB = join(home, 'clone-b')

  for (const root of [cloneA, cloneB]) {
    shopDir(join(root, 'bin'), { recursive: true })
    shopPut(join(root, 'bin', 'run.sh'), '#!/bin/sh\n')
  }

  // Claude's shape: hooks buried in a settings file holding much else besides.
  shopPut(
    join(home, '.claude', 'settings.json'),
    JSON.stringify({
      model: 'something-else',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: `"${cloneA}/bin/run.sh" on-activity.mjs` }] }] },
    }),
  )

  // Codex's shape: a file that is nothing but hooks.
  shopPut(
    join(home, '.codex', 'hooks.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `"${cloneB}/bin/run.sh" on-activity.mjs` }] }] } }),
  )

  const ask = (ours) =>
    JSON.parse(
      shopRun(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const { otherInstalls } = await import(${JSON.stringify(join(ROOT, 'src', 'agents.mjs'))}); console.log(JSON.stringify(otherInstalls(${JSON.stringify(ours)})))`,
        ],
        { encoding: 'utf8', env: { ...process.env, HOME: home } },
      ).stdout || '[]',
    )

  const seen = ask('/Users/me/somewhere-else')

  check(
    'another install is found in either agent config shape',
    seen.includes(cloneA) && seen.includes(cloneB),
    seen.join(' '),
  )

  // The point of the check is finding *other* installs. One that counted itself
  // would stand down against its own hooks and never run at all.
  check('and the one asking is not one of them', !ask(cloneA).includes(cloneA))

  // Which of the two is stale, which is what decides whether the standing-down
  // copy gets to speak again.
  //
  // Updating the plugin while the source install holds the hooks changes nothing
  // on screen: the pane goes on running the older copy. The message that would
  // explain that has already been spent, so it is keyed by version and a copy
  // that has just been updated past the running one may say so.
  {
    const { isNewer, versionAt } = await import('./update.mjs')

    check('a copy can tell it is newer than the one running', isNewer('1.3.0', '1.2.0') && !isNewer('1.2.0', '1.3.0'))

    // What the pane reads. Unlike the message, it keeps answering after the
    // message has been shown — a version you are behind on stays true.
    const { available } = await import('./update.mjs')

    check('the pane can ask whether an update exists without announcing it', available() === null || typeof available() === 'string')

    // The pane version of the command, folded to the width beside the sprite.
    // A line wider than the pane would run over the edge and wrap onto the row
    // below, on top of the sprite, and the pane erases by overwriting its own
    // width — so the overflow would stay after the card had gone.
    const { updateCommand: commandFor } = await import('./update.mjs')

    // The corner takes the longest form that fits, so it says as much as the pane
    // has room for and never overflows. A split spans the terminal, so it is
    // usually the whole command; a narrow pane still gets something true.
    const { cornerText } = await import('./update.mjs')
    const plugin = '/x/.claude/plugins/cache/pokemanion/pokemanion/1.2.0'

    check('a wide pane gets the whole command', cornerText('1.2.0', '1.3.0', 120, plugin).includes('/plugin update pokemanion@pokemanion'))
    check('a narrow one still says a version is out', cornerText('1.2.0', '1.3.0', 20, plugin) === 'v1.3.0 available')

    // Where there is no room for the command, it names the one that explains it
    // — and says what that does. `--pokemanion` alone reads as the project's
    // name rather than as something to type.
    check(
      'a middling one points at the command that explains it',
      cornerText('1.2.0', '1.3.0', 45, plugin) === 'v1.3.0 available — --pokemanion to update',
      cornerText('1.2.0', '1.3.0', 45, plugin),
    )

    // Every version this prints wears its v. Bare numbers next to words read as
    // quantities — "1.3.0 available" could be a count of something.
    check(
      'versions are written with a v',
      [120, 60, 40, 20, 8].every((w) => /v\d/.test(cornerText('1.2.0', '1.3.0', w, plugin))),
    )
    check('and the narrowest falls back to the version', cornerText('1.2.0', '1.3.0', 8, plugin) === 'v1.2.0')
    check('no update means no update text', cornerText('1.2.0', null, 120, plugin) === 'v1.2.0')

    // Overflow is the thing to avoid: the pane erases by overwriting its own
    // width, so anything wider than the space would wrap onto the sprite and
    // stay there.
    const widths = [200, 120, 80, 60, 40, 30, 20, 12, 8]

    check(
      'nothing it chooses is wider than the room it was given',
      widths.every((w) => cornerText('1.2.0', '1.3.0', w, plugin).length <= Math.max(w, 6)),
    )

    // The command belongs to --update, which answers in the conversation.
    for (const [route, root] of [
      ['claude plugin', '/x/.claude/plugins/cache/pokemanion/pokemanion/1.2.0'],
      ['codex plugin', '/x/.codex/plugins/cache/pokemanion/pokemanion/1.2.0'],
      ['source', ROOT],
    ]) {
      check(`there is an update command for ${route}`, commandFor(root).length > 0)
    }
    check('and reads a version off another install', versionAt(ROOT) === JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version)
    check('and says nothing about one that is not there', versionAt(join(home, 'no-such-install')) === null)
  }

  // A clone deleted by hand leaves its hooks behind in the config. Standing
  // down for a path that is gone leaves no pane at all, which is worse than the
  // two panes this check exists to prevent.
  shopDrop(cloneA, { recursive: true, force: true })

  const afterDelete = ask('/Users/me/somewhere-else')

  check(
    'an install whose folder is gone stops counting',
    !afterDelete.includes(cloneA) && afterDelete.includes(cloneB),
    afterDelete.join(' '),
  )

  shopDrop(home, { recursive: true, force: true })
}

// One version, in all four places that declare one.
//
// The plugin cache is version-stamped and `plugin update` compares versions, so
// a version that never moves means an installed copy can sit on old code
// forever. It sat at 1.1.0 for 31 commits, including the release that made the
// Codex plugin install work at all.
{
  const declared = {
    'package.json': JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
    '.claude-plugin/plugin.json': JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version,
    '.codex-plugin/plugin.json': JSON.parse(readFileSync(join(ROOT, '.codex-plugin', 'plugin.json'), 'utf8')).version,
  }
  const shop = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))

  declared['marketplace.json'] = shop.version
  declared['marketplace plugin entry'] = shop.plugins[0].version

  const values = [...new Set(Object.values(declared))]

  check(
    'every manifest declares the same version',
    values.length === 1,
    Object.entries(declared).map(([where, what]) => `${where}=${what}`).join(' '),
  )
}

// Newer means newer, and 1.10.0 is newer than 1.9.0 — which string comparison
// gets backwards, the same trap as the plugin path resolver.
{
  const { isNewer, updateCommand } = await import('./update.mjs')

  check(
    'a newer version is recognised as newer',
    isNewer('1.2.0', '1.1.0') && isNewer('1.10.0', '1.9.0') && isNewer('2.0.0', '1.99.99'),
  )

  check(
    'and the same or older is not',
    !isNewer('1.2.0', '1.2.0') && !isNewer('1.1.0', '1.2.0') && !isNewer('', '1.0.0'),
  )

  // Telling a plugin user to `git pull` is how a helpful message becomes a
  // baffling one, so the command follows the install rather than the agent.
  // Both halves of the message from the same root. They used to disagree — the
  // command from the root passed in, the "restart the agent" line from whatever
  // this process happened to be — so a plugin's message could arrive without it.
  {
    const { notice } = await import('./update.mjs')
    const plug = '/Users/x/.claude/plugins/cache/pokemanion/pokemanion/1.2.0'
    const built = notice({ current: '1.2.0', latest: '1.3.0', command: updateCommand(plug) }, plug)

    check('a plugin update notice says to restart', built.includes('/plugin update') && /restart the agent/i.test(built))
    check('and a source one does not', !/restart the agent/i.test(notice({ current: '1.2.0', latest: '1.3.0', command: updateCommand(ROOT) }, ROOT)))
  }

  check(
    'the update command matches how it was installed',
    updateCommand('/Users/x/pokemanion').includes('git pull') &&
      updateCommand('/Users/x/.claude/plugins/cache/pokemanion/pokemanion/1.2.0') === '/plugin update pokemanion@pokemanion' &&
      updateCommand('/Users/x/.codex/plugins/cache/pokemanion/pokemanion/1.2.0').startsWith('codex plugin'),
  )
}

// Both marketplace manifests point at the plugin in a way each agent accepts.
//
// Codex's said `git-subdir`, which it parses without complaint and then cannot
// resolve: `codex plugin marketplace add` succeeded, and `codex plugin add`
// answered "plugin `pokemanion` was not found in marketplace `pokemanion`".
// Nothing short of installing it on a machine with Codex would have shown that,
// so this at least pins the shape that was proven to work.
{
  const claudeShop = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
  const codexShop = JSON.parse(readFileSync(join(ROOT, '.agents', 'plugins', 'marketplace.json'), 'utf8'))

  check(
    'Claude finds the plugin at the repository root',
    claudeShop.plugins?.[0]?.source === './',
    JSON.stringify(claudeShop.plugins?.[0]?.source),
  )

  check(
    'Codex finds it as a local source, not a git-subdir',
    codexShop.plugins?.[0]?.source?.source === 'local' && codexShop.plugins?.[0]?.source?.path === './',
    JSON.stringify(codexShop.plugins?.[0]?.source),
  )

  // Both manifests name the plugin the same thing, because the install command
  // people are given is `<plugin>@<marketplace>` with both halves spelled out.
  check(
    'both call it pokemanion@pokemanion',
    claudeShop.name === 'pokemanion' &&
      claudeShop.plugins[0].name === 'pokemanion' &&
      codexShop.name === 'pokemanion' &&
      codexShop.plugins[0].name === 'pokemanion',
  )
}

// The one command that must not block.
//
// Everything else here answers the prompt and stops it. This one hands the job
// to the agent, which only works if the prompt goes through — Claude Code adds
// a UserPromptSubmit hook's stdout to the context on exit 0, and throws it away
// on exit 2 along with the prompt. Get that backwards and the flag does nothing
// but delete what you typed.
{
  const { spawnSync: ask } = await import('node:child_process')
  const said = ask(process.execPath, ['bin/on-activity.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'smoke-add-0001', prompt: '--pokemanion add brock' }),
  })

  check('--pokemanion add lets the prompt through', said.status === 0, `exit ${said.status}`)
  check('and says so on stdout, where the model reads it', /adding-a-character/.test(said.stdout ?? ''), (said.stdout ?? '').slice(0, 40))
  check('and names the character it was given', /brock/.test(said.stdout ?? ''))
}

// The skill both agents ship, which is how an agent learns the toolbox.
//
// It is a file in a directory with a name, and nothing else validates it: a
// typo in the frontmatter or a rename of the folder leaves the plugin quietly
// shipping nothing, and the only symptom is an agent that does not know `npm
// run add` exists.
{
  const skill = join(ROOT, 'skills', 'adding-a-character', 'SKILL.md')

  check('the skill is where a plugin looks for it', existsSync(skill))

  const text = existsSync(skill) ? readFileSync(skill, 'utf8') : ''
  const frontmatter = text.startsWith('---') ? text.slice(3, text.indexOf('---', 3)) : ''

  check('and declares a name and a description', /\bname:\s*adding-a-character/.test(frontmatter) && /\bdescription:\s*\S/.test(frontmatter))

  // The commands it teaches have to be commands that exist.
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts
  const taught = [...text.matchAll(/npm run ([a-z-]+)/g)].map((m) => m[1])
  const missing = [...new Set(taught)].filter((name) => !scripts[name])

  check('and every command it teaches exists', missing.length === 0, missing.join(' '))

  // A clone has the skill and no way to offer it, so setup links it into
  // ~/.claude/skills. Miss that and the plugin's users get the toolbox while
  // the person editing the project does not.
  const setup = readFileSync(join(ROOT, 'src', 'setup.mjs'), 'utf8')

  check('and a source install is offered it too', setup.includes('src/skill.mjs'))
}

// The GIF writer, which `add` leans on to save art it has changed.
//
// Round trip rather than byte comparison: what matters is that a decoder sees
// the frames that went in, at the size they went in, with the transparency they
// had. Nothing else about the bytes is anyone's business.
{
  const { encodeGif } = await import('./gifwrite.mjs')
  const W = 6
  const H = 4
  const made = [0, 1, 2].map((n) => {
    const pixels = new Uint8Array(W * H * 4)

    for (let i = 0; i < pixels.length; i += 4) {
      const on = (i / 4) % 3 !== n

      pixels[i] = 200
      pixels[i + 1] = 40 * (n + 1)
      pixels[i + 2] = 90
      pixels[i + 3] = on ? 255 : 0
    }

    return pixels
  })

  const { decodeGif: read } = await import('./gif.mjs')
  const back = read(encodeGif(made, W, H, 80))

  check('the gif writer round trips', back.frames.length === 3 && back.width === W && back.height === H, `${back.frames.length} frames, ${back.width}x${back.height}`)

  const holes = made.map((pixels, f) => {
    let wrong = 0

    for (let i = 0; i < pixels.length; i += 4) {
      if ((pixels[i + 3] > 128) !== (back.frames[f].pixels[i + 3] > 128)) wrong++
    }

    return wrong
  })

  check('and keeps every transparent pixel transparent', holes.every((n) => n === 0), holes.join(' '))
}

// Adding a character should be one entry in one file.
//
// Ash was not. He went into the roster, and then the launch flag, "did you
// mean" and the pokedex each had to be taught about him separately — two of
// them never were, and nothing said so. This adds a character the way someone
// would, then asks every command that takes a name whether it can see him. It
// is the only test here that would catch the *next* one being half-wired.
{
  const { ROSTER: roster } = await import('./roster.mjs')
  const { ensure, resolveName, names: rosterNames } = await import('./roster.mjs')
  const { parse, suggest } = await import('./switch.mjs')
  const { snippet } = await import('./shell.mjs')

  // Real files, because half of this is "are its sprites on disk" — borrowed
  // from Pikachu rather than invented, so nothing has to be written.
  //
  // Taken off his entry rather than spelled out. ATTRIBUTION.md is generated by
  // scanning the source for asset paths, so naming the two files here credited
  // them to "the pane (smoke.mjs)" and put a test fixture in a document about
  // who drew what.
  const borrowed = roster.find((row) => row.name === 'pikachu')

  roster.push({
    name: 'testchar',
    idle: borrowed.idle,
    busy: borrowed.busy,
    busySpeed: 1,
    card: { title: 'Test Character', blurb: 'Exists only for this test.', pane: ['Test Character', 'not real'] },
  })

  try {
    const surfaces = [
      ['resolves as a name', () => resolveName('testchar') === 'testchar'],
      ['can be summoned', () => ensure('testchar') === 'testchar'],
      ['appears in the picker', () => rosterNames().includes('testchar')],
      ['is switched to when typed', () => parse('--testchar', rosterNames())?.kind === 'switch'],
      ['is offered by did-you-mean', () => String(suggest('testchr', rosterNames()) ?? '').includes('testchar')],
      ['is a dex lookup', () => exactMatch('testchar') === 'testchar'],
      ['has a dex card', () => detail(entry('testchar'), false).includes('Exists only for this test')],
      ['has a pane card', () => paneCard(entry('testchar'))[0] === 'Test Character'],
      ['is reachable from the shell wrapper', () => snippet(['claude']).includes('roster.mjs')],
    ]

    const missed = surfaces.filter(([, works]) => !works()).map(([what]) => what)

    check('a new character needs only its roster entry', missed.length === 0, missed.join('; '))
  } finally {
    roster.pop()
  }
}

// "N other forms" points at a prefix search, so anything without the prefix is
// not a form and the follow-up cannot find it. --dex mew counted Mewtwo.
const forms = (name) => search(name).filter((row) => row.name.startsWith(`${name}-`)).length

check('forms are counted by prefix, not by matching', forms('mew') === 0 && forms('pikachu') > 5)

// The commands, parsed the way the hook parses them.
const { parse } = await import('./switch.mjs')

check('--pikachu switches', parse('--pikachu')?.kind === 'switch')
// Only meaningful where two installs exist, and parsed here with everything else
// so it is never mistaken for a Pokemon of that name.
check('--pokemanion use plugin is its own command', parse('--pokemanion use plugin')?.kind === 'use-plugin')
check('and the bare word is nobody\'s', parse('--use-plugin')?.kind === 'unknown')
// Named after the project rather than after what it does. `--update` is a
// generic verb, and a hook that answers one blocks the prompt — so asking Claude
// to update anything else would have been caught and answered with a version.
check('--pokemanion reports the version', parse('--pokemanion')?.kind === 'update')
check('--pokemanion add names a character', parse('--pokemanion add brock')?.name === 'brock')

// Which flags this project answers at all. A prompt that is only `--word` was
// always caught, so `--update`, `--force` and the rest were answered with a
// Pokemon roster and never reached the model. Now only words near a real name
// are — the suggestion is worth having, the interception is not.
{
  const { nearest, unregistered } = await import('./switch.mjs')
  const ours = (word) => Boolean(nearest(word) || unregistered(word))

  check(
    'a flag unlike any Pokemon is left alone',
    !ours('update') && !ours('force') && !ours('verbose') && !ours('dry-run'),
    ['update', 'force', 'verbose', 'dry-run'].filter(ours).join(' '),
  )

  check('but a near miss is still caught', ours('charizrd') && ours('pikchu'))
  check('and so is one that exists but was never drawn', ours('urshifu'))
}
check('and --update is not one of ours', parse('--update')?.kind === 'unknown')
check('--random rolls', parse('--random')?.kind === 'random')
check('--dex looks up', parse('--dex ghost')?.query === 'ghost')
// The argument is taken exactly as typed — one spelling to remember, not one
// plus a set of near-misses. The help lives in the failure instead.
check('--dex takes its argument verbatim', parse('--dex --current')?.query === '--current')
check('and keeps a trailing dash', parse('--dex pikachu-')?.query === 'pikachu-')

const { suggest } = await import('./switch.mjs')

// Every other command here is `--something`, so a dash on the argument is a
// habit rather than a misunderstanding, and `nothing matches "--current"` reads
// as a broken command. The suggestion is what makes strictness bearable.
check('a dashed argument is guessed at', suggest('--current') === '--dex current')
check('so is a dashed name', suggest('--pikachu') === '--dex pikachu')
// Silence beats a guess that leads to a second miss.
check('nonsense gets no guess', suggest('--zzznope') === null)
check('and a correct query needs none', suggest('current') === null)

// A correctly spelled Pokemon that was never drawn in Gen 5 is not a typo, and
// telling someone "no such one" invites them to try spelling it again.
const { unregistered } = await import('./switch.mjs')

check('a real but undrawn Pokemon is known as such', unregistered('urshifu')?.num === 892)
check('including one spelled with punctuation', unregistered('sirfetchd')?.num === 865)
check('nonsense is not mistaken for one', unregistered('zzznope') === null)
// The whole point of the list is that these are absent from the roster — if one
// ever gains a sprite it belongs in the dex, not in both places at once.
check(
  'and none of them is also summonable',
  !['urshifu', 'sirfetchd', 'chespin'].some((name) => isKnown(name)),
)

// Misspellings, which are the common case everywhere else.
const { nearest } = await import('./switch.mjs')

check('a typo finds its Pokemon', nearest('charizrd') === 'charizard')
// Dropped letters, which no safe edit-distance cap reaches: charzd is three
// edits from charizard but every letter of it is there, in order.
check('dropped letters find it too', nearest('charzd') === 'charizard')
check('and so does a heavily clipped name', nearest('squrtl') === 'squirtle')
// One edit from both Pichu and Pikachu; the resident is the better guess.
check('a tie goes to the resident', nearest('pikchu') === 'pikachu')
check('gibberish gets nothing', nearest('zzznope') === null)
check('and two letters are too few to guess from', nearest('pi') === null)

// The wrapper runs this against flags meant for Claude itself, so a false
// positive there talks over a real command. `--version` is two edits from
// Persian, which is why the outside check is capped at one.
const CLAUDE_FLAGS = ['resume', 'continue', 'print', 'model', 'help', 'version', 'verbose', 'debug', 'ide', 'settings', 'agents', 'fast', 'chrome', 'add-dir', 'session-id', 'fork-session', 'permission-mode', 'output-format', 'allowed-tools', 'max-turns', 'no-color', 'mcp-config']

check(
  `no Claude flag is mistaken for a Pokemon (${CLAUDE_FLAGS.length} checked)`,
  CLAUDE_FLAGS.every((flag) => nearest(flag, { maxEdits: 1 }) === null),
  CLAUDE_FLAGS.filter((flag) => nearest(flag, { maxEdits: 1 })).join(', '),
)
check('a sentence is left alone', parse('what does --pikachu do?') === null)

// Every path this writes into a shell command has to be quoted, because the
// repo may sit somewhere with a space in it — ~/Documents/My Projects is an
// ordinary place to put things. Unquoted, `claude --random` died with
// "no such file or directory: /Users/you/My" and the typo hint silently
// stopped working, while `claude --pikachu` kept working, which is the worst
// possible spread of symptoms to debug from.
{
  const { snippet } = await import('./shell.mjs')
  const { AGENTS: allAgents } = await import('./agents.mjs')
  // Explicit, because CI has no coding agent installed and detection would
  // return an empty list — the third time a test has quietly depended on what
  // happens to be on the machine running it.
  const text = snippet(allAgents)

  // Every occurrence of the repo path, and whether a quote sits immediately
  // before it. Matching on the path itself rather than on a shape — the first
  // attempt used a regex for "a slash not preceded by a quote", which matched
  // the middle of /Users/adbhut and reported four failures against correct code.
  const bare = []

  for (const file of [join(ROOT, 'bin', 'run.sh'), join(ROOT, 'assets', 'gen5-names.json')]) {
    let at = text.indexOf(file)

    while (at !== -1) {
      // A comment line is prose, not a command, and needs no quoting.
      const lineStart = text.lastIndexOf('\n', at) + 1

      if (text[at - 1] !== '"' && !text.slice(lineStart, at).trimStart().startsWith('#')) bare.push(file)

      at = text.indexOf(file, at + 1)
    }
  }

  check('every path in the shell wrapper is quoted', bare.length === 0, `${bare.length} bare: ${[...new Set(bare)].join(', ')}`)
  check('and the wrapper still references the launcher', text.includes(`"${join(ROOT, 'bin', 'run.sh')}"`))

  // Installed as a plugin, the project lives at a path carrying its version
  // number. A wrapper with that written into it works until the next release
  // moves the directory, and then goes on sitting in the shell file pointing at
  // nothing. The plugin wrapper resolves the path on each call instead.
  {
    const { isPluginRoot } = await import('./shell.mjs')
    const portable = snippet(allAgents, true)

    check(
      'a plugin wrapper hard-codes no path of its own',
      !portable.includes(ROOT) && portable.includes('pokemanion_root'),
      portable.includes(ROOT) ? 'the repo path is baked in' : '',
    )

    check('and a clone wrapper still does, its path being fixed', snippet(allAgents, false).includes(join(ROOT, 'bin', 'run.sh')))

    // Which of the two you get is decided by where the project is, and nothing
    // was checking that. Both cases above pass `portable` by hand, so pinning
    // the default to a constant broke real plugin installs and no test moved.
    check('and which one is written is decided by where the project is', snippet(allAgents) === snippet(allAgents, isPluginRoot()))

    check(
      'a versioned plugin directory is recognised as one',
      isPluginRoot('/Users/x/.claude/plugins/cache/pokemanion/pokemanion/1.1.0') &&
        isPluginRoot('/Users/x/.codex/plugins/cache/pokemanion/pokemanion/9.9.9') &&
        !isPluginRoot('/Users/x/pokemanion'),
    )
 
    // And it has to actually resolve, in a real shell, against a real directory
    // tree. Everything above checks the text of the wrapper; this checks that
    // the text works — sourcing it, running it, and reading what it chose.
    //
    // Two versions are planted because the interesting case is an upgrade: 1.10.0
    // must win over 1.9.0, which a plain sort gets backwards.
    {
      // Imported here rather than relied on from an outer scope. Three checks in
      // this file have already been silently dead from referring to a name that
      // was destructured further down.
      const { mkdtempSync, mkdirSync: makeDir, writeFileSync: put, chmodSync: chmod, rmSync: drop } = await import('node:fs')
      const { spawnSync: runShell } = await import('node:child_process')
      const { tmpdir: tempRoot } = await import('node:os')
      const home = mkdtempSync(join(tempRoot(), 'pokemanion-plugin-'))
      const cache = join(home, '.claude', 'plugins', 'cache', 'pokemanion', 'pokemanion')

      for (const version of ['1.9.0', '1.10.0']) {
        makeDir(join(cache, version, 'bin'), { recursive: true })
        put(join(cache, version, 'bin', 'run.sh'), `#!/bin/sh\necho ${version}\n`)
        chmod(join(cache, version, 'bin', 'run.sh'), 0o755)

        // The wrapper reads the roster to decide whether a flag is a resident,
        // so a plugin without one cannot resolve a name at all.
        makeDir(join(cache, version, 'src'), { recursive: true })
        put(join(cache, version, 'src', 'roster.mjs'), "export const ROSTER = [{ name: 'pikachu' }]\n")
      }

      const bin = join(home, 'bin')

      makeDir(bin, { recursive: true })
      put(join(bin, 'claude'), '#!/bin/sh\nprintf "%s" "${PIXEL_RUNNER_SPECIES:-none}"\n')
      chmod(join(bin, 'claude'), 0o755)

      const rc = join(home, '.zshrc')

      put(rc, `${snippet([{ name: 'claude' }], true)}\n`)

      // Whichever shell this machine has. Hard-coding zsh passed here and failed
      // on CI, which is Ubuntu and ships bash — the third test in this file to
      // have quietly assumed the machine it was written on. The wrapper is
      // supported on both, so either proves it; `sh` would not, since the
      // function uses arrays.
      const shell = ['zsh', 'bash'].find(
        (candidate) => runShell(candidate, ['-c', 'true'], { encoding: 'utf8' }).status === 0,
      )

      const ask = (line, env = {}) =>
        runShell(shell, ['-c', `source ${JSON.stringify(rc)} >/dev/null 2>&1; ${line}`], {
          encoding: 'utf8',
          env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, PIXEL_RUNNER_SPECIES: '', ...env },
        }).stdout ?? ''

      // A resident needs no plugin at all to resolve; --random has to run the
      // launcher, which is the part that has to find the right directory.
      check('a shell to test the wrapper in', Boolean(shell), shell ?? 'neither zsh nor bash on this machine')
      check('a plugin wrapper resolves a resident', ask('claude --pikachu').includes('pikachu'), shell)
      check('and reaches the newest version of the plugin', ask('claude --random').includes('1.10.0'), ask('claude --random'))

      // The plugin uninstalled. The wrapper must not become a broken `claude`.
      drop(join(home, '.claude'), { recursive: true, force: true })

      check('and passes everything through once the plugin is gone', ask('claude --resume').trim() === 'none', ask('claude --resume'))

      // The writer itself, which is what the plugin's first hook calls. Running
      // the hook here would open a real pane on whatever machine this is, so the
      // pane is left out and the file-writing is not.
      {
        const { install: writeWrapper } = await import('./shell.mjs')
        const rcHome = mkdtempSync(join(tempRoot(), 'pokemanion-rc-'))
        const target = join(rcHome, '.zshrc')

        put(target, '# something that was already here\n')

        const first = writeWrapper([{ name: 'claude' }], target)
        const once = readFileSync(target, 'utf8')
        const second = writeWrapper([{ name: 'claude' }], target)

        check(
          'installing the wrapper keeps what was already in the file',
          Boolean(first) && once.includes('# something that was already here') && once.includes('claude()'),
        )

        // Called on every session start, so a second run must be a no-op rather
        // than a second copy of the function or a backup of a backup.
        check(
          'and a second install changes nothing',
          second === null && readFileSync(target, 'utf8') === once && (once.match(/^claude\(\)/gm) ?? []).length === 1,
        )

        drop(rcHome, { recursive: true, force: true })
      }

      drop(home, { recursive: true, force: true })
    }
  }

  // The function itself runs under bash 3.2 — the version macOS ships — as well
  // as zsh; only the file it was written to was ever zsh-specific, which is why
  // this used to be documented as zsh-only.
  const { rcFile } = await import('./shell.mjs')
  const { mkdtempSync: rcTemp, writeFileSync: put, rmSync: drop } = await import('node:fs')
  const { tmpdir: temp } = await import('node:os')
  const bare2 = rcTemp(join(temp(), 'pokemanion-rc-'))
  const withBashrc = rcTemp(join(temp(), 'pokemanion-rc-'))

  put(join(withBashrc, '.bashrc'), '')

  // Intel Macs put Homebrew under /usr/local, Apple Silicon under
  // /opt/homebrew. run.sh has to know both, since it hunts for an interpreter
  // by absolute path when the PATH is trimmed. Only one file in the project
  // mentions an architecture-specific path at all, and this is it.
  {
    const { readFileSync: slurp } = await import('node:fs')
    const runner = slurp(join(ROOT, 'bin', 'run.sh'), 'utf8')

    check('run.sh knows the Apple Silicon brew path', runner.includes('/opt/homebrew/bin/node'))
    check('and the Intel one', runner.includes('/usr/local/bin/node'))
  }

  check('zsh installs into .zshrc', rcFile('/bin/zsh', bare2).endsWith('.zshrc'))
  check('bash installs into a bash file', rcFile('/bin/bash', bare2).endsWith('.bash_profile'))
  check('and prefers one that already exists', rcFile('/bin/bash', withBashrc).endsWith('.bashrc'))

  drop(bare2, { recursive: true, force: true })
  drop(withBashrc, { recursive: true, force: true })
}

// What a session was given, and getting it back.
//
// The bug this guards: the species was never stored, only recomputed from
// `hash(session) % choices.length`, and `choices` shrinks when a guest is
// evicted or another terminal opens. A pane that closed and reopened came back
// as a different Pokemon with nothing typed. Every rule below is one that had
// to keep working while that was fixed.
{
  const { chooseSpecies, speciesInUse } = await import('./companion.mjs')
  const { rememberSpecies, rememberedSpecies, forgetSession, assignments } = await import('./assigned.mjs')
  const { available } = await import('./roster.mjs')

  const id = 'smoke-assigned-0001'
  const on = { randomPokemon: true }

  // Two residents no live pane is holding, so the checks below are testing the
  // rules rather than colliding with whatever is on screen right now.
  const held = speciesInUse(id)
  const free = available().filter((name) => !held.has(name) && name !== 'pikachu')
  const [mine, other] = free

  try {
    check('a session starts with nothing remembered', (forgetSession(id), rememberedSpecies(id)) === null)

    // Rule 3 — unchanged. No ask, nothing remembered, so the rotation decides.
    const rotated = chooseSpecies(id, on, {})

    check('rotation still picks when nothing is known', typeof rotated === 'string' && rotated.length > 0, rotated)

    // Rule 2 — the fix. Remembered, free, so it comes back.
    rememberSpecies(id, mine, 'test')

    check('a remembered Pokemon comes back', chooseSpecies(id, on, {}) === mine, mine)

    // ...and it survives the list changing underneath it, which is the exact
    // thing that used to move the answer.
    check(
      'and survives the pool changing',
      chooseSpecies(id, on, {}) === mine && chooseSpecies(id, on, {}) === chooseSpecies(id, on, {}),
    )

    // Rule 1 — unchanged, and it has to outrank rule 2.
    check('an explicit ask still outranks it', chooseSpecies(id, on, { PIXEL_RUNNER_SPECIES: other }) === other, other)

    // The whole point of rule 1: naming one you can already see elsewhere.
    const somewhere = [...speciesInUse()][0]

    if (somewhere) {
      check(
        'a Pokemon already out elsewhere can still be summoned by name',
        chooseSpecies(id, on, { PIXEL_RUNNER_SPECIES: somewhere }) === somewhere,
        somewhere,
      )
    }

    // Every resident by name, not just whichever one a pane happens to hold.
    // The version of this test that sampled the live panes only caught Ash
    // being unresolvable at launch on the day a pane happened to be showing
    // him — a resident whose name is not a Pokemon's takes a different route
    // through `ensure` than the other twelve, and nothing was walking it.
    const unreachable = names().filter(
      (name) => chooseSpecies(`ask-${name}`, on, { PIXEL_RUNNER_SPECIES: name }) !== name,
    )

    check('every resident can be asked for by name at launch', unreachable.length === 0, unreachable.join(' '))

    // A guest is the case most worth remembering — you went and named it — and
    // the one that breaks if "is this still on disk" is asked of the resident
    // list, which is what `available()` is. That mistake restored every
    // resident correctly and sent every guest back to the rotation.
    const { fetchedGuests: guestsOnDisk } = await import('./roster.mjs')
    const [aGuest] = guestsOnDisk().filter((name) => !held.has(name))

    if (aGuest) {
      rememberSpecies(id, aGuest, 'test')

      check(`a remembered guest comes back too (${aGuest})`, chooseSpecies(id, on, {}) === aGuest)
    }

    // A name that is not on disk cannot be handed to the pane, which refuses to
    // draw a species whose files are missing.
    rememberSpecies(id, 'notarealpokemon', 'test')

    check('a remembered name that is gone falls back', chooseSpecies(id, on, {}) !== 'notarealpokemon')

    // Switching the whole thing off still means off.
    rememberSpecies(id, mine, 'test')

    check('randomPokemon:false still wins', chooseSpecies(id, { randomPokemon: false }, {}) === null)

    // And the record stays bounded rather than growing for every session ever.
    check('the record is an object, not a list', !Array.isArray(assignments()) && typeof assignments() === 'object')
  } finally {
    forgetSession(id)
  }

  check('the test session is cleaned up', rememberedSpecies(id) === null)

  // The other half of the same bug. Nothing touches a guest's last-used stamp
  // while it simply sits in a pane being looked at, so a window left open for
  // longer than guestKeepDays had its own sprite deleted underneath it.
  const { prune } = await import('./prune.mjs')
  const { fetchedGuests } = await import('./roster.mjs')
  const { speciesFileFor } = await import('./companion.mjs')

  // Not simply the first guest on disk. A pane running right now may be holding
  // it, and then the "is a stale guest still evicted?" half fails — correctly,
  // because the protection being tested is doing its job. Which made this pass
  // on CI, where nothing is running, and fail on the machine that has a pane
  // open. A test that depends on what is on screen is worse than no test.
  const [guest] = fetchedGuests().filter((name) => !held.has(name))

  if (guest) {
    const { writeFileSync, unlinkSync, mkdirSync } = await import('node:fs')
    const { STATE_DIR } = await import('./config.mjs')
    const claim = speciesFileFor('smoke-prune-0001')
    const gone = (result) => result.evicted.some((row) => row.name === guest)

    try {
      unlinkSync(claim)
    } catch {}

    const unheld = prune({ dry: true, keepDays: 0 })

    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(claim, guest)

    const held = prune({ dry: true, keepDays: 0 })

    try {
      unlinkSync(claim)
    } catch {}

    // Both directions, so this cannot pass by the pruner having stopped working
    // altogether and evicting nothing at all.
    check(`a stale guest is still evicted (${guest})`, gone(unheld))
    check('but not one a pane is showing', !gone(held))
  }

  // The `choose` line, which is the only record of a pick nobody asked for.
  // Checked by reading it back rather than by it not throwing, because it is
  // wrapped in the same catch-everything the rest of the hook path uses and
  // would fail completely silently.
  {
    const { logChoice } = await import('./companion.mjs')
    const { readFileSync } = await import('node:fs')
    const { STATE_DIR } = await import('./config.mjs')
    const log = join(STATE_DIR, 'hooks.jsonl')
    const before = (() => {
      try {
        return readFileSync(log, 'utf8').length
      } catch {
        return 0
      }
    })()

    // Forced on for the duration, so this tests the writing rather than
    // whatever `logHooks` happens to be set to on the machine running it.
    const was = process.env.PIXEL_RUNNER_LOG_HOOK

    process.env.PIXEL_RUNNER_LOG_HOOK = '1'
    logChoice('smoke-choose-0001', 'pikachu', 'remembered')

    if (was === undefined) delete process.env.PIXEL_RUNNER_LOG_HOOK
    else process.env.PIXEL_RUNNER_LOG_HOOK = was

    let row = null

    try {
      const written = readFileSync(log, 'utf8').slice(before).trim().split('\n').filter(Boolean)

      row = JSON.parse(written[written.length - 1])
    } catch {}

    check(
      'the choice is written to the hook log',
      row?.event === 'choose' && row.species === 'pikachu' && row.why === 'remembered' && row.session === 'smoke-choose-0001',
      row ? JSON.stringify(row) : 'nothing logged',
    )
  }
}

// The three files that run their work the moment they are loaded.
//
// `MODULES` above cannot reach any of them: importing one would perform its job
// — install the thing, write to your home directory, or in on-activity's case
// call process.exit and end this test run *reporting success*. So they were the
// only user-facing code with nothing but `node --check` behind them, and
// `node --check` is exactly the check that missed MIN_DELAY.
//
// Run as subprocesses instead, each against the safe path it already documents.
// That executes the real top-level code without importing it.
{
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, rmSync, readFileSync: read } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { sessionStateFile } = await import('./config.mjs')

  // Same spawn, but with arguments and a forced HOME — the agent-targeted
  // installs need both, and detection must never decide what a test exercises.
  const run2 = (file, args, home) =>
    spawnSync(process.execPath, [file, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home } })

  const run = (file, { input = '', env = {} } = {}) =>
    spawnSync(process.execPath, [file], {
      cwd: ROOT,
      input,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })



  // 1. The hook handler. Its whole body sits in `try { } catch {}` and then
  //    exits 0, so a ReferenceError in it is not a crash — every hook silently
  //    becomes a no-op that reports success, and the sprite just stops
  //    responding with nothing said anywhere. Exit code proves nothing here;
  //    the only proof is whether it did the work.
  const hookSession = 'smoke-hook-0001'
  const stateFile = sessionStateFile(hookSession)

  try {
    rmSync(stateFile, { force: true })
  } catch {}

  const hook = run('bin/on-activity.mjs', {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: hookSession }),
  })

  let wrote = null

  try {
    wrote = JSON.parse(read(stateFile, 'utf8'))
  } catch {}

  check(
    'the hook handler actually handles a hook',
    hook.status === 0 && wrote?.state === 'idle',
    wrote ? `state=${wrote.state}` : 'wrote no state — it exits 0 even when it does nothing',
  )

  // Every lifecycle event, under both agents' names for them. The one that
  // differs is the waiting state: Claude calls it Notification, Codex calls it
  // PermissionRequest, and getting it wrong means the sprite runs while the
  // agent sits on an unanswered question.
  {
    // SessionStart is deliberately not in this list.
    //
    // It is the one event that opens a pane, and the handler under test is the
    // real one — so including it made `npm test` split a live terminal and
    // leave a sprite running. Two of them were sitting on screen before anyone
    // noticed, alongside the real sessions. A test suite that spawns windows on
    // the machine running it is worse than a slightly smaller test suite.
    //
    // Nothing is lost: SessionStart shares the idle branch with Stop, which is
    // covered, and the pane-opening path is exercised by the real agents rather
    // than by pretending to be one.
    const states = [
      ['UserPromptSubmit', 'working'],
      ['PreToolUse', 'working'],
      ['PostToolUse', 'working'],
      ['Stop', 'idle'],
      ['Notification', 'waiting'],
      ['PermissionRequest', 'waiting'],
    ]
    const lifecycle = 'smoke-lifecycle-0001'
    const wrong = []

    for (const [event, want] of states) {
      run('bin/on-activity.mjs', { input: JSON.stringify({ hook_event_name: event, session_id: lifecycle }) })

      let got = null

      try {
        got = JSON.parse(read(sessionStateFile(lifecycle), 'utf8')).state
      } catch {}

      if (got !== want) wrong.push(`${event}: ${got} not ${want}`)
    }

    check(`every lifecycle event maps to a state (${states.length} checked)`, wrong.length === 0, wrong.join(', '))
    rmSync(sessionStateFile(lifecycle), { force: true })
  }

  try {
    rmSync(stateFile, { force: true })
  } catch {}

  // 1b. Where each --dex answer goes. `current` describes the Pokemon already
  //     on screen, so it belongs beside it; everything else, `random` included,
  //     belongs in the conversation. Both used to answer in both places, which
  //     made `current` a slower way of getting the same wall of text.
  {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { STATE_DIR } = await import('./config.mjs')
    const dexSession = 'smoke-dex-0001'
    const card = join(STATE_DIR, `window-${dexSession}.card`)

    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(join(STATE_DIR, `window-${dexSession}.species`), 'pikachu')
    rmSync(card, { force: true })

    const ask = (prompt) =>
      run('bin/on-activity.mjs', {
        input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: dexSession, prompt }),
      })

    const current = ask('--dex current')
    const inPane = (() => {
      try {
        return read(card, 'utf8')
      } catch {
        return ''
      }
    })()

    // One line in the conversation, not the card. "no." is a field of the card
    // itself, so its absence is what proves the stats did not go to both.
    check(
      '--dex current answers in the pane',
      /pikachu/i.test(inPane) && current.stderr.trim().split('\n').length === 1 && !/no\./.test(current.stderr),
      current.stderr.trim().slice(0, 60),
    )

    const before = inPane
    const random = ask('--dex random')
    const afterRandom = (() => {
      try {
        return read(card, 'utf8')
      } catch {
        return ''
      }
    })()

    check(
      '--dex random answers in the conversation and leaves the pane alone',
      /no\./.test(random.stderr) && afterRandom === before,
      afterRandom === before ? 'pane untouched' : 'pane was overwritten',
    )

    // The plugin hello: once, then never. Once is a useful message; twice is a
    // hook that eats every prompt you send. Two things make it once — marking it
    // spent before printing rather than after, and a separate "spent" file so
    // that clearing the "owed" one cannot re-arm it on the next hook.
    {
      const greetSession = 'smoke-greet-0001'
      const owed = join(STATE_DIR, 'greet')
      const spent = join(STATE_DIR, 'greeted')
      const nodePath = join(STATE_DIR, 'node-path')
      const hadNodePath = existsSync(nodePath) ? read(nodePath, 'utf8') : null

      // Nothing is planted but the conditions: no record of a setup having run,
      // and no record of having said hello. Arming it by hand would test the
      // printing and skip the part that decides whether to.
      mkdirSync(STATE_DIR, { recursive: true })
      rmSync(owed, { force: true })
      rmSync(spent, { force: true })
      rmSync(nodePath, { force: true })

      const say = (prompt) =>
        run('bin/on-activity.mjs', {
          input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: greetSession, prompt }),
        })

      const first = say('an ordinary question')
      const second = say('an ordinary question')

      check(
        'the plugin hello blocks one prompt and then never again',
        first.status === 2 && /Accessibility/.test(first.stderr) && second.status === 0 && !/Accessibility/.test(second.stderr),
        `first exit ${first.status}, second exit ${second.status}`,
      )

      // Left spent rather than cleared. Anything after this that drives a prompt
      // through the real handler would otherwise have it eaten — which is what
      // happened on CI, where a fresh checkout has no node-path and the hello
      // armed itself for tests that were not expecting it.
      rmSync(owed, { force: true })
      writeFileSync(spent, 'smoke')
      rmSync(sessionStateFile(greetSession), { force: true })
      if (hadNodePath !== null) writeFileSync(nodePath, hadNodePath)
    }

    // Summoning something not yet downloaded must not go to the network.
    //
    // A hook is given five seconds. Fetching a guest takes three to five, and
    // `--random` used to try five candidates in a row, which measured at
    // fourteen. Claude Code kills a hook that overruns and discards its output,
    // so `--kyogre` looked like a command that did nothing at all — twice —
    // before working on the third attempt.
    //
    // The bound here is generous on purpose: it is not measuring speed, it is
    // asking whether anything downloads. Synchronous fetching cannot come back
    // in two seconds; the background version comes back in fifty milliseconds.
    {
      // A real name that is not on disk. Both halves matter: an invented one
      // would be answered with "no such one" and prove nothing about the
      // network, which is exactly what the first version of this test did.
      const { isFetched: onDisk, isKnown: exists } = await import('./roster.mjs')
      const cold = ['wishiwashi-school', 'necrozma-ultra', 'toxtricity-lowkey', 'sandslash-alola'].find(
        (name) => exists(name) && !onDisk(name),
      )

      if (cold) {
        const coldSession = 'smoke-cold-0001'
        const began = Date.now()
        const answered = run('bin/on-activity.mjs', {
          input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: coldSession, prompt: `--${cold}` }),
        })
        const took = Date.now() - began

        check(`summoning an undownloaded guest does not wait for the network (${cold})`, took < 2000, `${took}ms`)
        check('and answers rather than failing', answered.status === 2 && /fetching|it is/.test(answered.stderr), answered.stderr.trim().slice(0, 50))

        // Written even though the files are not there yet. The pane ignores a
        // claim it cannot draw and picks it up when the download rewrites it.
        let claimed = ''

        try {
          claimed = read(join(STATE_DIR, `window-${coldSession}.species`), 'utf8').trim()
        } catch {}

        check('and claims it immediately, for the pane to find later', claimed === cold, claimed)

        rmSync(join(STATE_DIR, `window-${coldSession}.species`), { force: true })
        rmSync(sessionStateFile(coldSession), { force: true })
      }
    }

    // Naming the one on screen is the same question as `--dex current`, and used
    // to be answered somewhere else entirely just because it was asked by name.
    // Naming a different one still belongs in the conversation — a card in the
    // pane captions the sprite under it, or it is a lie.
    rmSync(card, { force: true })

    const byName = ask('--dex pikachu')
    const namedPane = (() => {
      try {
        return read(card, 'utf8')
      } catch {
        return ''
      }
    })()

    check(
      'naming the one on screen answers in the pane too',
      /pikachu/i.test(namedPane) && byName.stderr.trim().split('\n').length === 1,
      byName.stderr.trim().slice(0, 60),
    )

    rmSync(card, { force: true })

    const other = ask('--dex dragonite')
    const otherPane = (() => {
      try {
        return read(card, 'utf8')
      } catch {
        return ''
      }
    })()

    check(
      'naming a different one still answers in the conversation',
      /no\./.test(other.stderr) && otherPane === '',
      otherPane === '' ? 'pane untouched' : 'captioned the wrong Pokemon',
    )

    rmSync(card, { force: true })
    rmSync(join(STATE_DIR, `window-${dexSession}.species`), { force: true })
  }

  // 1c. A half-finished download has to be able to say so.
  //
  //     `npm run roster` printed its per-entry results and exited 0 whatever
  //     happened, so with a failing network `npm run setup` ticked "downloading
  //     sprites ✓" and went on to report the whole install finished — leaving a
  //     pane that opens onto sprites that were never fetched.
  //
  //     Tested by taking one resident's files away and putting them back, with
  //     curl stubbed out so nothing can quietly re-download them mid-test.
  {
    const { renameSync, mkdtempSync: tempDir, writeFileSync: write, chmodSync } = await import('node:fs')
    const { idleFile, busyFile, ROSTER: roster } = await import('./roster.mjs')
    const victim = roster.find((row) => existsSync(idleFile(row.name)) && !row.idle)?.name
    const stub = tempDir(join(tmpdir(), 'pokemanion-nocurl-'))

    write(join(stub, 'curl'), '#!/bin/sh\nexit 6\n')
    chmodSync(join(stub, 'curl'), 0o755)

    if (victim) {
      const moved = join(stub, 'idle.gif')

      renameSync(idleFile(victim), moved)

      try {
        const broke = spawnSync(process.execPath, ['src/roster.mjs'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${stub}:${process.env.PATH}` },
        })

        check(`a failed download exits non-zero (${victim})`, broke.status === 1, `exit ${broke.status}`)
      } finally {
        renameSync(moved, idleFile(victim))
      }
    }

    const fine = spawnSync(process.execPath, ['src/roster.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${stub}:${process.env.PATH}` },
    })

    check('and exits zero when everything is present', fine.status === 0, `exit ${fine.status}`)

    rmSync(stub, { recursive: true, force: true })
  }

  // 1d. A pane that outlives the session that opened it.
  //
  //     Opening one takes a second or two — split the terminal, type a command,
  //     boot node — and for that stretch the pane exists with no pid file. A
  //     session ending inside that window found nothing to kill and returned,
  //     and the pane finished starting with nobody left to own it: a sprite for
  //     a session that no longer exists, holding a Pokemon it never released.
  //     That is how a second Pikachu appears beside a Gengar.
  //
  //     closeWindow leaves a note when it has no pid to signal. This is that
  //     note being honoured by a pane that starts afterwards.
  {
    const { closeWindow, closedFileFor } = await import('./companion.mjs')
    const orphan = 'smoke-orphan-0001'

    rmSync(closedFileFor(orphan), { force: true })
    closeWindow(orphan)

    check('closing a pane that has not started yet leaves a note', existsSync(closedFileFor(orphan)))

    const started = spawnSync(process.execPath, ['src/window.mjs', '4', `--session=${orphan}`], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 8000,
      env: { ...process.env, TERM: 'dumb' },
    })

    check('and a pane starting later reads it and exits', started.status === 0, `exit ${started.status}`)
    check('and the note is cleared afterwards', !existsSync(closedFileFor(orphan)))

    rmSync(closedFileFor(orphan), { force: true })
    const { STATE_DIR: sd } = await import('./config.mjs')
    rmSync(join(sd, `window-${orphan}.pid`), { force: true })
  }

  // 2. The installer, on the one path that is safe to run: a missing
  //    prerequisite. With no PATH there is no chafa, so it must stop at the
  //    preflight having written nothing. This is the promise the file makes in
  //    its own output, so the test is that promise rather than a restatement of
  //    the implementation.
  const blocked = run('src/setup.mjs', { env: { PATH: '' } })

  check(
    'setup stops on a missing prerequisite without touching anything',
    blocked.status === 1 && /nothing was changed/.test(blocked.stdout ?? ''),
    `exit ${blocked.status}`,
  )

  // 3. install.mjs edits ~/.claude/settings.json, which makes it the one file
  //    here worth testing most and the one hardest to test safely. homedir()
  //    honours $HOME, so pointing that at a scratch directory gives it a real
  //    settings file to edit that is not yours. Install then uninstall, because
  //    the half that breaks quietly is the removal: it matches our hooks by
  //    looking for 'pixel-runner' in the command, and leaving one behind means
  //    a hook firing at a file that no longer exists.
  const home = mkdtempSync(join(tmpdir(), 'pokemanion-smoke-'))

  // This used to stub build/frames.json, because install.mjs refused to run
  // without it. That guard is gone — it demanded a build for the status line,
  // which is not installed any more — and with it goes the reason a fresh clone
  // could not be installed at all.
  try {
    // The same shape install.mjs recognises: our launcher plus one of our
    // scripts. Counting by the old 'pixel-runner' string would have made this
    // test agree with the bug — it only ever matched because the development
    // folder happens to carry the project's old name.
    const ours = (settings) =>
      Object.values(settings.hooks ?? {})
        .flat()
        .filter((group) =>
          (group?.hooks ?? []).some(
            (hook) => String(hook?.command ?? '').includes('run.sh') && String(hook?.command ?? '').includes('on-activity.mjs'),
          ),
        ).length

    // Codex registers the same hooks in a file of its own. Everything else
    // about it is identical — same event names, same JSON on stdin, same field
    // names — which is why bin/on-activity.mjs serves both unchanged.
    {
      const codexHome = mkdtempSync(join(tmpdir(), 'pokemanion-codex-'))

      try {
        const wrote = spawnSync(process.execPath, ['install.mjs', '--codex'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, HOME: codexHome },
        })
        const file = join(codexHome, '.codex', 'hooks.json')
        const document = JSON.parse(read(file, 'utf8'))
        const events = Object.keys(document.hooks ?? {})

        check('codex hooks land in ~/.codex/hooks.json', wrote.status === 0 && events.length === 7, events.length + ' events')
        // Claude calls it Notification; Codex calls it PermissionRequest. Both
        // mean "waiting on you", and registering the wrong one means the sprite
        // runs while the agent sits on a question.
        check('and use PermissionRequest, not Notification', events.includes('PermissionRequest') && !events.includes('Notification'))
        // Codex has no spinner to theme, and an unknown key in its hooks file
        // would be rude at best.
        check('and carry no spinner verbs', !document.spinnerVerbs)

        const gone = spawnSync(process.execPath, ['install.mjs', '--codex', '--uninstall'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, HOME: codexHome },
        })

        check('and come back out again', gone.status === 0 && !JSON.parse(read(file, 'utf8')).hooks)

        // Codex's hooks file may already be somebody else's. Ours go in beside
        // theirs, survive being installed twice, and leave theirs behind when
        // removed — the same contract as Claude's settings.json, which holds far
        // more than hooks and has always been treated carefully.
        const { writeFileSync: put } = await import('node:fs')

        put(
          file,
          JSON.stringify({
            description: 'theirs',
            hooks: { Stop: [{ hooks: [{ type: 'command', command: '/opt/theirs/notify.sh' }] }] },
          }),
        )

        const theirs = () => {
          const doc = JSON.parse(read(file, 'utf8'))

          return {
            them: Object.values(doc.hooks ?? {}).flat().filter((g) => JSON.stringify(g).includes('/opt/theirs')).length,
            us: Object.values(doc.hooks ?? {}).flat().filter((g) => JSON.stringify(g).includes('on-activity.mjs')).length,
            note: doc.description,
          }
        }

        spawnSync(process.execPath, ['install.mjs', '--codex'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: codexHome } })
        spawnSync(process.execPath, ['install.mjs', '--codex'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: codexHome } })

        const after = theirs()

        check("another tool's codex hooks survive ours", after.them === 1 && after.us === 7 && after.note === 'theirs', JSON.stringify(after))

        spawnSync(process.execPath, ['install.mjs', '--codex', '--uninstall'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, HOME: codexHome },
        })

        const left = theirs()

        check('and are still there after ours are removed', left.them === 1 && left.us === 0, JSON.stringify(left))
      } catch (error) {
        check('codex install', false, error.message.split('\n')[0])
      } finally {
        rmSync(codexHome, { recursive: true, force: true })
      }
    }

    const installed = run2('install.mjs', ['--claude'], home)
    const after = JSON.parse(read(join(home, '.claude', 'settings.json'), 'utf8'))

    check('install registers its hooks', installed.status === 0 && ours(after) > 0, `${ours(after)} hooks`)

    const removed = run2('install.mjs', ['--claude'], home)
    const cleaned = JSON.parse(read(join(home, '.claude', 'settings.json'), 'utf8'))

    // Re-running must not stack a second copy — that is what `withoutOurs` is
    // for, and a duplicate would fire every hook twice.
    check('and does not add them twice', removed.status === 0 && ours(cleaned) === ours(after), `${ours(cleaned)} hooks`)

    const uninstalled = run2('install.mjs', ['--claude'], home)

    // `--uninstall` is passed by argv, not env, so it needs its own spawn.
    const gone = spawnSync(process.execPath, ['install.mjs', '--claude', '--uninstall'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    })
    const emptied = JSON.parse(read(join(home, '.claude', 'settings.json'), 'utf8'))

    check('uninstall removes every one of them', gone.status === 0 && ours(emptied) === 0, `${ours(emptied)} left`)

    void uninstalled
  } catch (error) {
    check('install.mjs runs against a scratch HOME', false, error.message.split('\n')[0])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }

  // The Ghostty keybind. Without it the split opens and is never collapsed, so
  // the pane arrives at half the window height — which looks like a layout bug
  // rather than a missing line of config, and is what everyone but the machine
  // this was built on actually got.
  //
  // Run as a subprocess for the same reason as the rest: CONFIG is resolved
  // from homedir() at import time, so only a child process can be pointed
  // somewhere safe.
  const ghosttyHome = mkdtempSync(join(tmpdir(), 'pokemanion-ghostty-'))

  try {
    const config = join(ghosttyHome, '.config', 'ghostty', 'config')
    const ghostty = (...args) =>
      spawnSync(process.execPath, ['src/ghostty.mjs', ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, HOME: ghosttyHome },
      })

    ghostty('--install')

    const written = (() => {
      try {
        return read(config, 'utf8')
      } catch {
        return ''
      }
    })()

    check(
      'the Ghostty resize keybind is written',
      /resize_split:down,2000/.test(written),
      written ? 'written' : 'no config file created',
    )

    ghostty('--install')

    const twice = read(config, 'utf8')
    const count = (twice.match(/resize_split:down/g) ?? []).length

    check('and not written twice', count === 1, `${count} copies`)

    ghostty('--remove')

    const left = read(config, 'utf8')

    check('and can be removed again', !/resize_split:down/.test(left), left.trim() ? 'other lines kept' : 'empty')

    // A config that already has the keybind — added by hand, as it was here —
    // must be left exactly alone rather than gaining a second copy.
    const { mkdirSync, writeFileSync } = await import('node:fs')

    mkdirSync(dirname(config), { recursive: true })
    writeFileSync(config, 'keybind = super+ctrl+shift+arrow_down=resize_split:down,2000\nkeybind = super+ctrl+shift+arrow_up=resize_split:up,2000\n')

    const before = read(config, 'utf8')

    ghostty('--install')

    check('a hand-written keybind is left alone', read(config, 'utf8') === before)
  } finally {
    rmSync(ghosttyHome, { recursive: true, force: true })
  }
}

// Every sprite the README shows has to be committed, or the gallery is broken
// images for anyone who clones. The residents' sprites are tracked by an
// explicit list in .gitignore, and nothing else would notice it drifting out of
// step with the roster.
try {
  const { execSync } = await import('node:child_process')
  const tracked = new Set(execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n'))
  // `idleFile` already returns an absolute path. Passing it through join(ROOT,
  // ...) produced a path under the repo *twice over*, which never exists — so
  // the list came back empty and the check passed having examined nothing.
  const shown = ROSTER.filter((entry) => existsSync(idleFile(entry.name)))

  const untracked = shown
    .flatMap((entry) => [idleFile(entry.name), busyFile(entry.name)])
    .map((file) => file.replace(`${ROOT}/`, ''))
    .filter((file) => !tracked.has(file))

  // Counted, so it cannot pass by looking at nothing.
  check(
    `every resident sprite is committed (${shown.length} checked)`,
    shown.length === ROSTER.length && untracked.length === 0,
    untracked.join(', '),
  )
} catch {
  // Not a git checkout; nothing to verify.
}

// Every asset named anywhere still exists.
const assets = readdirSync(join(ROOT, 'assets')).filter((file) => /\.(gif|png)$/.test(file))

check('assets present', assets.length > 0, `${assets.length} files`)

const failed = results.filter((result) => !result.ok)

for (const result of results) {
  if (!result.ok) console.log(`  FAIL  ${result.name}${result.detail ? `  ${result.detail}` : ''}`)
}

console.log(`\n  ${results.length - failed.length}/${results.length} checks passed\n`)

process.exit(failed.length ? 1 : 0)
