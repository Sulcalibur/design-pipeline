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

const args = parseArgs(process.argv.slice(2))
const project = path.resolve(process.cwd(), args.get('project', '.'))
const brandDir = path.resolve(project, args.get('dir', 'docs/brand'))
const outDir = path.join(brandDir, 'fonts')
const dataDir = path.join(brandDir, 'data')
const limit = Number(args.get('limit', 80))

const library =
  args.get('library') ??
  process.env.EAGLE_LIBRARY ??
  path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Eagle/Inspirations.library')

const imagesDir = path.join(library, 'images')
if (!existsSync(imagesDir)) fail(`library images not found: ${imagesDir}\n  Move the library to a local path and set EAGLE_LIBRARY, or pass --library <path>.`)

let entries
try {
  entries = readdirSync(imagesDir).filter((n) => n.endsWith('.info'))
} catch (error) {
  if (error.code === 'EPERM' || error.code === 'EACCES') {
    fail(
      `cannot read ${imagesDir} (${error.code}).\n` +
        '  macOS denied access to iCloud Drive. Move the library out of iCloud, or run this from a\n' +
        '  terminal that has permission.',
    )
  }
  fail(`cannot read ${imagesDir}: ${error.message}`)
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
