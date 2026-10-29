#!/usr/bin/env node
/**
 * probe/fonts.mjs — index the type specimens already in the Eagle library.
 *
 * Eagle holds font specimens as small, URL-less captures, often in folders named
 * "Fonts", "Better Fonts", a typeface name. This scans the library metadata,
 * keeps the specimens, and copies a preview of each so the brand interview can
 * show them beside the curated pairings.
 *
 * The library must be readable by this process (a local library, not iCloud).
 *
 *   node fonts.mjs --project . [--limit 80] [--library <path>]
 *
 * Writes docs/brand/data/fonts.json and docs/brand/fonts/<id>.<ext>.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import { resolveLibrary } from './library.mjs'

const args = parseArgs(process.argv.slice(2))
const cmd = args.positionals[0] ?? 'discover'
const project = path.resolve(process.cwd(), args.get('project', '.'))
const brandDir = path.resolve(project, args.get('dir', 'docs/brand'))
const outDir = path.join(brandDir, 'fonts')
const dataDir = path.join(brandDir, 'data')
const limit = Number(args.get('limit', 80))

/* ---------------------------------------------------------------- validate -- */

const SYSTEM_FONTS = new Set([
  'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'arial', 'helvetica',
  'helvetica neue', 'georgia', 'times', 'times new roman', 'courier', 'courier new', 'menlo', 'monaco',
  'sf pro', 'sf pro text', 'sf pro display', 'new york',
])

async function googleMetadata() {
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), 'Library/Caches')
  const dir = path.join(base, 'design-pipeline', 'fonts')
  const file = path.join(dir, 'google-metadata.json')
  mkdirSync(dir, { recursive: true })
  const fresh = existsSync(file) && Date.now() - JSON.parse(readFileSync(file, 'utf8')).fetchedAt < 1000 * 60 * 60 * 24 * 30
  if (fresh) return JSON.parse(readFileSync(file, 'utf8'))
  const res = await fetch('https://fonts.google.com/metadata/fonts', { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Google Fonts metadata ${res.status}`)
  const json = await res.json()
  const families = (json.familyMetadataList ?? []).map((f) => ({ family: f.family, category: f.category }))
  const payload = { fetchedAt: Date.now(), families }
  writeFileSync(file, JSON.stringify(payload))
  return payload
}

async function validateFonts() {
  const brandDir = path.resolve(project, args.get('dir', 'docs/brand'))
  const answersPath = path.join(brandDir, 'data/answers.json')
  if (!existsSync(answersPath)) fail(`no answers at ${answersPath} — run the brand interview first`)
  const { answers = {} } = JSON.parse(readFileSync(answersPath, 'utf8'))

  let meta
  try {
    meta = await googleMetadata()
  } catch (error) {
    fail(`could not fetch Google Fonts metadata (${error.message}). Offline? Nothing checked, nothing written.`)
  }
  const byName = new Map(meta.families.map((f) => [f.family.toLowerCase(), f]))

  const roles = [
    ['v3-display', 'display'],
    ['v3-body', 'body'],
    ['v3-ui', 'ui'],
  ]
  const results = []
  for (const [id, role] of roles) {
    const raw = String(answers[id]?.value ?? '').trim()
    if (!raw) continue
    // "Fraunces — display, 48–96px, OFL" -> Fraunces; "Lora, Georgia, serif" -> Lora
    const family = raw.split(/\s+[—-]\s+|,/)[0].replace(/["']/g, '').trim()
    if (!family) continue
    const key = family.toLowerCase()
    const google = byName.get(key)
    const verdict = google ? 'google' : SYSTEM_FONTS.has(key) ? 'system' : 'unknown'
    results.push({
      id,
      role,
      family,
      verdict,
      category: google?.category ?? null,
      note:
        verdict === 'google'
          ? `${google.category} · OFL family on Google Fonts`
          : verdict === 'system'
            ? 'system stack — no webfont licence needed'
            : 'not on Google Fonts: self-hosted, commercial, or misspelled — confirm the licence',
    })
  }

  mkdirSync(path.join(brandDir, 'data'), { recursive: true })
  writeFileSync(
    path.join(brandDir, 'data', 'font-check.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), checkedAgainst: 'fonts.google.com/metadata/fonts', results }, null, 2) + '\n',
  )

  console.log(`type check · ${results.length} role(s) · ${meta.families.length} Google families in catalogue`)
  for (const r of results) {
    const mark = r.verdict === 'google' ? '✓' : r.verdict === 'system' ? '·' : '!'
    console.log(`  ${mark} ${r.role.padEnd(8)} ${r.family.padEnd(24)} ${r.verdict.padEnd(8)} ${r.note}`)
  }
  console.log(`→ ${rel(path.join(brandDir, 'data', 'font-check.json'))}`)
}

if (cmd === 'validate') {
  await validateFonts()
  process.exit(0)
}

const lib = await resolveLibrary(args.get('library') ?? args.get('library-path'))
const library = lib.path

const imagesDir = path.join(library, 'images')
if (!existsSync(imagesDir)) fail(`library images not found: ${imagesDir}\n  Move the library to a local path and set EAGLE_LIBRARY, or pass --library <path>.`)

let entries
try {
  entries = readdirSync(imagesDir).filter((n) => n.endsWith('.info'))
} catch (error) {
  if (error.code === 'EPERM' || error.code === 'EACCES') {
    // The files are unreadable to this process, but the app's index is not:
    // the names are still useful, the previews are not.
    await discoverViaApi()
    process.exit(0)
  }
  fail(`cannot read ${imagesDir}: ${error.message}`)
}

async function discoverViaApi() {
  const API = 'http://localhost:41595/api/v2'
  const exts = ['ttf', 'otf', 'woff', 'woff2']
  const specimens = []
  for (const ext of exts) {
    try {
      const res = await fetch(`${API}/item/get`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ext, limit: 1000, fields: ['id', 'name', 'tags', 'width', 'height', 'ext'] }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      const json = await res.json()
      for (const item of json?.data?.data ?? []) {
        specimens.push({ id: item.id, name: item.name, tags: item.tags ?? [], ext: item.ext, width: item.width, height: item.height, image: null })
      }
    } catch {}
  }
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(
    path.join(dataDir, 'fonts.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), library: `${lib.name}.library`, count: specimens.length, via: 'api-v2', specimens }, null, 2) + '\n',
  )
  console.log(`library files are unreadable to this process; indexed ${specimens.length} font file(s) by name via the API.`)
  console.log(`→ ${rel(path.join(dataDir, 'fonts.json'))}`)
  console.log('Previews need local access: Full Disk Access, or a library outside iCloud.')
  if (!specimens.length) console.log('No ttf/otf/woff items found in the active library.')
}

const WEIGHT = /regular|heavy|bold|italic|light|medium|black|thin|extralight|semibold/i
const FONT_FOLDER = /font|typeface|type specimen|typo/i

const specimens = []
for (const entry of entries) {
  if (specimens.length >= limit) break
  const dir = path.join(imagesDir, entry)
  let meta
  try {
    meta = JSON.parse(readFileSync(path.join(dir, 'metadata.json'), 'utf8'))
  } catch {
    continue
  }
  if (meta.isDeleted || meta.url) continue
  const tags = meta.tags ?? []
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const looksLikeType = tags.some((t) => WEIGHT.test(t)) || FONT_FOLDER.test(meta.name ?? '')
  if (!looksLikeType || width > 1200 || height > 1200) continue

  // Prefer the original over Eagle's thumbnail; both are usually WebP.
  let file = null
  try {
    const files = readdirSync(dir).filter((n) => /\.(png|jpe?g|webp|gif)$/i.test(n))
    const originals = files.filter((n) => !/_thumbnail\./i.test(n))
    const pick = originals[0] ?? files[0]
    if (pick) file = path.join(dir, pick)
  } catch {
    continue
  }
  if (!file) continue
  specimens.push({
    id: meta.id,
    name: meta.name ?? meta.id,
    tags,
    width,
    height,
    ext: path.extname(file).slice(1).toLowerCase(),
    file,
  })
}

mkdirSync(outDir, { recursive: true })
mkdirSync(dataDir, { recursive: true })

const published = specimens.map((s) => {
  const target = path.join(outDir, `${s.id}.${s.ext}`)
  try {
    copyFileSync(s.file, target)
  } catch {
    return null
  }
  return { id: s.id, name: s.name, tags: s.tags, width: s.width, height: s.height, image: `fonts/${s.id}.${s.ext}` }
}).filter(Boolean)

writeFileSync(
  path.join(dataDir, 'fonts.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), library, count: published.length, specimens: published }, null, 2) + '\n',
)

console.log(`specimens ${published.length} → ${rel(path.join(dataDir, 'fonts.json'))}`)
console.log(`previews → ${rel(outDir)}`)
if (!published.length) {
  console.log('No URL-less, small, weight-tagged captures found. The library may name font folders differently — check one specimen and add its tags to WEIGHT in fonts.mjs.')
}
