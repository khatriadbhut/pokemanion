// Two terminals, two very different ceilings — so switch between them in one
// command instead of hand-editing four settings.
//
//   node src/target.mjs ghostty    octants, 8 pixels a cell, sprite at 1:1
//   node src/target.mjs terminal   half blocks, 2 a cell, works in Terminal.app

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, saveConfig } from './config.mjs'

const TARGETS = {
  // Our own renderer, not chafa. Chafa picks the two colours that minimise
  // error, which for flat sprite art means inventing blends — measured on this
  // Pikachu, 129 of the 130 colours it emitted were not in the sprite at all,
  // and the result looks washed out. Ours only ever uses colours that are
  // actually there.
  ghostty: {
    renderer: 'builtin',
    style: 'octant',
    sampler: 'outline',
    rows: 10,
  },
  // Pixel-exact. A cell carries two colours, so a cell may hold at most two
  // pixels if none are to be faked — that is a half block, and a 39px sprite
  // then needs 20 rows. Measured: octants at 10 rows draw 10.3% of pixels in
  // the wrong colour, this draws 0%.
  exact: {
    renderer: 'builtin',
    style: 'half',
    sampler: 'outline',
    rows: 20,
  },

  // The smallest that still reads as Pikachu. Octants reach 1:1 on a 17px
  // sprite in five rows, at the cost of 4.1% of pixels sharing a colour with a
  // neighbour. Below this it stops being a Pokemon and becomes a yellow smudge:
  // two rows is 8x8 pixels, and nothing survives that.
  small: {
    renderer: 'builtin',
    style: 'octant',
    sampler: 'outline',
    rows: 5,
  },

  terminal: {
    renderer: 'builtin',
    style: 'half',
    sampler: 'outline',
    rows: 10,
  },
}

const [name] = process.argv.slice(2)
const target = TARGETS[name]

if (!target) {
  console.log('\n  node src/target.mjs ghostty    or    node src/target.mjs terminal\n')
  process.exit(1)
}

saveConfig(target)

console.log(
  name === 'ghostty'
    ? '\n  Built for Ghostty: octants, 8 pixels per cell, sprite at 1:1.\n  In Terminal.app this will show as question marks.\n'
    : name === 'exact'
      ? '\n  Pixel-exact: every pixel its own colour, nothing approximated.\n  Costs 20 rows — that is what exactness weighs.\n'
      : '\n  Built for Terminal.app: half blocks, works in any font.\n',
)

execFileSync(process.execPath, [join(ROOT, 'src', 'build.mjs')], { stdio: 'inherit' })
