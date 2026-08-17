// Fetch a guest, then tell the pane it has landed.
//
// This exists because downloading takes about three seconds and a hook is given
// five. `--kyogre` spent the whole budget on the network and was killed with its
// output thrown away, which reads as the command doing nothing at all.
//
// So the hook writes the claim and starts this, detached, and answers straight
// away. The pane ignores a claim whose files are missing — "half a sprite is
// worse than the wrong sprite" — and re-reads whenever the file's timestamp
// changes, so rewriting the same name here is what makes the Pokemon appear.
//
// Usage: run.sh src/fetch.mjs <name> <claim-file> [previous-claim]

import { rmSync, writeFileSync } from 'node:fs'
import { ensure } from './roster.mjs'

const [, , name, claim, previous] = process.argv

if (name) {
  const got = ensure(name)

  if (got && claim) {
    try {
      writeFileSync(claim, got)
    } catch {}
  }

  // Put back whatever the session was showing before.
  //
  // A download that fails takes the sprite directory with it — `ensure` will
  // not keep half a Pokemon — so leaving the claim naming this one points the
  // session at files that no longer exist. Every pane it opens after that
  // starts on a dead name, which is indistinguishable from the tool being
  // broken. Better to carry on with the Pokemon that was already there.
  if (!got && claim) {
    try {
      if (previous) writeFileSync(claim, previous)
      else rmSync(claim, { force: true })
    } catch {}
  }
}
