# Working on pokemanion

For changing the code or adding sprites. If you only want to use it, the
[README](../README.md) is the whole story.

## Installing from a clone

The plugin is the one to use if you are not changing anything. Cloning puts the
project somewhere you can edit:

```sh
git clone https://github.com/khatriadbhut/pokemanion.git
cd pokemanion
npm run deps      # chafa and Ghostty — skip if you have them
npm run setup
```

`setup` finds what you have, **Claude Code, Codex, or both**, and sets up each
of them: sprites, hooks, the `claude()`/`codex()` shell wrapper, and the one
Ghostty keybind the pane needs. It checks everything first and stops without
touching a file if something is missing. Safe to run twice.

Then four things no script can do for you:

1. **Restart your agent** — both read their hooks at startup.
2. **Restart Ghostty** — it reads its config at startup.
3. **Open a new terminal**, or `source ~/.zshrc`.
4. **Allow Ghostty in Accessibility** — once, as above.

## Adding a character

`skills/adding-a-character/SKILL.md` is the long version, written for an agent.
The plugin ships it to both agents; a clone links it in with `npm run setup`, or
on its own:

```sh
npm run skill -- --install     # -> ~/.claude/skills, loaded next session
npm run skill -- --remove
```

Then ask Claude or Codex to add a character and it has the toolbox in front of
it, rather than being told about `npm run add` by you every time.

```sh
npm run add -- brock ~/Downloads/front.gif ~/Downloads/side.gif
npm run add -- brock sheet.gif sheet.gif --resting=0-8 --working=12-17 --halo
```

Two files, one command. It copies them into `assets/` under the next number,
writes the roster entry, regenerates the gallery, the counts and the credits,
and stages the art. A character that is not a Pokémon also gets a Pokédex card
to fill in, since the bundled dex has no people in it.

It prepares the art as well, because the useful files rarely arrive as two clean
animations:

| | |
| --- | --- |
| `--resting=0-8` | take those frames, for a sheet holding several directions |
| `--working=12-17` | the same for the working half |
| `--halo` | also lift the pale fringe a resampled upscale leaves behind |

A flat background is always keyed out, by filling in from the edges, so a white
card goes while a white shirt stays. `--halo` goes further and takes any pale
colourless pixel, including the pockets a fill cannot reach — say no if the
sprite has white in it, like eyes.

It says what it thinks of the art first: how many frames the working half has,
and whether either file was resampled rather than upscaled cleanly. Neither
stops the install — the pane is the only place to judge a sprite — but both have
sunk attempts here before.

Then open a new session. A pane already running was started before the entry
existed and cannot know about it.

## Adding a sprite

Any GIF works. Drop it in `assets/` and point a roster entry at it:

```js
// src/roster.mjs
{ name: 'meowth', busy: 'assets/18-meowth-jumping.gif', busySpeed: 1 },
```

Hand-picked files are never overwritten or re-downloaded. They replace the
default, which is the Pokémon's own shiny palette with a white flash between.

Judge a candidate at the size the pane draws, not at full size — a big smooth
render can shrink to mush while a small pixel-art one scales cleanly.
[docs/design.md](design.md) has the measurements.

Two tools for when an animation is nearly right: **`npm run recolour`** repaints
one palette to match another without re-encoding, and **`npm run flip`** mirrors
a sprite. Run `npm run attribution` after adding one.

<details>
<summary><b>Everything you can run</b></summary>

<br>

| command | what it does |
| --- | --- |
| `npm run doctor` | check every piece: hooks, chafa, cache, who holds what |
| `npm run watch` | print the working/waiting decision the pane is making, live |
| `npm run roster` | download any missing resident sprites (`-- --refresh` to redo) |
| `npm run warm` | render the residents for a pane height (`-- 5` for five rows) |
| `npm run deps` | install chafa and Ghostty (`-- --dry` to preview) |
| `npm run ghostty -- --install` | the resize keybind the pane needs (`--remove` to undo) |
| `npm run prune` | evict guests now (`-- --dry`, `-- --keep-days=0`) |
| `npm run assigned` | which Pokémon each session was given (`-- --forget` to reset) |
| `npm run dex` | the Pokédex from a terminal: `-- fire`, `-- 25`, `-- current` |
| `npm run attribution` | regenerate the credits (`-- --check` to fail if stale) |
| `npm run shell -- --install` | add the shell wrapper (`--remove` to undo) |
| `npm run install-statusline` | register the hooks (`uninstall-statusline` to undo) |
| `npm run window` | run a pane by hand, for debugging |
| `npm run recolour` | repaint a palette: `-- a.gif b.gif out.gif` |
| `npm run flip` | mirror a sprite: `-- in.gif out.gif` |
| `npm run crop` | cut one figure out of a sheet: `-- in.gif out.gif --find=3` |

The rest are tuning tools for working out what a terminal can draw:
`preview`, `compare`, `sizes`, `bakeoff`, `use`, `preset`, `fontcheck`,
`cellcheck`, and the `for-*` set. [docs/design.md](design.md) explains
them. **`preset` and the `for-*` tools write to `config.json`** instead of just
printing what they find.

</details>


## Testing

```sh
npm test
```

The suite is the bar for a change being finished. It runs the real hook handler
in subprocesses rather than mocking it, so a change that breaks a hook fails
here rather than in someone's terminal.

`npm run watch` prints the working/waiting decision the pane is making, live.

### What you cannot test without a real terminal

**The pane's rendering.** `chafa` asks the terminal about itself before it draws,
and waits for the answer. A real terminal replies immediately — 67ms for a frame.
A fake one never replies, so it blocks for seconds per frame and the pane looks
hung. Wrapping the pane in `script` to give it a pty does not help: `script`
provides the terminal device without anything behind it to answer.

So a pane under a fake terminal can only draw sprites that are already in the
cache. Anything it has to render will appear to hang, and the hang is the test
setup rather than the code. This cost most of a day once — the pane was read as
frozen four separate times when it was waiting on chafa waiting on nobody.

What can be tested without one: everything up to the drawing. Whether the claim
file is noticed, whether the files are found, which sprite is chosen. Instrument
a throwaway copy of `src/window.mjs` in `src/` — relative imports resolve there —
and read the log rather than the screen.

**A pane is only opened at the start of a session**, and by `--<name>` when none
is running. Nothing else brings one back, so a test that closes a pane and waits
for it to reappear is waiting for something that will not happen.

## Releasing

Bump the version in four files: `package.json`, `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, and both places in `.claude-plugin/marketplace.json`.
`npm test` fails if they disagree.

This matters more than it looks. The plugin cache is version-stamped and
`plugin update` compares versions, so a version that never moves leaves
installed copies on old code.

## More

- [design.md](design.md) — why it is built this way, and how a sprite is judged.
- [known-issues.md](known-issues.md) — where the working/waiting detection frays.

## Contributing

Issues and pull requests welcome, particularly:

- **A sprite that reads better than one in the roster.** Bring the numbers;
  [design.md](design.md) says which ones and what the bar is.
- **A Linux path.** Everything but the pane-opening is portable Node. It needs a
  way to open a split that is not AppleScript.

`npm test` before you push.
