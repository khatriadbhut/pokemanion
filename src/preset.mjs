// Known-good combinations, so trying a different look is one command instead of
// hand-editing four settings that interact.
//
// Usage: node src/preset.mjs            list them
//        node src/preset.mjs clean      apply one and rebuild

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, loadConfig, saveConfig } from './config.mjs'

const PRESETS = {
  clean: {
    what: 'the little menu-icon Pikachu, drawn 1:1 — nothing shrunk, no speckle',
    // 11 rows, not 10: the hop needs two pixels of travel, and at 10 the sprite
    // plus its hop no longer fits a whole-number scale, dropping it to half size.
    cost: '11 rows',
    config: { sprite: 'assets/pikachu-icon.png', rows: 11, style: 'half', palette: 7, bounce: 1 },
  },
  compact: {
    what: 'the same icon at half size, for when rows are precious',
    cost: '5 rows',
    config: { sprite: 'assets/pikachu-icon.png', rows: 5, style: 'quad', palette: 6, bounce: 1 },
  },
  gen5: {
    what: 'the Gen-5 sprite at half size — detailed, but its shading reads as speckle',
    cost: '12 rows',
    config: { sprite: 'assets/pikachu-bw.gif', rows: 12, style: 'quad', palette: 7 },
  },
  perfect: {
    what: 'the Gen-5 sprite 1:1, every pixel as drawn. The best it can look',
    cost: '23 rows — half your terminal',
    config: { sprite: 'assets/pikachu-bw.gif', rows: 23, style: 'half', palette: 7 },
  },
  gsc: {
    what: 'Gold/Silver sprite — drawn for a Game Boy screen, 4 colours, no shading to lose',
    cost: '11 rows',
    config: { sprite: 'assets/pikachu-gsc.png', rows: 11, style: 'quad', palette: 4, bounce: 1 },
  },
  gameboy: {
    what: 'the Game Boy sprite: four colours, no shading to lose',
    cost: '11 rows',
    config: { sprite: 'assets/pikachu-gen1.png', rows: 11, style: 'half', palette: 4, bounce: 1 },
  },
}

const [name] = process.argv.slice(2)

if (!name || !PRESETS[name]) {
  const current = loadConfig()

  console.log('\n  Presets — apply with:  node src/preset.mjs <name>\n')

  for (const [key, { what, cost }] of Object.entries(PRESETS)) {
    console.log(`  ${key.padEnd(9)} ${cost.padEnd(24)} ${what}`)
  }

  console.log(`\n  Now: ${current.sprite}, ${current.rows} rows, style ${current.style}\n`)
  process.exit(name ? 1 : 0)
}

saveConfig(PRESETS[name].config)

console.log(`\n  ${name}: ${PRESETS[name].what}\n`)

execFileSync(process.execPath, [join(ROOT, 'src', 'build.mjs')], { stdio: 'inherit' })
