// Which program opens the pane, and how it is asked.
//
// Everything else in this project is portable Node. The one macOS-shaped part
// was opening the pane: `openSplit` presses cmd-shift-D through System Events,
// because macOS does not let Ghostty be driven from the command line — `ghostty
// -e` answers "on macOS, launching the terminal emulator from the CLI is not
// supported". So the pane was a Ghostty split or it was nothing, and Linux had
// no route at all.
//
// The terminals that speak the kitty graphics protocol mostly do have a command
// line, and it is the same command line on both platforms. WezTerm splits a
// pane with `wezterm cli split-pane`; kitty does it with `kitty @ launch`;
// Ghostty on Linux — where the CLI is not refused — opens a window with
// `ghostty -e`. None of them needs AppleScript, an accessibility grant, or a
// keystroke landing on whatever happens to be focused.
//
// Three properties of this arrangement are worth stating, because they are the
// reasons it is shaped this way rather than as an if-else in openWindow:
//
//   - **A decision with no side effects.** `chooseLauncher` is handed the
//     platform, the environment and a way to ask whether a command exists, and
//     returns a description. It launches nothing. That is what lets the suite
//     test the rule against invented machines — a Linux with only kitty, a Mac
//     inside WezTerm — rather than against whatever this one happens to be.
//
//   - **macOS + Ghostty is untouched.** It is the only tested setup and the one
//     everybody is on, and it still goes through AppleScript. The CLI launchers
//     sit above it in the list, but each one requires the variable its own
//     terminal exports — $WEZTERM_PANE, $KITTY_LISTEN_ON — and neither is set in
//     a Ghostty. So a Ghostty session falls past both to exactly the path it
//     took before, and what the order actually buys is a Mac sitting in WezTerm
//     no longer having a Ghostty window open behind its back.
//
//   - **A split is aimed, not focused.** `wezterm cli split-pane` takes the
//     pane id out of $WEZTERM_PANE, and kitty matches on $KITTY_WINDOW_ID, so
//     the split happens where this session is rather than wherever the keyboard
//     is pointing. The Ghostty path cannot do that — a keystroke goes where the
//     focus is — and it is why opening a background agent used to cut whichever
//     window you were looking at in half.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'

// Asked once per launcher rather than shelling out for a table of every
// terminal that might exist. `command -v` and not `which`: which is not on
// every Linux, and on the ones that have it it is a different program with
// different exit codes.
export const have = (command) => spawnSync('command', ['-v', command], { shell: true, encoding: 'utf8' }).status === 0

// The other kind of "is it here": an application bundle rather than a command.
// Separate from `have` because they are different questions with different
// answers — /Applications/Ghostty.app can exist on a machine where `ghostty` is
// not on the PATH, which is the default macOS install.
export const appExists = (path) => existsSync(path)

// The pane, as arguments.
//
// Built here rather than in each launcher because it is the same invocation
// every time — the only thing that differs is who is asked to run it. There is
// one more copy of it in companion.mjs, spelled as a shell command string for
// the AppleScript path to type, and it is left there on purpose: that path is
// the one everybody is on, and rewriting a working keystroke to save a
// duplicated line is the wrong trade. Four callers would have been four copies,
// which is the number at which this stops being a matter of taste.
export const paneArgv = ({ rows, session, species = null, pending = null, execPath = process.execPath }) => [
  execPath,
  join(ROOT, 'src', 'window.mjs'),
  String(rows),
  `--session=${session}`,
  ...(species ? [`--species=${species}`] : []),
  ...(pending ? [`--pending=${pending}`] : []),
]

// How tall the terminal being split is, in cells.
//
// Only kitty needs it: its split is sized as a percentage of the space, where
// WezTerm takes a cell count outright. A hook's stdout is not always a TTY —
// it is a pipe when the agent is capturing it — so this falls back to $LINES
// and then to the terminal default of 24. Being wrong here makes the pane the
// wrong height, which the pane itself corrects on its first frame; being wrong
// in a way that throws would mean no pane at all.
export const terminalRows = (env = process.env, stdout = process.stdout) => {
  if (stdout?.isTTY && Number.isInteger(stdout.rows) && stdout.rows > 0) return stdout.rows

  const declared = Number(env.LINES)

  return Number.isInteger(declared) && declared > 0 ? declared : 24
}

// A percentage for kitty's --bias, from the cell count everything else uses.
//
// Clamped, because kitty rejects a bias outside 5-95 and a four-row strip in a
// hundred-row terminal rounds to 4. The floor costs a pane two rows too tall in
// a very tall window, which the sprite is drawn to fit; no floor costs the
// launch outright.
export const splitBias = (rows, total) => Math.max(5, Math.min(95, Math.round(((rows + 1) / Math.max(total, rows + 2)) * 100)))

// The launchers, in the order they are tried.
//
// `detect` answers "is this the terminal this session is sitting in, and is its
// command line here?" — both halves matter. Having WezTerm installed is not a
// reason to split a WezTerm window when the session is running in kitty, and a
// $WEZTERM_PANE inherited from a terminal that has since closed points at a
// pane that no longer exists. The environment variable is the session's, the
// binary is the machine's, and a launcher needs both.
// A shell command line, from argv.
//
// Only the launchers that go through AppleScript need this: `do script` and
// `write text` take a string to type, not a list to exec. Quoting is not
// optional here — this repo can sit at ~/Documents/My Projects/pokemanion, and
// unquoted that is two arguments and a pane that never starts.
export const shellJoin = (argv) =>
  argv.map((arg) => (/^[\w.,:=@%+\/-]+$/.test(arg) ? arg : `'${String(arg).replace(/'/g, `'\\''`)}'`)).join(' ')

// And an AppleScript string literal, which is not the same escaping. A
// backslash is a backslash inside one, so the shell quoting above has to
// survive being embedded in it.
const asString = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export const LAUNCHERS = [
  {
    name: 'tmux',
    label: 'tmux',

    // First in the list, above every terminal, because inside tmux the terminal
    // is not the thing that owns panes — tmux is. Splitting WezTerm from inside
    // a tmux session gives a WezTerm pane sitting next to the tmux one, outside
    // the session, which is not where anybody was looking.
    //
    // This is also the entry that does the most for "every terminal": tmux runs
    // in all of them, so a terminal with no split command of its own gets one
    // here.
    detect: (platform, env, exists = have) => Boolean(env.TMUX) && exists('tmux'),

    // Two tmux commands in one invocation, separated by a `;` that is its own
    // argument.
    //
    // `allow-passthrough` is not needed by the default path and is set anyway.
    // The pane asks whoever answers its capability query, and inside tmux that
    // is tmux — which since 3.4 renders sixels itself, so the frames are sent
    // to tmux plainly and it draws them. See passthroughFor in graphics.mjs for
    // why that is the right rule.
    //
    // It is set because of the one case that does need it: someone forcing
    // `graphicsFormat` in config to reach the terminal behind tmux, which is
    // the only reason to force it at all. Doing it here means that override
    // works rather than silently producing an empty pane — and the cost is a
    // server option that is additive, takes effect immediately, and needs no
    // file edited and no restart asked for.
    //
    // `-d` so the new pane does not steal focus from the agent, and `-l` sizes
    // it in lines, which is the same number every other launcher is given.
    split: ({ rows, argv }) => [
      'tmux',
      [
        'set', '-g', 'allow-passthrough', 'on',
        ';',
        'split-window', '-v', '-d', '-l', String(rows + 1), '--', ...argv,
      ],
    ],

    window: ({ argv }) => ['tmux', ['set', '-g', 'allow-passthrough', 'on', ';', 'new-window', '-d', '--', ...argv]],
  },

  {
    name: 'wezterm',
    label: 'WezTerm',

    detect: (platform, env, exists = have) => Boolean(env.WEZTERM_PANE) && exists('wezterm'),

    // `--cells` is the same number the Ghostty window path passes as
    // `--window-height`: the sprite's rows plus one for the prompt line. No
    // percentage arithmetic, no correction pass, and no config file — `wezterm
    // cli` talks to the running multiplexer over its own socket, which is on by
    // default. This is the launcher with nothing to set up.
    //
    // `--pane-id` explicitly rather than letting it read $WEZTERM_PANE itself,
    // because the hook may be spawned by something that has cleaned the
    // environment, and a split that silently lands in the wrong pane is worse
    // than one that fails.
    split: ({ rows, argv, env }) => [
      'wezterm',
      ['cli', 'split-pane', '--bottom', '--cells', String(rows + 1), '--pane-id', String(env.WEZTERM_PANE), '--', ...argv],
    ],

    window: ({ argv }) => ['wezterm', ['cli', 'spawn', '--new-window', '--', ...argv]],
  },

  {
    name: 'kitty',
    label: 'kitty',

    // $KITTY_LISTEN_ON rather than $KITTY_WINDOW_ID, which is set in every
    // kitty whether or not remote control is allowed. Asking for the socket is
    // asking the question that matters: `kitty @` without `allow_remote_control`
    // fails with a message about the socket, and detecting on the window id
    // would mean choosing this launcher and then failing every time.
    detect: (platform, env, exists = have) => Boolean(env.KITTY_LISTEN_ON) && exists('kitty'),

    // `--location=hsplit` needs the splits layout enabled; `npm run kitty --
    // --install` writes both that and the remote control setting, for the same
    // reason src/ghostty.mjs writes the resize keybind — a requirement that
    // lives only in a README is a requirement nobody has met.
    //
    // `--to` so the request reaches this kitty rather than whichever one the
    // socket happens to resolve to, and `--match` so the split is made next to
    // the window this session is in rather than the focused one.
    split: ({ rows, argv, env, rowsAvailable }) => [
      'kitty',
      [
        '@',
        '--to',
        env.KITTY_LISTEN_ON,
        'launch',
        '--type=window',
        '--location=hsplit',
        `--bias=${splitBias(rows, rowsAvailable)}`,
        // Only when there is an id to match on. `--match=id:` with nothing
        // after it is not "match anything", it is a malformed match, and kitty
        // rejects the whole launch — so an unset $KITTY_WINDOW_ID would turn a
        // pane that would have opened beside the wrong window into no pane at
        // all. Without it kitty splits the active window, which is the same
        // thing the Ghostty keystroke does and no worse.
        ...(env.KITTY_WINDOW_ID ? [`--match=id:${env.KITTY_WINDOW_ID}`] : []),
        '--cwd=current',
        '--',
        ...argv,
      ],
    ],

    window: ({ argv, env }) => [
      'kitty',
      ['@', '--to', env.KITTY_LISTEN_ON, 'launch', '--type=os-window', '--', ...argv],
    ],
  },

  {
    name: 'iterm2',
    label: 'iTerm2',

    // Above ghostty-macos for the same reason WezTerm and kitty are: a pane
    // beside this session, in the terminal this session is actually in, beats
    // a window belonging to a different application.
    //
    // iTerm2 has a real AppleScript dictionary, so this is scripting rather
    // than the keystroke simulation the Ghostty path needs. Different macOS
    // permission, and a better one: Automation, which is asked for once with a
    // dialog naming both applications, rather than Accessibility, which is a
    // trip to System Settings.
    detect: (platform, env) => platform === 'darwin' && (env.TERM_PROGRAM === 'iTerm.app' || env.LC_TERMINAL === 'iTerm2'),

    // Split, then size — and the sizing is the whole reason this is worth
    // doing rather than opening a window. An iTerm2 split is 50/50, which is
    // the half-window sprite this project already fixed once for Ghostty by
    // binding a resize key. Here the session object has `rows` as a settable
    // property, so the strip is asked for directly.
    split: ({ rows, argv }) => [
      'osascript',
      [
        '-e',
        `tell application "iTerm2"
           tell current session of current window
             set pokemanionPane to (split horizontally with default profile)
           end tell
           tell pokemanionPane
             write text ${asString(`exec ${shellJoin(argv)}`)}
             set rows to ${rows + 1}
           end tell
         end tell`,
      ],
    ],

    window: ({ rows, cols, argv }) => [
      'osascript',
      [
        '-e',
        `tell application "iTerm2"
           set pokemanionWindow to (create window with default profile command ${asString(shellJoin(argv))})
           tell current session of pokemanionWindow
             set rows to ${rows + 1}
             set columns to ${cols}
           end tell
         end tell`,
      ],
    ],
  },

  {
    name: 'ghostty-macos',
    label: 'Ghostty (AppleScript)',

    // The existing path, unchanged. macOS only, because the whole mechanism is
    // System Events, and it is chosen on the app being installed rather than on
    // $TERM_PROGRAM: `windowMode: "window"` opens a Ghostty of its own and has
    // never required you to already be sitting in one. That is also why it sits
    // below the two that do check — they would otherwise never be reached on a
    // Mac with Ghostty installed, whatever terminal you were actually in.
    // `installed` is injected for the same reason `exists` is: without it this
    // one clause reads the real disk, and the suite cannot invent the machine
    // that matters most here — a Mac with no Ghostty on it, which is every
    // plugin user who has not installed one yet.
    detect: (platform, env, exists = have, installed = appExists) => platform === 'darwin' && installed('/Applications/Ghostty.app'),

    // Handled inside companion.mjs rather than here. It is not a command and an
    // argv cannot describe it — it is a keystroke, a wait for a login shell,
    // and a second keystroke. Named so the choice can be tested and logged like
    // any other; dispatched on by name at the one call site.
    applescript: true,
  },

  {
    name: 'ghostty-linux',
    label: 'Ghostty',

    // The same terminal, the other platform, and a completely different
    // mechanism — which is why it is a separate entry rather than a branch
    // inside the first one. On Linux `ghostty -e` starts a terminal running a
    // command; on macOS the same binary refuses, and says so in its own help.
    // Two ways of asking, because either can be missing and neither lies.
    // $TERM_PROGRAM comes from Ghostty's shell integration, which can be
    // switched off or lost to a shell that never sourced it; $TERM is what the
    // terminfo says and is set whether or not it did.
    //
    // $GHOSTTY_RESOURCES_DIR was a third and has been removed. Ghostty exports
    // it, and an exported variable is inherited by every shell started from
    // that one — it was still set inside a Terminal.app opened later, which
    // made the same test in graphics.mjs claim a terminal was Ghostty when it
    // plainly was not. The two that are left are set per terminal and do not
    // travel.
    detect: (platform, env, exists = have) =>
      platform !== 'darwin' && (env.TERM_PROGRAM === 'ghostty' || env.TERM === 'xterm-ghostty') && exists('ghostty'),

    // Window only. Ghostty has no command to split an existing window on any
    // platform — that is a keybind, and pressing it is what the macOS path does
    // and what needs an accessibility grant. A Linux Ghostty user gets the
    // separate strip window, which is what `windowMode: "window"` has always
    // been and is a supported way to run this rather than a consolation.
    window: ({ rows, cols, argv }) => [
      'ghostty',
      [
        `--window-height=${rows + 1}`,
        `--window-width=${cols}`,
        '--window-title=pikachu',
        '--window-decoration=false',
        '-e',
        ...argv,
      ],
    ],
  },

  {
    name: 'terminal-app',
    label: 'Terminal.app',

    // Below ghostty-macos on purpose. Terminal.app cannot draw pixels at all —
    // it gets the symbols format, which is coloured blocks — so on a Mac that
    // has Ghostty, a real Ghostty pane is the better answer and is what this
    // has always done. This entry is for the Mac that does not.
    detect: (platform, env) => platform === 'darwin' && env.TERM_PROGRAM === 'Apple_Terminal',

    // Window only: Terminal.app has no concept of a split. `do script` with no
    // `in` clause opens a new window and runs the command in it, and the window
    // is then sized in cells the same way every other window launcher is.
    window: ({ rows, cols, argv }) => [
      'osascript',
      [
        '-e',
        `tell application "Terminal"
           set pokemanionTab to do script ${asString(`exec ${shellJoin(argv)}`)}
           set pokemanionWindow to first window whose tabs contains pokemanionTab
           tell pokemanionWindow
             set number of rows to ${rows + 1}
             set number of columns to ${cols}
           end tell
         end tell`,
      ],
    ],
  },

  {
    name: 'unix-terminal',
    label: 'a terminal window',

    // Last, and the reason the table no longer has a row that says "no".
    //
    // Every one of these opens a window running a command; none of them can
    // split an existing one from the command line. That is the trade for
    // covering the terminals nobody wrote an integration for — a strip window
    // beside the session rather than a pane inside it, which is what
    // `windowMode: "window"` has always been and is a supported way to run this.
    //
    // Ordered by how well each draws the sprite. foot does sixels, so it gets
    // pixels; the rest get the symbols format, which is why they are here at
    // all. Before this file existed, every one of them opened nothing.
    detect: (platform, env, exists = have) => platform !== 'darwin' && UNIX_TERMINALS.some((entry) => exists(entry.command)),

    // `exists` off the plan rather than the module-level `have`, so the suite
    // can ask which of six terminals this would pick on a machine that has
    // three of them — the question the ordering exists to answer, and one this
    // machine cannot be made to represent.
    window: ({ rows, cols, argv, exists = have }) => {
      const entry = UNIX_TERMINALS.find((candidate) => exists(candidate.command))

      return entry ? [entry.command, entry.args(rows + 1, cols, argv)] : null
    },
  },
]

// One row per terminal that can run a command in a new window, in the order
// they are tried.
//
// The geometry flag is the fiddly part and is different in all six: two spell
// it `WxH`, one wants two options, and xterm's is `-geometry` with one dash.
// Getting it wrong does not fail — it opens a window of the default size with
// the sprite in the corner of it, which reads as the sprite being broken.
//
// The command separator differs too, and it matters more: `-e` in most of them
// takes the rest of the line, but gnome-terminal deprecated `-e` in favour of
// `--` and now mangles anything passed the old way.
export const UNIX_TERMINALS = [
  { command: 'foot', args: (rows, cols, argv) => ['-w', `${cols}x${rows}`, ...argv] },
  { command: 'konsole', args: (rows, cols, argv) => ['--hide-menubar', '--hide-tabbar', '-e', ...argv] },
  { command: 'gnome-terminal', args: (rows, cols, argv) => [`--geometry=${cols}x${rows}`, '--', ...argv] },
  { command: 'xfce4-terminal', args: (rows, cols, argv) => [`--geometry=${cols}x${rows}`, '--hide-menubar', '-x', ...argv] },
  { command: 'alacritty', args: (rows, cols, argv) => ['-o', `window.dimensions.columns=${cols}`, '-o', `window.dimensions.lines=${rows}`, '-e', ...argv] },
  { command: 'xterm', args: (rows, cols, argv) => ['-geometry', `${cols}x${rows}`, '-e', ...argv] },
]

// The first launcher that fits, or null.
//
// Null is a real answer and the common one on an unsupported machine: a Linux
// in GNOME Terminal, a Mac in Terminal.app. The caller says so in the log and
// opens nothing, which is what happened before this file existed — the point is
// that it now happens for a reason it can name.
export const chooseLauncher = (platform = process.platform, env = process.env, exists = have, installed = appExists, launchers = LAUNCHERS) =>
  launchers.find((launcher) => launcher.detect(platform, env, exists, installed)) ?? null

// What the chosen launcher would be asked to run, or null if it cannot do that
// mode. Split from the launching itself so a machine can be asked what it would
// do — `npm run doctor` reports it, and the suite checks it — without a pane
// appearing on it.
export const launchCommand = (launcher, mode, plan) => {
  if (!launcher || launcher.applescript) return null

  const build = launcher[mode]

  if (!build) return null

  return build({ exists: have, ...plan })
}
