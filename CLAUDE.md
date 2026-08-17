# pokemanion

A Pokémon lives in a terminal pane beside every Claude Code or Codex session. It
rests while the agent is waiting on you and animates while it is working, so you
can tell what a session is doing from across the room without reading the screen.

16 ship with it, 1242 more can be summoned by name, and there is a Pokédex.

**macOS + Ghostty only.** It draws sprites using the kitty graphics protocol and
opens the split by driving Ghostty through AppleScript. It needs `chafa`
(`brew install chafa`) and Ghostty in `/Applications`.

## If the user wants to install it

The quickest route is the plugin, which registers the hooks and needs no clone:

    /plugin marketplace add khatriadbhut/pokemanion
    /plugin install pokemanion@pokemanion

It cannot install Ghostty — a GUI app that asks for a password — but it does
everything else the clone does, including chafa and the `claude --pikachu`
shell wrapper. Clone it only to work on the code:

    git clone https://github.com/khatriadbhut/pokemanion.git
    cd pokemanion

If `chafa` or Ghostty are missing, run **`npm run deps`** first — it installs
both via Homebrew. Then run **`npm run setup`**, which is the whole install: it
checks the prerequisites, downloads the sprites, renders them, registers the
hooks for whichever agents it finds — Claude Code, Codex, or both — adds the
matching shell wrapper, and sets the Ghostty resize keybind the pane needs.
Safe to run more than once.

Then tell them the things the script cannot do for them:

1. **Switch it on.** A clone's hooks are read when the agent starts, so restart
   it. A plugin does not need that: `/reload-plugins` loads them into the session
   you are already in. Either way the pane opens with the next session, or right
   now if they type `--pikachu`.
2. **Restart Ghostty** — it reads its config at startup.
3. **Open a new terminal**, or `source ~/.zshrc`.
4. **System Settings → Privacy & Security → Accessibility → enable Ghostty.**
   Opening a split means pressing keys, and macOS blocks that until allowed.
   Without it no pane appears at all.
5. **Trust the hooks when Codex asks**, and run `/hooks` inside Codex after any
   update to this project. It hashes each hook and skips the ones it has not
   reviewed, silently, so the sprite just stops reacting.

If it fails, `npm run doctor` checks every piece individually and says which one
is unhappy. `npm run uninstall-statusline` and `npm run shell -- --remove` undo
the two things that touch files outside this repo.

## A difference between the two agents

On Claude Code the pane appears when the session starts. On Codex it appears on
the **first message** — Codex does not consider a session to exist until then
and has no earlier hook, so this is not something to fix.

## Using it

Typed at Claude, mid-session — a hook answers these and blocks the prompt, so
they reach no model and cost no tokens:

- `--squirtle` — switch the pane to any of the 1258, live
- `--random`, `--pokemon` — roll one, or list the residents
- `--dex dragonite`, `--dex ghost`, `--dex random` — look things up, answered in chat
- `--dex current` — the one on screen, answered **in the pane** rather than in chat.
  Naming that same one (`--dex ash` with Ash in the pane) is the same question and
  answers in the same place. Naming a different one stays in chat.

Send them while Claude is **idle**. Text typed while a turn is already running
never fires the hook — Claude Code folds it into the running turn — so it
reaches the model as an ordinary message and the pane does not change.

At launch, via the shell wrapper: `claude --pikachu`, `claude --random`,
`claude --resume --charizard`.

## If the user wants to add a character

They may type `--pokemanion add brock`, which blocks nothing and simply hands
you this job with the questions to ask. Or they may just say it in words. Either
way the instructions are in `skills/adding-a-character/SKILL.md`, which the
plugin ships to both agents and `npm run setup` links in for a clone.

The short version:

```sh
npm run add -- <name> <resting> <working> [--resting=0-8] [--working=12-17] [--halo]
```

One command does all of it: prepares the art, copies it into `assets/`, writes
the roster entry, regenerates the gallery, every count and the credits, and
stages the files. Then they open a new session — a running pane predates the
entry and cannot know about it.

Your part is the judgement the command cannot make:

1. **Look at the files first.** Decode them and say how many frames each has and
   how big they are. A working half of one frame will barely move, and every
   attempt here to animate a still has been reverted.
2. **If it is a sheet, find the ranges.** Render the frames and read them —
   a four-direction walk is usually front, side, back, side. Pass them as
   `--resting=` and `--working=`.
3. **Render it at the size the pane draws** — about 68 pixels tall — and look at
   it before committing. Measurements have been wrong here twice; looking has
   not.
4. **`--halo` only if the art is a blurry upscale.** It removes every pale
   colourless pixel, which is right for a white-outlined sprite and blinds one
   with white eyes.
5. **Write the card if they are not a Pokémon.** The command leaves `blurb` and
   `pane` empty in `src/roster.mjs`; the bundled dex has no people in it, so
   nothing else can answer `--dex brock`.

Then `npm test`. It checks the sprites are committed, the counts match and the
cards fit the pane.

Not available to plugin users: it edits `src/roster.mjs`, and the plugin's copy
is version-stamped and replaced on the next update.

## Releasing

Bump the version in **four** files — `package.json`, `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, and both places in `.claude-plugin/marketplace.json`.
`npm test` fails if they disagree.

This matters more than it looks: the plugin cache is version-stamped and
`plugin update` compares versions, so a version that never moves leaves
installed copies on old code. It sat at 1.1.0 for 31 commits.

## Working on the code

- `npm test` — the smoke suite, and the bar for a change being finished.
- `npm run watch` — prints the working/waiting decision the pane is making, live.
- Two docs carry the reasoning, and are worth reading before changing behaviour:
  [docs/developer.md](docs/developer.md) to work on it,
  [docs/design.md](docs/design.md) for why it is built this way, and
  [docs/known-issues.md](docs/known-issues.md) for what is deliberately wrong.
- The pane is a long-lived process. Editing a file changes nothing about a pane
  already drawing — that has cost real time more than once.
