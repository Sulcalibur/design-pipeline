#!/usr/bin/env node
/**
 * probe/analyze.mjs — measure the references and keep a written profile.
 *
 * Two layers per image:
 *
 *   measured   what pixels can prove: palette and proportions, background,
 *              whitespace, luminance, contrast, temperature, edge density,
 *              section bands, column guess, alignment, aspect.
 *   authored   what only looking can tell you: style, type voice, layout model,
 *              devices worth borrowing, what not to copy, a rating, notes.
 *
 * Measurement is cached machine-wide by library + id + mtime, so a library is
 * read once and reused by every project. The authored layer lives with the
 * project in <data>/analysis.json and is never overwritten by a refresh.
 *
 *   node analyze.mjs --config …                 # ids used by the pair config
 *   node analyze.mjs --config … --all [--limit 200]
 *   node analyze.mjs --config … --ids a,b,c [--refresh]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { resolvePaths, loadConfig, loadCandidates, fail, rel } from './paths.mjs'
import { loadPixels, measure, imageFileFor, cacheKey, cacheDir, METHOD, LIMITS } from './image.mjs'

const paths = resolvePaths(process.argv.slice(2))
const args = paths.args
const config = loadConfig(paths.config)
const candidates = loadCandidates(paths.candidates)
if (!candidates) fail(`no candidates at ${paths.candidates} — run ingest first`)
const byId = new Map(candidates.map((c) => [c.id, c]))

const optionsById = new Map()
for (const pair of config.pairs ?? []) {
  for (const option of pair.options ?? []) optionsById.set(option.id, option)
}

let ids
if (args.get('ids')) ids = String(args.get('ids')).split(',').map((s) => s.trim()).filter(Boolean)
else if (args.has('all')) ids = candidates.map((c) => c.id)
else ids = [...optionsById.keys()]

const limit = args.get('limit') ? Number(args.get('limit')) : null
if (limit) ids = ids.slice(0, limit)

if (!ids.length) {
  fail('no ids to analyse: add pairs to the config, pass --ids, or use --all after ingest')
}

const sourceKey = config.sources?.path ?? config.sources?.library ?? 'eagle'
const cache = cacheDir()
const refresh = args.has('refresh')
const analysisPath = path.join(paths.data, 'analysis.json')

const existing = existsSync(analysisPath) ? JSON.parse(readFileSync(analysisPath, 'utf8')) : {}
const images = existing.images ?? {}

let measured = 0
let reused = 0
const skipped = []

for (const id of ids) {
  const option = optionsById.get(id)
  const candidate = byId.get(id)
  const file = option?.src && !/^https?:/i.test(option.src) ? path.resolve(paths.root, option.src) : imageFileFor(candidate ?? {})
  if (!file || !existsSync(file)) {
    skipped.push({ id, reason: candidate ? 'no local image file' : 'not in candidates.json' })
    continue
  }

  const stat = statSync(file)
  const key = cacheKey(sourceKey, id)
  const cachePath = path.join(cache, `${key}.json`)

  let record = null
  if (!refresh && existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      record = cached
      reused += 1
    }
  }

  if (!record) {
    const pixels = loadPixels(file)
    if (!pixels) {
      skipped.push({ id, reason: 'sips could not decode the image' })
      continue
    }
    record = {
      v: 1,
      id,
      file,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      method: METHOD,
      measured: measure(pixels),
    }
    writeFileSync(cachePath, JSON.stringify(record, null, 2))
    measured += 1
  }

  images[id] = {
    id,
    name: candidate?.name ?? option?.label ?? id,
    file,
    measuredAt: new Date().toISOString(),
    method: record.method,
    measured: record.measured,
    authored: images[id]?.authored ?? {
      style: null,
      typeVoice: null,
      layout: null,
      devices: [],
      avoid: [],
      rating: null,
      notes: null,
      reviewedBy: null,
      reviewedAt: null,
    },
  }
}

mkdirSync(paths.data, { recursive: true })
writeFileSync(
  analysisPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: sourceKey,
      method: METHOD,
      limits: LIMITS,
      counts: { total: Object.keys(images).length, measured, reused, skipped: skipped.length },
      images,
    },
    null,
    2,
  ) + '\n',
)

/* ------------------------------------------------------------- report ---- */

console.log(`analysed ${measured} · reused ${reused} · skipped ${skipped.length}`)
console.log(`→ ${rel(analysisPath)}`)
console.log(`cache → ${rel(path.join(cache, '…'))}`)
if (skipped.length) {
  console.log('\nskipped:')
  for (const s of skipped.slice(0, 12)) console.log(`  ${s.id}: ${s.reason}`)
  if (skipped.length > 12) console.log(`  … ${skipped.length - 12} more`)
}

console.log('\nprofiles:')
for (const id of ids) {
  const entry = images[id]
  if (!entry) continue
  const m = entry.measured
  const chips = m.palette.slice(0, 4).map((p) => p.hex).join(' ')
  console.log(
    `  ${id.padEnd(16)} ${chips}  ${m.visualDensity.padEnd(8)} ws ${m.whitespace}  bands ${String(m.bands).padStart(2)}  cols ${m.columns}  ${m.alignment}`,
  )
}

console.log(`
The authored layer is yours to fill in ${rel(analysisPath)}:
  style, typeVoice, layout, devices[], avoid[], rating, notes, reviewedBy, reviewedAt
A refresh only rewrites "measured"; "authored" is preserved.
`)
