<div align="center">

# pokemanion

**Your Pokémon companion for Claude Code and Codex.**

One lives in a pane beside every session: it rests while the agent waits, and
does something else while it works, so you can tell at a glance whether anything
is happening.

[![CI](https://github.com/khatriadbhut/pokemanion/actions/workflows/ci.yml/badge.svg)](https://github.com/khatriadbhut/pokemanion/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](package.json)
[![Agents](https://img.shields.io/badge/works%20with-Claude%20Code%20%2B%20Codex-8957e5.svg)](#quick-install)
[![Platform](https://img.shields.io/badge/tested%20on-macOS%20%2B%20Ghostty-lightgrey.svg)](#requirements)

</div>

<table>
<tr>
  <th align="left" width="16%">waiting</th>
  <th align="left" width="22%">working</th>
  <th align="left">&nbsp;</th>
</tr>
<tr>
  <td align="center"><img src="assets/14-charizard.gif" width="66" alt="Charizard standing"></td>
  <td align="center"><img src="assets/16-charizard-firing.gif" width="201" alt="Charizard working"></td>
  <td>Charizard breathes fire across the empty half of the pane.</td>
</tr>
<tr>
  <td align="center"><img src="assets/3-standing.gif" width="72" alt="Pikachu standing"></td>
  <td align="center"><img src="assets/9-pikachu-run.gif" width="94" alt="Pikachu working"></td>
  <td>Pikachu charges lightning in its cheeks, then runs.</td>
</tr>
<tr>
  <td align="center"><img src="assets/pokemon/psyduck/idle.gif" width="55" alt="Psyduck standing"></td>
  <td align="center"><img src="assets/12-psyduck-running.gif" width="121" alt="Psyduck working"></td>
  <td>Psyduck throws its arms about, headache and all.</td>
</tr>
<tr>
  <td align="center"><img src="assets/23-gengar.gif" width="89" alt="Gengar standing"></td>
  <td align="center"><img src="assets/25-gengar-attack.gif" width="202" alt="Gengar attacking"></td>
  <td>Gengar fires a shadow beam across the pane.</td>
</tr>
<tr>
  <td align="center"><img src="assets/27-ash-standing.gif" width="52" alt="Ash standing"></td>
  <td align="center"><img src="assets/28-ash-pikachu-running.gif" width="200" alt="Ash and Pikachu running"></td>
  <td>Ash waits, then runs off with Pikachu.</td>
</tr>
</table>

Sixteen hand-tuned residents ship with it. **1242 more** can be summoned by
name and are fetched on the spot.

<img src="assets/17-pokeball.gif" width="46" align="left" alt="a Pokeball opening">

A Pokéball opens whenever one arrives, and its stats appear beside it for a few
seconds. Everything is local: no account, no backend, nothing about you leaving
the machine.

<br clear="left">

---

## Quick install

**Get [Ghostty](https://ghostty.org/download) first** if you do not have it. The
pane is a Ghostty split. The other requirement, chafa, is fetched for you.

Then, at your agent:

<table>
<tr>
<td valign="top" width="50%">

**Claude Code**

```
/plugin marketplace add khatriadbhut/pokemanion
/plugin install pokemanion@pokemanion
```

</td>
<td valign="top" width="50%">

**Codex**

```
/plugin marketplace add khatriadbhut/pokemanion
/plugin add pokemanion@pokemanion
```

</td>
</tr>
</table>

Nothing to clone or build; the agent fetches the project itself and the sprites
ship with it. Three things are left:

- **Restart your agent, and Ghostty.** Do this first. Both read their
  configuration at startup, so until you do, nothing happens at all — the
  install reports success and then behaves exactly as if you had not run it.
- **Allow Ghostty in Accessibility** — System Settings → Privacy & Security →
  Accessibility. Skip it and everything installs perfectly and no pane ever
  appears.
- **Open a new terminal**, or `source ~/.zshrc`, which picks up `claude
  --pikachu`.

Already have it from source? Installing the plugin too is harmless. It stands
aside instead of doubling up, and tells you how to switch.

---

**[Requirements](#requirements) · [Commands](#commands) · [Codex](#using-it-with-codex)
· [Updating](#updating) · [Troubleshooting](#troubleshooting) · [Residents and
guests](#residents-and-guests) · [Settings](#settings) ·
[Working on it](docs/developer.md)**

<details>
<summary><b>All sixteen residents</b> — resting on the left, working on the right</summary>

<br>

<!-- gallery -->

| | resting | working |
| --- | :---: | :---: |
| **pikachu**<br><sub>own animation</sub> | <img src="assets/3-standing.gif" width="71" alt="pikachu resting"> | <img src="assets/9-pikachu-run.gif" width="94" alt="pikachu working"> |
| **ash**<br><sub>own animation</sub> | <img src="assets/27-ash-standing.gif" width="52" alt="ash resting"> | <img src="assets/28-ash-pikachu-running.gif" width="210" alt="ash working"> |
| **charmander**<br><sub>its shiny</sub> | <img src="assets/pokemon/charmander/idle.gif" width="68" alt="charmander resting"> | <img src="assets/pokemon/charmander/busy-shiny.gif" width="68" alt="charmander working"> |
| **brock**<br><sub>own animation</sub> | <img src="assets/32-brock-standing.gif" width="41" alt="brock resting"> | <img src="assets/33-brock-walking.gif" width="42" alt="brock working"> |
| **squirtle**<br><sub>its shiny</sub> | <img src="assets/pokemon/squirtle/idle.gif" width="64" alt="squirtle resting"> | <img src="assets/pokemon/squirtle/busy-shiny.gif" width="64" alt="squirtle working"> |
| **bulbasaur**<br><sub>its shiny</sub> | <img src="assets/pokemon/bulbasaur/idle.gif" width="81" alt="bulbasaur resting"> | <img src="assets/pokemon/bulbasaur/busy-shiny.gif" width="81" alt="bulbasaur working"> |
| **eevee**<br><sub>its shiny</sub> | <img src="assets/pokemon/eevee/idle.gif" width="69" alt="eevee resting"> | <img src="assets/pokemon/eevee/busy-shiny.gif" width="69" alt="eevee working"> |
| **munchlax**<br><sub>its shiny</sub> | <img src="assets/pokemon/munchlax/idle.gif" width="66" alt="munchlax resting"> | <img src="assets/pokemon/munchlax/busy-shiny.gif" width="66" alt="munchlax working"> |
| **haunter**<br><sub>its shiny</sub> | <img src="assets/pokemon/haunter/idle.gif" width="108" alt="haunter resting"> | <img src="assets/pokemon/haunter/busy-shiny.gif" width="108" alt="haunter working"> |
| **psyduck**<br><sub>own animation</sub> | <img src="assets/pokemon/psyduck/idle.gif" width="55" alt="psyduck resting"> | <img src="assets/12-psyduck-running.gif" width="121" alt="psyduck working"> |
| **jigglypuff**<br><sub>its shiny</sub> | <img src="assets/pokemon/jigglypuff/idle.gif" width="89" alt="jigglypuff resting"> | <img src="assets/pokemon/jigglypuff/busy-shiny.gif" width="89" alt="jigglypuff working"> |
| **charizard**<br><sub>own animation</sub> | <img src="assets/14-charizard.gif" width="67" alt="charizard resting"> | <img src="assets/16-charizard-firing.gif" width="204" alt="charizard working"> |
| **meowth**<br><sub>own animation</sub> | <img src="assets/pokemon/meowth/idle.gif" width="65" alt="meowth resting"> | <img src="assets/18-meowth-jumping.gif" width="70" alt="meowth working"> |
| **gengar**<br><sub>own animation</sub> | <img src="assets/23-gengar.gif" width="89" alt="gengar resting"> | <img src="assets/25-gengar-attack.gif" width="166" alt="gengar working"> |
| **cubone**<br><sub>own animation</sub> | <img src="assets/21-cubone.gif" width="85" alt="cubone resting"> | <img src="assets/22-cubone-swinging.gif" width="97" alt="cubone working"> |
| **misty**<br><sub>own animation</sub> | <img src="assets/34-misty-resting.gif" width="55" alt="misty resting"> | <img src="assets/35-misty-working.gif" width="44" alt="misty working"> |

<!-- /gallery -->

These animate. They are the sprite files themselves, not pictures of them.
Seven work as their own shiny, the same animation recoloured with a white flash
at the switch; seven were given animations of their own.

</details>

## Requirements

**Node ≥ 20** (no dependencies), **chafa**, and a terminal that speaks the
[kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/).
The sprite is a real image, not text.

| | draws the sprite | opens the pane | `claude --pikachu` |
| --- | :---: | :---: | :---: |
| **macOS + Ghostty** — the only tested setup | yes | yes | yes |
| macOS + kitty, iTerm2, WezTerm, Warp | yes | no | yes |
| Linux + kitty, Konsole | should | no | untested |
| Alacritty, Terminal.app, Windows | no | no | no |

Only the pane-opening is macOS-specific. It splits Ghostty using AppleScript.
Where the table says *no*, run the pane yourself in a second terminal with
`npm run window 4 --session=<id>`.

## Commands

Typed inside a session. pokemanion answers these itself and stops them there, so
they never reach the model and cost no tokens:

```
--squirtle          switch this pane, live
--random            roll one
--pokemon           list the residents

--dex               what you have, and how many exist
--dex dragonite     by name
--dex ghost         by type
--dex 149           by number
--dex current       the one you're looking at — answers in the pane
--dex random        be shown something

--pokemanion        the version, and how to update it
--pokemanion add <name>   hand your agent the job of adding one
--pokemanion use plugin   switch to the plugin, if you have both installed
```

**Send them while the agent is idle.** Sent mid-turn, they go to the model
instead.

Only a bare flag counts, so `what does --pikachu do?` passes through, as does
anything unlike a Pokémon's name: `--update`, `--force`. Typos get a "did you
mean". Forms work as written: `--ho-oh`, `--rotom-wash`.

At launch, from your terminal:

```sh
claude --pikachu             # a particular one
claude --flygon              # any of the 1258, fetched on first use
codex --random               # either agent, same flags
claude --resume --charizard  # combines with everything else
```

## Using it with Codex

<details>
<summary><b>Two things specific to Codex</b></summary>

<br>

**It will ask you to trust the hooks.** They are worth reading first, in
`~/.codex/hooks.json`. Codex silently skips any it has not reviewed, so after
updating this project, run **`/hooks`** in Codex and trust them again.

**The pane appears at your first message, not at launch.** Codex offers no
earlier hook. Claude Code opens it as soon as the session starts.

</details>

<details>
<summary><b>What it touches outside this folder</b></summary>

<br>

Every file is backed up before the first write, and every one comes back out:

| file | what goes in | undo |
| --- | --- | --- |
| `~/.claude/settings.json` | seven hooks | `npm run uninstall-statusline` |
| `~/.codex/hooks.json` | seven hooks | `npm run uninstall-statusline` |
| `~/.zshrc` | the `claude()`/`codex()` wrapper | `npm run shell -- --remove` |
| `~/.config/ghostty/config` | one resize keybind | `npm run ghostty -- --remove` |
| `~/.claude/skills/` | a link to the add-a-character skill | `npm run skill -- --remove` |

Only the agents you actually have are touched. Undo those, delete the folder,
and no trace is left.

</details>

## Updating

pokemanion checks GitHub once a day and tells you when there is a newer version.
Each route has its own command:

```
/plugin update pokemanion@pokemanion         # plugin, Claude Code
codex plugin marketplace upgrade &&          # plugin, Codex
  codex plugin add pokemanion@pokemanion
cd pokemanion && git pull && npm run setup   # from source
```

The pane's bottom edge carries the version, and the command when an update is
waiting. **`--pokemanion`** prints it in the conversation. Nothing is ever
installed for you.

`"updateCheck": false` stops the checks, `"showVersion": false` hides the corner.

## Troubleshooting

```sh
npm run doctor
```

It checks each piece on its own: hooks registered per agent, chafa present, the
frame cache matching your pane height, and which Pokémon are currently held. It
names whichever one is unhappy.

**A sprite that stutters** is the frame cache. Frames are rendered for one pane
height, so resizing leaves it rendering on the fly. `npm run warm -- <rows>`
fixes it.

**The sprite is wrong at the wrong moment.** `npm run watch` prints the decision
the pane is making and what it rested on.
[docs/known-issues.md](docs/known-issues.md) explains where it gets this wrong.
Pressing escape is the hard case, because no hook fires for it.

## Residents and guests

**Residents** are the 16 in `src/roster.mjs`: hand-tuned, always on disk,
pre-rendered so a session starts instantly, and the only ones the rotation hands
out.

**Guests** are the other 1242. Naming one for the first time takes a few seconds
while it downloads and renders; after that it is instant. The least recently
seen are evicted first, and one a pane is showing is never evicted.

Either way the session keeps it, so closing a window and coming back gives you
the same Pokémon. Naming one always overrules that.

```sh
npm run prune            # evict guests now; also happens on its own
npm run assigned         # what each session was given, and why
```

Guests are limited by `guestBudgetMb` (200) and `guestKeepDays` (14).

## Settings

`config.json`, all optional. The ones worth knowing:

| key | default | meaning |
| --- | --- | --- |
| `windowRows` | `4` | how tall the pane is |
| `idleAfterMs` | `20000` | transcript silence that counts as finished |
| `workingTimeoutMs` | `120000` | how long after the last hook we still count as working |
| `transitions` | `true` | animate the change between the two sprites |
| `pokeball` | `true` | open a Pokéball when one arrives |
| `cardMs` | `8000` | how long the stats stay beside the sprite; `0` disables |
| `guestBudgetMb` | `200` | disk the guests may hold |
| `updateCheck` | `true` | look for a newer version once a day, and say so once |
| `showVersion` | `true` | the version along the pane's bottom edge |
| `logHooks` | `false` | record every hook to `.state/hooks.jsonl` |

## Licence and artwork

The **code** is MIT. See [LICENSE](LICENSE).

The **artwork is not mine and is not covered by it.** The Gen-5 sprites are Game
Freak's; the hand-picked GIFs are fan art found online.
[ATTRIBUTION.md](ATTRIBUTION.md) names what came from where, and anything will
be removed on request. Sprites are read by path, so it is a one-line change.

Pokémon is a trademark of Nintendo. This is a personal tool, unaffiliated with
anyone, and nothing here is sold.

## Contributing

Issues and pull requests welcome, particularly a sprite that reads better than
one in the roster, or a Linux path. [docs/developer.md](docs/developer.md) is
where to start.
