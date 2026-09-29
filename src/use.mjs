// Switch to one of the sprites in assets/ and rebuild.
//
// Usage: node src/use.mjs 3-standing.gif

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, saveConfig } from './config.mjs'

const [name] = process.argv.slice(2)
const available = readdirSync(join(ROOT, 'assets')).filter((f) => /\.(gif|png)$/i.test(f))

if (!name || !existsSync(join(ROOT, 'assets', name))) {
  console.log('\n  Sprites in assets/:\n')
  for (const file of available) console.log(`    ${file}`)
  console.log('\n  node src/use.mjs <name>       node src/bakeoff.mjs   to compare them\n')
  process.exit(name ? 1 : 0)
}

saveConfig({ sprite: `assets/${name}` })
execFileSync(process.execPath, [join(ROOT, 'src', 'build.mjs')], { stdio: 'inherit' })
