#!/usr/bin/env node
/**
 * probe/doctor.mjs — what can this machine actually run?
 *
 * Reports the engine's dependencies and optional surfaces before a stage fails
 * halfway through: Node, an automation browser, puppeteer-core, Eagle and its
 * media server, Lighthouse, Hallmark's sloplint, the Impeccable detector, git
 * and the brand registry. Nothing is installed; this is a read-out.
 *
 *   node doctor.mjs
 *   node doctor.mjs --json
 *   node doctor.mjs --strict        # exit 1 when a required item is missing
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseArgs } from './paths.mjs'
import { chromePath } from './checks.mjs'
import { mediaSource } from './library.mjs'

const args = parseArgs(process.argv.slice(2))
const here = import.meta.dirname
const toolRoot = path.resolve(here, '..')
const home = process.env.HOME ?? ''
const require = createRequire(path.join(toolRoot, 'package.json'))

const rows = []
const add = (name, status, detail, group = 'core') => rows.push({ name, status, detail, group })

/* ------------------------------------------------------------------- core -- */

const nodeMajor = Number(process.versions.node.split('.')[0])
add('node', nodeMajor >= 20 ? 'ok' : 'missing', `${process.version}${nodeMajor >= 20 ? '' : ' — needs 20 or newer'}`, 'required')

const chrome = chromePath()
add('chrome', chrome ? 'ok' : 'missing', chrome ?? 'set CHROME_PATH (capture, audit, render tier)', 'render')

try {
  require.resolve('puppeteer-core')
  add('puppeteer-core', 'ok', 'capture and render checks', 'render')
} catch {
  add('puppeteer-core', 'missing', 'npm install puppeteer-core in the engine repo', 'render')
}

/* ------------------------------------------------------------------ eagle -- */

async function eagleInfo() {
  for (const p of ['/api/v2/app/info', '/api/application/info']) {
    try {
      const res = await fetch('http://localhost:41595' + p, { signal: AbortSignal.timeout(1800) })
      if (res.ok) return res.json()
    } catch {
      // try the next shape
    }
  }
  return null
}

const eagle = await eagleInfo()
if (eagle) {
  let library = null
  try {
    const res = await fetch('http://localhost:41595/api/v2/library/info', { signal: AbortSignal.timeout(1800) })
    if (res.ok) library = (await res.json())?.data ?? null
  } catch {
    // library is optional
  }
  add('eagle', 'ok', library?.path ? `${library.name ?? 'library'} · ${library.path}` : 'running, no library reported', 'eagle')
} else {
  add('eagle', 'optional', 'not running — folder references work without it', 'eagle')
}

const media = mediaSource(null) ?? 'http://127.0.0.1:41532'
let mediaOk = false
try {
  const res = await fetch(media.replace(/\{id\}.*$/, '').replace(/\/+$/, '') + '/api/items/__probe__/file', {
    signal: AbortSignal.timeout(1800),
  })
  mediaOk = res.status > 0
} catch {
  mediaOk = false
}
add('eagle media', mediaOk ? 'ok' : 'optional', mediaOk ? media : 'set EAGLE_MEDIA_BASE or EAGLE_MEDIA_URL when file access is denied', 'eagle')

/* ------------------------------------------------------------ verification -- */

const hallmark = process.env.HALLMARK_HOME ?? path.join(home, '.agents/skills/hallmark')
const sloplint = existsSync(path.join(hallmark, 'scripts/sloplint.mjs'))
add('sloplint', sloplint ? 'ok' : 'optional', sloplint ? path.join(hallmark, 'scripts/sloplint.mjs') : 'install Hallmark for the mechanical sweep', 'verify')

const detector = [
  path.join(home, '.config/opencode/skills/impeccable/scripts/impeccable'),
  path.join(home, '.agents/skills/impeccable/scripts/impeccable'),
].find((p) => existsSync(p))
add('impeccable detector', detector ? 'ok' : 'optional', detector ?? 'install Impeccable for the detector pass', 'verify')

const npx = spawnSync('npx', ['--version'], { encoding: 'utf8' })
add('lighthouse', npx.status === 0 ? 'ok' : 'optional', npx.status === 0 ? 'npx lighthouse@12 (first run downloads)' : 'npx not found', 'verify')

/* ---------------------------------------------------------------- project -- */

const git = spawnSync('git', ['--version'], { encoding: 'utf8' })
add('git', git.status === 0 ? 'ok' : 'optional', git.status === 0 ? git.stdout.trim() : 'not found', 'project')

const registry = [
  process.env.BRAND_REGISTRY,
  path.join(home, '.config/design-pipeline/brand-registry.json'),
  path.join(home, 'Developer/ai-config/brand-registry.json'),
]
  .filter(Boolean)
  .map((p) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p))
  .find((p) => existsSync(p))
add('brand registry', registry ? 'ok' : 'optional', registry ?? 'only needed for the cross-project brandlint check', 'project')

/* ----------------------------------------------------------------- report -- */

const missingRequired = rows.filter((r) => r.group === 'required' && r.status === 'missing')
const icon = { ok: '✓', missing: '✗', optional: '·' }

if (args.has('json')) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, rows, missingRequired: missingRequired.map((r) => r.name) }, null, 2))
} else {
  console.log('\nprobe doctor\n')
  for (const group of ['required', 'render', 'eagle', 'verify', 'project']) {
    const items = rows.filter((r) => r.group === group)
    if (!items.length) continue
    console.log(`  ${group}`)
    for (const r of items) console.log(`    ${icon[r.status]} ${r.name.padEnd(20)} ${r.detail}`)
    console.log('')
  }
  console.log(missingRequired.length ? `✗ missing: ${missingRequired.map((r) => r.name).join(', ')}` : '✓ the engine can start')
  console.log('  render stages need chrome; everything else runs without Eagle or Lighthouse.\n')
}

process.exit(args.has('strict') && missingRequired.length ? 1 : 0)
