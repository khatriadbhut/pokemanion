# pokemanion

A Pokémon lives in a terminal pane beside every Claude Code or Codex session. It
rests while the agent is waiting on you and animates while it is working, so you
can tell what a session is doing from across the room without reading the screen.

17 ship with it, 1241 more can be summoned by name, and there is a Pokédex.

**macOS and Linux, in any terminal.** Two questions, and both now have an
answer everywhere: how the pane is opened, and how the sprite is drawn in it.
`chafa` is required for the second one; there is no other dependency.

**Opening it** — `src/launcher.mjs`, tried in this order, first match wins:

| you are in | the pane is | needs |
| --- | --- | --- |
| **tmux** | a split, in any terminal | nothing |
| **WezTerm** | a split | nothing |
| **kitty** | a split | `npm run kitty -- --install`, then restart kitty |
| **iTerm2** | a split | Automation permission, asked once |
| **Ghostty on macOS** — the tested setup | a split | Ghostty in `/Applications`, and Accessibility |
| **Ghostty on Linux** | its own strip window | nothing |
| **Terminal.app** | its own strip window | nothing |
| foot, konsole, gnome-terminal, xfce4-terminal, alacritty, xterm | its own strip window | nothing |

Each is detected on a variable its own terminal sets — `$TMUX`, `$WEZTERM_PANE`,
`$KITTY_LISTEN_ON`, `$TERM_PROGRAM`, `$TERM`. Never on a variable that is merely
exported, which is a bug this already had: `$GHOSTTY_RESOURCES_DIR` is inherited
by every shell started from a Ghostty and was still set inside a Terminal.app.

**Drawing it** — `src/graphics.mjs`. chafa has four output formats and the pane
asks the terminal which it wants, by sending the kitty graphics query and a
Primary Device Attributes request together and reading the reply:

| format | who gets it | note |
| --- | --- | --- |
| `kitty` | Ghostty, kitty, WezTerm, iTerm2 3.5+ | a frame is sent once and then referred to by id — 0.02MB against 35.9MB for four hundred draws |
| `sixels` | foot, Konsole, xterm with sixel, and tmux **only when the terminal it is attached to has sixel** | one image per frame |
| `iterm` | older iTerm2 | one image per frame |
| `symbols` | **everything else** | octants in truecolor, not pixels. What Terminal.app, Alacritty and GNOME Terminal draw instead of nothing |

**Inside tmux the reply is tmux's, not the terminal's.** Every tmux since 3.4 is
built with sixel support and says so in DA1 regardless of what it is attached
to, so the probe's answer has to be checked against `client_termfeatures` —
tmux's own account of the terminal on the other end. Believing DA1 alone left
the pane showing the literal text `SIXEL IMAGE (33x16)` and rows of `+` in
Ghostty, which is the setup everything else here is tested against. Unknown
counts as no: blocks are a Pokémon, an undeliverable sixel is nothing.

The probe needs a tty, so the pane does it and writes the answer down; `npm run
warm` and `npm run doctor` read that rather than asking again. With no tty and
nothing written down it guesses from `$TERM`. `npm run graphics` asks and says
what came back — run it *in* the terminal you are asking about. Override it all
with `graphicsFormat` in `config.json`.

Anything that changes those bytes is in the sprite cache key, so the four
formats cannot be handed each other's frames.

## If the user wants to install it

The quickest route is the plugin, which registers the hooks and needs no clone:

    /plugin marketplace add khatriadbhut/pokemanion

then, as a separate prompt — Claude Code joins a two-line paste into one line
and the first command swallows the second:

    /plugin install pokemanion@pokemanion

It cannot install a terminal — a GUI app that asks for a password — but it does
everything else the clone does, including chafa and the `claude --pikachu`
shell wrapper. Clone it only to work on the code:

    git clone https://github.com/khatriadbhut/pokemanion.git
    cd pokemanion

If `chafa` or a terminal is missing, run **`npm run deps`** first — on macOS it
installs both via Homebrew; on Linux it installs chafa through whichever of apt,
dnf, pacman, zypper or apk is there, and names the terminals rather than picking
one for you. Then run **`npm run setup`**, which is the whole install: it checks
the prerequisites, downloads the sprites, renders them, registers the hooks for
whichever agents it finds — Claude Code, Codex, or both — adds the matching
shell wrapper, and configures whichever terminal is going to open the pane.
Safe to run more than once.

Then tell them the things the script cannot do for them:

1. **Switch it on.** A clone's hooks are read when the agent starts, so restart
   it. A plugin does not need that: `/reload-plugins` loads them into the session
   you are already in. Either way the pane opens with the next session, or right
   now if they type `--pikachu`.
2. **Restart the terminal** — Ghostty and kitty both read their config at
   startup, and setup has just written to it. Nothing to restart in WezTerm,
   which needs no configuration.
3. **Open a new terminal**, or `source ~/.zshrc`.
4. **System Settings → Privacy & Security → Accessibility → enable Ghostty.**
   Opening a split means pressing keys, and macOS blocks that until allowed.
   Without it no pane appears at all. **Ghostty on macOS only** — every other
   terminal is handed the request over its own socket, which macOS has no
   opinion about, and telling a Linux user to open System Settings is the most
   confusing thing this project can say.
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
