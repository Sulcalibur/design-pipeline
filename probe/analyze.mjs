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
import os from 'node:os'
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
  let file = option?.src && !/^https?:/i.test(option.src) ? path.resolve(paths.root, option.src) : imageFileFor(candidate ?? {})
  // When the library file is unreadable (macOS permission) or gone, measure the
  // live screenshot instead of skipping the reference.
  const liveShot = existing.images?.[id]?.live?.screenshot
  if ((!file || !existsSync(file)) && liveShot && existsSync(liveShot)) file = liveShot
  if ((!file || !existsSync(file)) && process.env.EAGLE_MEDIA_URL) {
    file = await fetchThroughMediaServer(id, process.env.EAGLE_MEDIA_URL)
  }
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
    ...(images[id] ?? {}),
    id,
    name: images[id]?.name ?? candidate?.name ?? option?.label ?? id,
    file,
    measuredAt: new Date().toISOString(),
    method: record.method,
    measured: record.measured,
    authored: images[id]?.authored ?? {
      style: null,
      layoutModel: null,
      heroPosture: null,
      nav: null,
      mediaTreatment: null,
      colourRoles: [],
      typeVoice: null,
      sections: [],
      devices: [],
      avoid: [],
      rating: null,
      confidence: null,
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

/* ------------------------------------------------------------- brief ---- */

if (args.has('brief')) {
  const template = {
    style: 'editorial / quiet',
    layoutModel: 'single column with a right rail',
    heroPosture: 'centred display over a full-bleed image',
    nav: 'wordmark left, four pill links right',
    mediaTreatment: 'plated images with small captions',
    colourRoles: ['paper: warm off-white', 'ink: near-black', 'accent: one coral CTA'],
    typeVoice: 'high-contrast serif display; body serif at 18px',
    sections: [{ name: 'Start here', job: 'send a new reader in', composition: 'two large cards side by side' }],
    devices: ['date-stamped entries', 'ruled index'],
    avoid: ['the wordmark repeated in the hero'],
    rating: 4,
    confidence: 'high',
    notes: 'Rhythm comes from image heights, not spacing.',
    reviewedBy: 'design-director',
    reviewedAt: new Date().toISOString(),
  }

  const blocks = ids
    .map((id) => {
      const entry = images[id]
      if (!entry) return null
      const m = entry.measured
      return `## ${id}${entry.name ? ` — ${entry.name}` : ''}

\`${entry.file}\`

| measured | | | measured | |
|---|---|---|---|---|
| palette | ${m.palette.map((p) => `${p.hex} ${Math.round(p.share * 100)}%`).join(' · ')} | | density | ${m.visualDensity} (whitespace ${m.whitespace}) |
| bands | ${m.bands} | | columns (hint) | ${m.columns} |
| alignment (hint) | ${m.alignment} | | aspect | ${m.aspect} |
| contrast | ${m.contrast} | | temperature | ${m.temperature} |

Fill \`authored\` for this id in \`data/analysis.json\`:

\`\`\`json
${JSON.stringify(template, null, 2)}
\`\`\`
`
    })
    .filter(Boolean)
    .join('\n')

  const brief = `# Look sheet — ${ids.length} reference${ids.length === 1 ? '' : 's'}

You are the author of the semantic layer. The measurements below are already
taken; do not repeat them and do not contradict them without saying so.

For each image:

1. Open the file with the image-reading tool. If you cannot see images, stop:
   write \`confidence: "none"\` and \`notes: "not looked at"\`, and say so in chat.
2. Describe **structure**, not surface: hero posture, the section order and each
   section's job and composition, nav model, media treatment, colour roles, type
   voice.
3. Name the **device** worth borrowing and what must not be copied.
4. Never name a font family unless the source states it. Describe the voice.
5. If a measurement and what you see disagree, record the disagreement in
   \`notes\` — do not silently overwrite it.

Valid \`confidence\`: \`high\`, \`medium\`, \`low\`, \`none\`.

${blocks}`

  const briefPath = path.join(paths.data, 'look-sheet.md')
  writeFileSync(briefPath, brief)
  console.log(`\nlook sheet → ${rel(briefPath)}`)
}

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
  style, layoutModel, heroPosture, nav, mediaTreatment, colourRoles[], typeVoice,
  sections[{name, job, composition}], devices[], avoid[], rating, confidence, notes,
  reviewedBy, reviewedAt
A refresh only rewrites "measured"; "authored" is preserved.
Add --brief to write data/look-sheet.md: the per-image authoring contract.
`)
