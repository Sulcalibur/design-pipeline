#!/usr/bin/env node
/**
 * probe/inspire.mjs — pull inspiration from a discovery source into references/.
 *
 * Awwwards and Pinterest are MCP servers; a feed is any JSON list of URLs.
 * Sources are opt-in in probe.config.json (`inspiration.sources`), so a project
 * can turn one on without changing the engine. `--dry-run` shows the picks;
 * otherwise each pick goes through capture.mjs, which is what writes
 * references/manifest.json (and Eagle, when it is running).
 *
 *   node probe.mjs inspire --list
 *   node probe.mjs inspire --dry-run --count 4
 *   node probe.mjs inspire --source pinterest --count 3
 *   node probe.mjs inspire --to folder
 *   node probe.mjs inspire --check
 *
 * Flags: --config · --source a,b · --count <n> · --seed <s> · --dry-run
 *        --to auto|eagle|folder · --viewport desktop|mobile|WxH · --no-full
 *        --json · --list · --check
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs, resolvePaths, loadConfig, fail, rel } from './paths.mjs'
import { connectMcp } from './mcp.mjs'
import { eagleStatus } from './library.mjs'
import {
  candidatesFromAwwwards,
  candidatesFromPinterest,
  describeSource,
  eagleTarget,
  enabledSourceNames,
  inspirationSettings,
  nextSlug,
  normalizeEagleMode,
  pickMixed,
  readFeed,
  SOURCE_NAMES,
  usedSlugsFromManifest,
  awwwardsCommand,
  pinterestCommand,
} from './inspiration.mjs'

const here = import.meta.dirname
const argv = process.argv.slice(2)
const args = parseArgs(argv)
const paths = resolvePaths(argv)
const config = loadConfig(paths.config)
const settings = inspirationSettings(config)
const json = args.has('json')
const seed = String(args.get('seed', settings.seed ?? Date.now().toString(36)))
const viewport = args.get('viewport', 'desktop')
if (viewport !== 'desktop' && viewport !== 'mobile' && !/^\d+x\d+$/.test(viewport)) {
  fail('--viewport must be desktop, mobile or WxH (for example 1280x800)')
}
const eagleFolder = config.inspiration?.eagleFolder ?? 'inspiration'

function usage() {
  console.log(`inspire — pull references from a discovery source

  node probe.mjs inspire --list              show sources and Eagle state
  node probe.mjs inspire --check             hand-shake with enabled MCP servers
  node probe.mjs inspire --dry-run           pick, print, write nothing
  node probe.mjs inspire --count 6           pull six (default: inspiration.count)
  node probe.mjs inspire --source pinterest  force a source for this run
  node probe.mjs inspire --to folder         never write to Eagle this run
  node probe.mjs inspire --seed <s>          reproduce a pick

Flags: --config · --source a,b · --count <n> · --seed <s> · --dry-run
       --to auto|eagle|folder · --viewport desktop|mobile|WxH · --no-full
       --json · --list · --check`)
}

if (args.has('help') || args.has('h') || args.positionals.includes('-h') || args.positionals[0] === 'help') {
  usage()
  process.exit(0)
}

for (const name of settings.unknownSources) {
  console.error(`  ! unknown inspiration source "${name}" — known: ${SOURCE_NAMES.join(', ')}`)
}

/* ---------------------------------------------------------------- sources -- */

function selectedSources() {
  const requested = (args.get('source') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (requested.length) {
    const unknown = requested.filter((name) => !SOURCE_NAMES.includes(name))
    if (unknown.length) fail(`unknown source: ${unknown.join(', ')}\n  Known: ${SOURCE_NAMES.join(', ')}`)
    return requested.map((name) => ({
      name,
      block: settings.sources[name],
      forced: settings.sources[name].enabled !== true,
    }))
  }
  const enabled = enabledSourceNames(settings)
  if (!enabled.length) {
    fail(
      'no inspiration sources enabled.\n' +
        '  Turn one on in probe.config.json → inspiration.sources, or pick one for this run:\n' +
        `  bin/probe inspire --source ${SOURCE_NAMES[0]}`,
    )
  }
  return enabled.map((name) => ({ name, block: settings.sources[name], forced: false }))
}

function sourceLabel(entry) {
  return `${entry.name}${entry.forced ? ' (forced by --source)' : entry.block.enabled ? '' : ' (disabled in config)'}`
}

/* ------------------------------------------------------------------ fetch -- */

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(number)))
}

async function fetchAwwwards(block) {
  const { command, args: commandArgs } = awwwardsCommand(block)
  const client = await connectMcp({
    command,
    args: commandArgs,
    label: 'awwwards',
    timeoutMs: clampInt(block.timeoutMs, 5000, 600000, 180000),
  })
  try {
    const call = {
      responseMode: 'compact',
      count: clampInt(block.count, 1, 12, 12),
      page: clampInt(block.page, 1, 100, 1),
      sortBy: block.sortBy === 'score' ? 'score' : 'newest',
    }
    if (block.award) call.award = block.award
    if (block.query) call.query = block.query
    if (Array.isArray(block.tags) && block.tags.length) call.tags = block.tags
    if (block.technology) call.technology = block.technology
    if (block.color) call.color = block.color
    const result = await client.callTool('search_sites', call, clampInt(block.timeoutMs, 5000, 600000, 180000))
    return { candidates: candidatesFromAwwwards(result) }
  } finally {
    client.close()
  }
}

async function fetchPinterest(block) {
  const { command, args: commandArgs } = pinterestCommand(block)
  const client = await connectMcp({
    command,
    args: commandArgs,
    label: 'pinterest',
    timeoutMs: clampInt(block.timeoutMs, 5000, 300000, 90000),
  })
  try {
    const call = {
      query: block.query || 'web design landing page',
      limit: clampInt(block.limit, 1, 100, 30),
      media: ['any', 'image', 'video'].includes(block.media) ? block.media : 'image',
    }
    const result = await client.callTool('pinterest_search', call, clampInt(block.timeoutMs, 5000, 300000, 90000))
    return candidatesFromPinterest(result)
  } finally {
    client.close()
  }
}

function fetchFeed(block) {
  const file = path.isAbsolute(block.path ?? '')
    ? block.path
    : path.resolve(paths.root, block.path ?? 'references/inspiration.json')
  return { candidates: readFeed(file), file }
}

async function fetchSource(entry) {
  if (entry.name === 'awwwards') return fetchAwwwards(entry.block)
  if (entry.name === 'pinterest') return fetchPinterest(entry.block)
  if (entry.name === 'feed') return fetchFeed(entry.block)
  throw new Error(`no adapter for "${entry.name}"`)
}

/* ------------------------------------------------------------------ eagle -- */

async function eagleChoice({ enforce = true } = {}) {
  const status = await eagleStatus()
  const mode = normalizeEagleMode(args.get('to') ?? settings.eagle)
  if (!enforce) {
    return { status, mode, target: mode === 'off' ? 'folder' : status.running ? 'eagle' : 'folder' }
  }
  let target
  try {
    target = eagleTarget(mode, status.running)
  } catch (error) {
    fail(error.message)
  }
  return { status, mode, target }
}

function eagleLine({ status, mode, target }) {
  const library = status.library?.name ? `${status.library.name} · ` : ''
  if (!status.running) {
    const promise = mode === 'on' ? 'would fail — open Eagle' : `→ ${target} (folder only)`
    return `eagle: not running · write-back ${mode} ${promise}`
  }
  return `eagle: running · ${library}write-back ${mode} → ${target}`
}

/* ------------------------------------------------------------------- list -- */

function listSources() {
  const lines = [`inspiration · ${config.id ?? path.basename(paths.root)}`, `config: ${rel(paths.config)}`, '']
  for (const name of SOURCE_NAMES) {
    const block = settings.sources[name]
    lines.push(`  ${block.enabled ? '✓' : '·'} ${name.padEnd(10)} ${block.enabled ? 'enabled ' : 'disabled'}  ${describeSource(name, block)}`)
  }
  lines.push('', `count: ${settings.count} · seed: ${settings.seed ?? 'random per run'} · eagle mode: ${settings.eagle}`)
  lines.push('toggle: set inspiration.sources.<name>.enabled in probe.config.json')
  console.log(lines.join('\n'))
}

/* ------------------------------------------------------------------ check -- */

async function checkSources(entries, eagle) {
  console.log(eagleLine(eagle))
  let failed = 0
  for (const entry of entries) {
    if (entry.name === 'feed') {
      const file = path.isAbsolute(entry.block.path ?? '')
        ? entry.block.path
        : path.resolve(paths.root, entry.block.path ?? 'references/inspiration.json')
      if (existsSync(file)) console.log(`✓ feed       ${rel(file)}`)
      else {
        failed += 1
        console.error(`✗ feed       not found: ${rel(file)}`)
      }
      continue
    }
    const { command, args: commandArgs } =
      entry.name === 'awwwards' ? awwwardsCommand(entry.block) : pinterestCommand(entry.block)
    try {
      const client = await connectMcp({ command, args: commandArgs, label: entry.name, timeoutMs: 30000 })
      try {
        const tools = await client.request('tools/list', {}, 30000)
        const names = (tools?.tools ?? []).map((tool) => tool.name)
        console.log(`✓ ${entry.name.padEnd(10)} ${names.length} tool(s) · ${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''}`)
      } finally {
        client.close()
      }
    } catch (error) {
      failed += 1
      console.error(`✗ ${entry.name.padEnd(10)} ${error.message}`)
    }
  }
  return failed
}

/* ---------------------------------------------------------------- capture -- */

function noteFor(pick) {
  return [`Pulled from ${pick.source}`, pick.title, pick.note]
    .filter(Boolean)
    .join(' — ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

function captureOne(pick, slug, target) {
  const captureArgs = [
    path.join(here, 'capture.mjs'),
    '--config',
    paths.config,
    '--url',
    pick.url,
    '--slug',
    slug,
    '--viewport',
    viewport,
    '--wait',
    '1500',
    '--note',
    noteFor(pick),
    '--device',
    'unsorted — classify before borrowing',
    '--avoid',
    'unsorted — name what not to copy',
    '--fits',
    `candidate reference for ${config.id ?? 'this project'}`,
    '--evidence',
    `inspire · ${pick.source} · seed ${seed}`,
    '--tags',
    `inspiration,${pick.source}`,
    '--eagle-folder',
    eagleFolder,
    '--to',
    target,
  ]
  if (!args.has('no-full')) captureArgs.push('--full')
  return captureArgs
}

/* ------------------------------------------------------------------- main -- */

const eagle = await eagleChoice({ enforce: false })

if (args.has('list')) {
  if (json) {
    console.log(JSON.stringify({ settings, eagle: { running: eagle.status.running, library: eagle.status.library, mode: eagle.mode } }, null, 2))
  } else {
    listSources()
    console.log(eagleLine(eagle))
  }
  process.exit(0)
}

const entries = selectedSources()

if (args.has('check')) {
  let failed = await checkSources(entries, eagle)
  if (eagle.mode === 'on' && !eagle.status.running) {
    failed += 1
    console.error('✗ eagle      inspiration.eagle is "on" but Eagle is not running')
  }
  process.exit(failed ? 1 : 0)
}

try {
  eagle.target = eagleTarget(eagle.mode, eagle.status.running)
} catch (error) {
  fail(error.message)
}

const count = clampInt(args.get('count', settings.count), 1, 24, 4)

const pools = []
const reports = []
for (const entry of entries) {
  try {
    const result = await fetchSource(entry)
    const candidates = result.candidates ?? []
    pools.push({ source: entry.name, candidates })
    reports.push({
      source: entry.name,
      candidates: candidates.length,
      skipped: result.skipped ?? 0,
      nextBookmark: result.nextBookmark ?? null,
      file: result.file ?? null,
      error: null,
    })
    if (!json) {
      const extra = result.skipped ? ` · ${result.skipped} pin(s) without a source page skipped` : ''
      console.log(`✓ ${entry.name.padEnd(10)} ${candidates.length} candidate(s)${extra}`)
      if (!candidates.length) {
        console.log(`  · ${entry.name} returned no live URLs — try a different tag, query or award`)
      }
    }
  } catch (error) {
    reports.push({ source: entry.name, candidates: 0, skipped: 0, error: error.message })
    if (!json) console.error(`✗ ${entry.name.padEnd(10)} ${error.message}`)
  }
}

const picks = pickMixed(pools, count, seed)

if (json && args.has('dry-run')) {
  console.log(
    JSON.stringify(
      {
        seed,
        sources: reports,
        picks,
        eagle: { running: eagle.status.running, library: eagle.status.library, mode: eagle.mode, target: eagle.target },
        dryRun: true,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (!picks.length) {
  const reasons = reports.filter((report) => report.error).map((report) => `${report.source}: ${report.error}`)
  fail(`no references picked${reasons.length ? `\n  ${reasons.join('\n  ')}` : ''}`)
}

if (!json) {
  console.log(`\nseed ${seed} · ${picks.length} pick(s) from ${entries.map(sourceLabel).join(', ')}`)
  console.log(eagleLine(eagle))
  picks.forEach((pick, index) => {
    const tags = pick.tags?.length ? ` · ${pick.tags.slice(0, 4).join(', ')}` : ''
    console.log(`  ${index + 1}. ${pick.title} — ${pick.url} [${pick.source}${tags}]`)
  })
}

if (args.has('dry-run')) process.exit(0)

/* ---------------------------------------------------------------- capture -- */

const manifestFile = path.join(paths.root, 'references', 'manifest.json')
const used = new Set()
if (existsSync(manifestFile)) {
  try {
    for (const slug of usedSlugsFromManifest(JSON.parse(readFileSync(manifestFile, 'utf8')))) used.add(slug)
  } catch {
    // a corrupt manifest is capture's problem; start with no known slugs
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return 'reference'
  }
}

const captured = []
const failed = []
for (const [index, pick] of picks.entries()) {
  const base = pick.slug || hostnameOf(pick.url)
  const slug = nextSlug(base, used)
  const captureArgs = captureOne(pick, slug, eagle.target)
  if (!json) console.log(`\n[${index + 1}/${picks.length}] ${pick.title}`)
  const result = spawnSync(process.execPath, captureArgs, {
    stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  })
  if (result.status === 0) {
    captured.push({ slug, url: pick.url, source: pick.source, title: pick.title })
  } else {
    failed.push({
      slug,
      url: pick.url,
      source: pick.source,
      status: result.status,
      stderr: String(result.stderr ?? '').trim().slice(-800),
    })
    if (!json) console.error(`✗ ${slug} failed (exit ${result.status})`)
  }
}

const summary = {
  seed,
  sources: reports,
  picks,
  captured,
  failed,
  eagle: { running: eagle.status.running, library: eagle.status.library, mode: eagle.mode, target: eagle.target },
  manifest: rel(manifestFile),
}

if (json) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(
    `\n${captured.length} captured · ${failed.length} failed · ${rel(manifestFile)}` +
      `\nseed ${seed} — rerun with --seed ${seed} for the same picks.` +
      (captured.length ? `\nnext: bin/probe refs --config ${rel(paths.config)}` : ''),
  )
  if (failed.length) {
    console.error('\nfailed:')
    for (const item of failed) console.error(`  ${item.slug} — ${item.url}`)
  }
}

process.exit(failed.length ? 1 : 0)
