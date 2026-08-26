// Drawing the same frame twice without sending it twice.
//
// A pane is a loop that redraws forever, and every redraw used to hand the
// terminal the whole picture again. chafa emits `a=T` — transmit *and* display
// in one command — with the pixels as uncompressed RGBA in base64, so the
// resting Pikachu was 92KB a frame at 14 frames a second: 1.8MB/s, 150GB a day,
// for a Pokemon that is sitting still. Measured on a real pane, four hundred
// draws that way cost 35.9MB and took Ghostty 497ms to work through.
//
// The kitty protocol does not require any of that. Those keys are two ideas
// glued together: `f,s,v,m` describe the pixels, `C,c,r` describe where to put
// them. Give the pixels an id and they can be sent once and then referred to:
//
//   first time   \x1b_Ga=T,i=42,C=1,f=32,s=128,v=136,c=8,r=4,m=1,q=2 + payload
//   every time   \x1b_Ga=p,i=42,c=8,r=4,C=1,q=2
//
// The same four hundred draws then cost 0.02MB and 6ms. Nothing about the
// picture changes — the first send is today's bytes with an id added, and the
// terminal redraws its own copy of exactly those pixels afterwards.
//
// Sent lazily rather than all up front: a frame is transmitted the first time
// it plays, so the opening cycle costs what the whole animation used to cost
// every cycle, and there is no burst at startup to stall the pane.
//
// What takes the terminal's copy away, measured against Ghostty 1.3.1 rather
// than assumed:
//
//   a=d delete placements   kept    <- the pane does this every single frame
//   ESC[0J erase to end     kept
//   ESC[K  erase line       kept
//   ESC[3J clear scrollback kept
//   scrolling               kept
//   ESC[2J clear screen     LOST
//
// So exactly one thing loses them, the pane writes it in four places it
// controls, and `forget` is how those places say so.

const APC = /\x1b_G([^\x1b]*)\x1b\\/

// Where an image is put, as opposed to what it is made of. Only these move to
// the placement command; the rest describe the pixels and are sent once.
const PLACEMENT = ['C', 'c', 'r', 'z', 'x', 'y', 'w', 'h', 'X', 'Y']

// Ids are only ever compared by the terminal this pane is drawing into, and a
// pane is one process, so a counter is enough. They are handed out per frame
// rather than per sprite because a placement names one picture.
let nextId = 1

const describe = (frame) => {
  const head = APC.exec(frame)?.[1]

  // chafa's first APC is control data with no payload at all, which is what
  // makes this split clean — but it is also the thing to check before trusting
  // it. Anything else is drawn exactly as it arrived.
  if (!head || head.includes(';') || !head.startsWith('a=T,')) return null

  const keys = new Map(head.split(',').map((pair) => pair.split('=')))

  if (!keys.has('f') || !keys.has('s') || !keys.has('v')) return null

  const id = nextId++

  // q=1 on the placement: say nothing when it works, tell us when the picture
  // it names is gone. That answer is the only way the pane can learn that the
  // terminal has dropped something, and it costs nothing while nothing is
  // wrong — see the reader in window.mjs. The transmission keeps chafa's own
  // q, because a transmission that failed shows up as the placement failing.
  const put = ['a=p', `i=${id}`, ...PLACEMENT.filter((k) => keys.has(k)).map((k) => `${k}=${keys.get(k)}`), 'q=1']

  return {
    id,
    // Byte for byte what the pane sends today, plus the id. It still transmits
    // and still displays, so the first play of a frame looks like it always
    // did — the id only means the terminal keeps the pixels afterwards.
    send: frame.replace(head, `a=T,i=${id},${head.slice('a=T,'.length)}`),
    put: `\x1b_G${put.join(',')}\x1b\\`,
  }
}

// Worked out once per sprite, on first use rather than at load, so nothing is
// paid for a sprite that is never drawn — the Pokedex loads sprites to measure
// them, and the pane loads a busy one that may not play for minutes.
const artFor = (sprite) => {
  if (!sprite.art) {
    sprite.art = {
      frames: sprite.frames.map(describe),
      ghost: sprite.ghost ? describe(sprite.ghost) : null,
    }
  }

  return sprite.art
}

// Which pictures the terminal is holding, and since when. Keyed by id, so one
// map covers every sprite this pane has loaded and `forget` is one call.
const sent = new Map()

// The backstop under the backstop.
//
// A dropped picture is normally noticed within a frame: placements are sent
// with q=1, the terminal answers ENOENT, and the pane forgets and re-sends. So
// this is only for a terminal that never answers at all — where a picture lost
// to something unmeasured would leave an empty pane and nothing would ever say
// so. Ten minutes is long enough to cost almost nothing and short enough that
// nobody sits looking at a blank pane for an afternoon.
//
// Per frame rather than all at once, so the re-send spreads itself across one
// turn of the animation instead of arriving as a burst.
//
// Measured on the resting Pikachu: 354KB/s before any of this, 0.5KB/s of
// placements after it, and this adds about 2.5KB/s on top.
export const REFRESH_EVERY = 600_000

// The escape sequence that draws frame `at` of `sprite` — the whole picture the
// first time, a reference to it afterwards. `at` is a frame number, or 'ghost'
// for the white silhouette the evolution flicker trades against.
export const emit = (sprite, at = 0, now = Date.now()) => {
  const art = at === 'ghost' ? artFor(sprite).ghost : artFor(sprite).frames[at]

  if (!art) return at === 'ghost' ? sprite.ghost : sprite.frames[at]

  const when = sent.get(art.id)

  if (when !== undefined && now - when < REFRESH_EVERY) return art.put

  sent.set(art.id, now)

  return art.send
}

// The terminal no longer has any of it. Said by whoever clears the screen.
export const forget = () => sent.clear()

// For the suite, which has no terminal to ask.
export const holding = () => sent.size
