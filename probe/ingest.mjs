#!/usr/bin/env node
/**
 * probe/ingest.mjs — index the reference source.
 *
 * Two adapters, same output shape:
 *
 *   eagle   (default) reads the Eagle library index and item directories, and
 *           separates real captures from specimens, assets and mood pins.
 *   folder  reads <sources.path>/manifest.json — a curated list of local files
 *           or remote URLs. Nothing is classified away: the manifest is the
 *           judgement, so every entry is kept.
 *
 * Read-only. Writes data/candidates.json.
 *
 *   node ingest.mjs --config <project>/probe.config.json
 *   node ingest.mjs --config … --library-path ~/shots
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolvePaths, loadConfig, fail, rel } from './paths.mjs'

const paths = resolvePaths(process.argv.slice(2))
const config = loadConfig(paths.config)
const source = config.sources ?? {}
const kind = paths.args.get('source', source.kind ?? 'eagle')
const outDir = paths.data

mkdirSync(outDir, { recursive: true })

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const writeCandidates = (usable, extra) => {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(paths.candidates, JSON.stringify(usable, null, 2))
  const byHost = usable.reduce((acc, i) => ((acc[i.host || '(local)'] = (acc[i.host || '(local)'] ?? 0) + 1), acc), {})
  console.log(`usable captures: ${usable.length} → ${rel(paths.candidates)}`)
  if (extra) console.log(extra)
  if (Object.keys(byHost).length) {
    console.log(
      'top hosts:',
      Object.entries(byHost)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([h, n]) => `${h} ${n}`)
        .join(' · '),
    )
  }
}

/* ------------------------------------------------------------------ eagle -- */

if (kind === 'eagle') {
  const libraryName = source.library ?? paths.args.get('library', 'Inspirations')
  const root = path.join(homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Eagle')
  const libraryPath = source.path ? path.resolve(paths.root, source.path) : path.join(root, `${libraryName}.library`)

  if (!existsSync(libraryPath)) fail(`library not found: ${libraryPath}`)

  const cacheDir = path.join(homedir(), 'Library/Application Support/Eagle/library-caches')
  if (!existsSync(cacheDir)) fail(`Eagle library cache not found: ${cacheDir} — open Eagle once, or use sources.kind "folder"`)

  const itemDirsPath = path.join(libraryPath, 'images')
  let itemDirs
  try {
    itemDirs = readdirSync(itemDirsPath).filter((n) => n.endsWith('.info'))
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      fail(
        `cannot read ${itemDirsPath} (${error.code}).\n` +
          '  macOS denied file access to this process. Run the command from a terminal with iCloud Drive\n' +
          '  access, or grant Full Disk Access to the app hosting the agent.\n' +
          '  A folder source needs no such permission: set sources.kind to "folder".',
      )
    }
    fail(`cannot read ${itemDirsPath}: ${error.message}`)
  }
  const caches = readdirSync(cacheDir)
    .filter((n) => n.endsWith('.txt'))
    .map((n) => ({ file: path.join(cacheDir, n), lines: readFileSync(path.join(cacheDir, n), 'utf8').trim().split('\n').length }))
    .map((c) => ({ ...c, distance: Math.abs(c.lines - itemDirs.length) }))
    .sort((a, b) => a.distance - b.distance)

  if (!caches[0] || caches[0].distance > 5) {
    fail(`no Eagle index file matches ${itemDirs.length} items in ${libraryName}`)
  }

  const indexFile = caches[0].file
  const items = readFileSync(indexFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

  const meta = JSON.parse(readFileSync(path.join(libraryPath, 'metadata.json'), 'utf8'))
  const folderName = {}
  const walkFolders = (folders) => {
    for (const f of folders ?? []) {
      folderName[f.id] = f.name
      walkFolders(f.children)
    }
  }
  walkFolders(meta.folders)

  const SOCIAL = /(^|\.)(pinterest\.[a-z.]+|instagram\.com|dribbble\.com|behance\.net|x\.com|twitter\.com|tumblr\.com|youtube\.com|tiktok\.com|facebook\.com|reddit\.com)$/i
  const GALLERY = /(^|\.)(land-book\.com|landingfolio\.com|lapa\.ninja|saaslandingpage\.com|pagecollective\.com|godly\.website|awwwards\.com|siteinspire\.com|huaban\.com)$/i
  const ASSET_SOURCE = /(^|\.)(veekun\.com|cdn\.discordapp\.com|silverstag\.gumroad\.com|huaban\.com|sketch\.com)$/i
  const generatedPrefix = source.generatedPrefix ? new RegExp(`^${source.generatedPrefix}`) : null

  function classify(item) {
    const host = hostOf(item.url)
    const ratio = item.height / item.width
    const tags = item.tags ?? []
    const isSpecimen =
      !item.url && item.width <= 800 && item.height <= 800 && tags.some((t) => /regular|heavy|bold|italic|light/i.test(t))
    if (isSpecimen) return { kind: 'specimen', reason: 'no URL, font-weight tag, small square' }
    if (generatedPrefix && generatedPrefix.test(item.name)) return { kind: 'asset', reason: 'generated asset, not a capture' }
    if (!item.url) return { kind: 'asset', reason: 'no source URL' }
    if (SOCIAL.test(host)) return { kind: 'mood', reason: `saved from ${host}` }
    if (ASSET_SOURCE.test(host)) return { kind: 'asset', reason: `${host} holds artwork, not sites` }
    if (item.width < 800) return { kind: 'unknown', reason: 'too small to read' }
    if (item.width >= 1000 && ratio >= 1.6) return { kind: 'page', reason: `${ratio.toFixed(1)}× tall capture` }
    if (item.width >= 1000 && ratio >= 1.0) return { kind: 'screen', reason: 'portrait capture' }
    if (ratio < 1.0) return { kind: 'detail', reason: 'landscape crop or viewport shot' }
    return { kind: 'unknown', reason: 'unclassified' }
  }

  const classified = items
    .filter((i) => !i.isDeleted)
    .map((i) => {
      const { kind: k, reason } = classify(i)
      const host = hostOf(i.url)
      return {
        id: i.id,
        name: i.name,
        url: i.url || null,
        host,
        via: GALLERY.test(host) ? host : null,
        width: i.width,
        height: i.height,
        ratio: Number((i.height / i.width).toFixed(2)),
        ext: i.ext,
        tags: i.tags ?? [],
        folders: (i.folders ?? []).map((f) => folderName[f] ?? f),
        palette: (i.palettes ?? []).slice(0, 3).map((p) => `#${p.color.map((c) => c.toString(16).padStart(2, '0')).join('')}`),
        kind: k,
        reason,
        file: path.join(libraryPath, 'images', `${i.id}.info`),
      }
    })

  const counts = classified.reduce((acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc), {})
  const usable = classified.filter((i) => i.kind === 'page' || i.kind === 'screen')

  writeCandidates(
    usable,
    `library: ${libraryName} (${items.length} items, index ${path.basename(indexFile)})\n` +
      `classification: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
  )
  process.exit(0)
}

/* ----------------------------------------------------------------- folder -- */

if (kind !== 'folder') fail(`unknown sources.kind "${kind}" — use "eagle" or "folder"`)

const dir = path.resolve(paths.root, paths.args.get('library-path', source.path ?? 'references'))
const manifestPath = path.join(dir, 'manifest.json')
if (!existsSync(manifestPath)) {
  fail(`manifest not found: ${manifestPath}\n  Expected { "items": [ { "id", "name", "file", "url"?, "width"?, "height"?, "kind"? } ] }`)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  fail(`manifest is not valid JSON: ${error.message}`)
}
const entries = Array.isArray(manifest) ? manifest : manifest.items ?? []
if (!entries.length) fail(`manifest has no items: ${manifestPath}`)

const problems = []
const usable = entries.map((entry, index) => {
  const id = entry.id ?? `ref-${String(index + 1).padStart(2, '0')}`
  if (!entry.file && !entry.url) problems.push(`${id}: needs "file" or "url"`)
  let file = null
  if (entry.file) {
    file = path.isAbsolute(entry.file) ? entry.file : path.resolve(dir, entry.file)
    if (!existsSync(file)) problems.push(`${id}: file not found ${file}`)
  }
  const width = entry.width ?? null
  const height = entry.height ?? null
  return {
    id,
    name: entry.name ?? id,
    url: entry.url ?? null,
    host: hostOf(entry.url),
    via: entry.via ?? null,
    width,
    height,
    ratio: width && height ? Number((height / width).toFixed(2)) : null,
    ext: file ? path.extname(file).slice(1).toLowerCase() : null,
    tags: entry.tags ?? [],
    folders: entry.folders ?? [],
    palette: entry.palette ?? [],
    kind: entry.kind ?? 'page',
    reason: entry.reason ?? 'curated in the folder manifest',
    file,
    src: entry.url && !file ? entry.url : null,
  }
})

if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`)
  fail(`${problems.length} manifest problem(s). Nothing written.`)
}

writeCandidates(usable, `folder: ${path.relative(process.cwd(), dir)} (${entries.length} curated entries)`)
