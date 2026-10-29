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
import { resolveLibrary, folderNames, apiAvailable } from './library.mjs'

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

/* ------------------------------------------------------------ classifier -- */

function makeClassifier(source) {
  const SOCIAL = /(^|\.)(pinterest\.[a-z.]+|instagram\.com|dribbble\.com|behance\.net|x\.com|twitter\.com|tumblr\.com|youtube\.com|tiktok\.com|facebook\.com|reddit\.com)$/i
  const GALLERY = /(^|\.)(land-book\.com|landingfolio\.com|lapa\.ninja|saaslandingpage\.com|pagecollective\.com|godly\.website|awwwards\.com|siteinspire\.com|huaban\.com)$/i
  const ASSET_SOURCE = /(^|\.)(veekun\.com|cdn\.discordapp\.com|silverstag\.gumroad\.com|huaban\.com|sketch\.com)$/i
  const generatedPrefix = source.generatedPrefix ? new RegExp(`^${source.generatedPrefix}`) : null

  return (item, folderName = {}) => {
    const host = hostOf(item.url)
    const ratio = item.height / item.width
    const tags = item.tags ?? []
    const isSpecimen =
      !item.url && item.width <= 800 && item.height <= 800 && tags.some((t) => /regular|heavy|bold|italic|light/i.test(t))
    let kind
    let reason
    if (isSpecimen) [kind, reason] = ['specimen', 'no URL, font-weight tag, small square']
    else if (generatedPrefix && generatedPrefix.test(item.name ?? '')) [kind, reason] = ['asset', 'generated asset, not a capture']
    else if (!item.url) [kind, reason] = ['asset', 'no source URL']
    else if (SOCIAL.test(host)) [kind, reason] = ['mood', `saved from ${host}`]
    else if (ASSET_SOURCE.test(host)) [kind, reason] = ['asset', `${host} holds artwork, not sites`]
    else if (item.width < 800) [kind, reason] = ['unknown', 'too small to read']
    else if (item.width >= 1000 && ratio >= 1.6) [kind, reason] = ['page', `${ratio.toFixed(1)}× tall capture`]
    else if (item.width >= 1000 && ratio >= 1.0) [kind, reason] = ['screen', 'portrait capture']
    else if (ratio < 1.0) [kind, reason] = ['detail', 'landscape crop or viewport shot']
    else [kind, reason] = ['unknown', 'unclassified']

    return {
      id: item.id,
      name: item.name,
      url: item.url || null,
      host,
      via: GALLERY.test(host) ? host : null,
      width: item.width,
      height: item.height,
      ratio: Number((item.height / item.width).toFixed(2)),
      ext: item.ext,
      tags,
      folders: (item.folders ?? []).map((f) => folderName[f] ?? f),
      palette: (item.palettes ?? []).slice(0, 3).map((p) => `#${p.color.map((c) => c.toString(16).padStart(2, '0')).join('')}`),
      kind,
      reason,
    }
  }
}

/* ------------------------------------------------------- ingest via API -- */

const API = 'http://localhost:41595/api/v2'
const FIELDS = ['id', 'name', 'url', 'width', 'height', 'tags', 'folders', 'ext', 'isDeleted', 'palettes']

async function ingestViaApi(lib, source) {
  if (!(await apiAvailable())) return false
  const classify = makeClassifier(source)
  const folderName = folderNames(lib.info)

  const items = []
  let offset = 0
  let total = null
  const limit = 1000
  while (true) {
    const res = await fetch(`${API}/item/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit, offset, fields: FIELDS }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return false
    const json = await res.json()
    const page = json?.data
    if (!Array.isArray(page?.data)) return false
    total = page.total ?? total
    items.push(...page.data)
    offset += page.data.length
    if (!page.data.length || (total != null && offset >= total)) break
  }
  if (!items.length) return false

  const classified = items
    .filter((i) => !i.isDeleted)
    .map((i) => classify(i, folderName))
  const counts = classified.reduce((acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc), {})
  const usable = classified.filter((i) => i.kind === 'page' || i.kind === 'screen')

  // The file path is constructed, not read: the library may be unreadable to
  // this process, but the path is still valid for a later run with access.
  for (const item of usable) item.file = path.join(lib.path, 'images', `${item.id}.info`)

  writeFileSync(
    path.join(outDir, 'library.json'),
    JSON.stringify({ name: lib.name, path: lib.path, total, generatedAt: new Date().toISOString(), via: 'api-v2' }, null, 2) + '\n',
  )

  writeCandidates(
    usable,
    `library: ${lib.name} (${items.length} items via Web API v2${total ? `, ${total} total` : ''})\n` +
      `classification: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
  )
  return true
}

/* ------------------------------------------------------------------ eagle -- */

if (kind === 'eagle') {
  const explicit = source.path ? path.resolve(paths.root, source.path) : paths.args.get('library-path')
  const lib = await resolveLibrary(explicit)
  if (await ingestViaApi(lib, source)) process.exit(0)

  // Fallback: filesystem + index cache, for an Eagle too old for Web API v2.
  const libraryName = lib.name
  const libraryPath = lib.path

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

  // Matching by item count alone is fragile once several libraries exist or have
  // been merged: a stale cache can be the same size and win the match. Confirm a
  // few ids actually exist in this library before trusting an index.
  const verifyCache = (file) => {
    try {
      const sample = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(0, 3)
        .map((line) => JSON.parse(line))
      if (!sample.length) return false
      return sample.every((item) => existsSync(path.join(libraryPath, 'images', `${item.id}.info`)))
    } catch {
      return false
    }
  }

  const near = caches.filter((c) => c.distance <= 5)
  const chosen = near.find((c) => verifyCache(c.file))
  if (!chosen) {
    const seen = near.slice(0, 4).map((c) => `${path.basename(c.file)} (${c.lines} lines, Δ${c.distance})`).join(', ')
    fail(
      `no Eagle index verifies against ${libraryName} (${itemDirs.length} items).\n` +
        `  Candidates: ${seen || 'none within 5 items'}\n` +
        '  Open Eagle and let it finish indexing this library, then retry.',
    )
  }

  const indexFile = chosen.file
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

const dir = path.resolve(paths.root, paths.args.get('library-path', source.path ?? 'references')) // folder is relative to the *project* being probed
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
