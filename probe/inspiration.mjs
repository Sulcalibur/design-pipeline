/**
 * probe/inspiration.mjs — the parts of `probe inspire` that can be tested
 * without a network, a browser or Eagle.
 *
 * A source turns a response into candidate references: a live URL, a title and
 * whatever provenance the source knows. Choosing and filing are separate, so
 * the same candidates can be inspected with --dry-run before anything is
 * captured.
 */
import { existsSync, readFileSync, accessSync, constants } from 'node:fs'
import path from 'node:path'
import { mcpJson, mcpText } from './mcp.mjs'

export const INSPIRATION_DEFAULTS = {
  eagle: 'auto',
  count: 4,
  seed: null,
  sources: {
    awwwards: {
      enabled: true,
      award: 'sotd',
      sortBy: 'newest',
      page: 1,
      count: 12,
      query: '',
      tags: [],
      technology: '',
      color: '',
    },
    pinterest: {
      enabled: false,
      query: 'web design landing page',
      media: 'image',
      limit: 30,
    },
    feed: {
      enabled: false,
      path: 'references/inspiration.json',
    },
  },
}

export const SOURCE_NAMES = Object.keys(INSPIRATION_DEFAULTS.sources)

/**
 * Merge the config's `inspiration` block over the defaults.
 *
 * A config with no block at all gets the defaults (Awwwards on). Once a
 * `sources` object is written, it is authoritative: only `enabled: true`
 * entries run, so turning something off never depends on remembering a
 * default.
 */
export function inspirationSettings(config = {}) {
  const raw = config?.inspiration ?? {}
  const rawSources = raw.sources && typeof raw.sources === 'object' ? raw.sources : null
  const hasSources = !!rawSources && Object.keys(rawSources).length > 0
  const sources = {}
  const unknownSources = []

  for (const name of SOURCE_NAMES) {
    const defaults = INSPIRATION_DEFAULTS.sources[name]
    const block = rawSources?.[name]
    sources[name] = {
      ...defaults,
      ...(block && typeof block === 'object' ? block : {}),
      enabled: hasSources ? block?.enabled === true : defaults.enabled,
    }
  }
  for (const name of Object.keys(rawSources ?? {})) {
    if (!SOURCE_NAMES.includes(name)) unknownSources.push(name)
  }

  return {
    eagle: raw.eagle ?? INSPIRATION_DEFAULTS.eagle,
    count: Number.isInteger(raw.count) ? raw.count : INSPIRATION_DEFAULTS.count,
    seed: raw.seed ?? INSPIRATION_DEFAULTS.seed,
    sources,
    unknownSources,
  }
}

export function enabledSourceNames(settings) {
  return SOURCE_NAMES.filter((name) => settings.sources[name]?.enabled === true)
}

/** One line per source for `inspire --list`, with the settings that matter. */
export function describeSource(name, block = {}) {
  if (name === 'awwwards') {
    const bits = []
    if (block.award) bits.push(`award=${block.award}`)
    if (block.query) bits.push(`query="${block.query}"`)
    if (block.tags?.length) bits.push(`tags=${block.tags.join(',')}`)
    if (block.technology) bits.push(`tech=${block.technology}`)
    if (block.color) bits.push(`color=${block.color}`)
    bits.push(`sort=${block.sortBy ?? 'newest'}`, `page=${block.page ?? 1}`)
    return bits.join(' · ')
  }
  if (name === 'pinterest') {
    return [`query="${block.query ?? ''}"`, `media=${block.media ?? 'image'}`, `limit=${block.limit ?? 30}`].join(' · ')
  }
  if (name === 'feed') return block.path ?? 'references/inspiration.json'
  return 'unknown source'
}

/* ------------------------------------------------------------------ eagle -- */

export function normalizeEagleMode(value) {
  if (value === 'eagle' || value === 'on' || value === true) return 'on'
  if (value === 'folder' || value === 'off' || value === false) return 'off'
  return 'auto'
}

/**
 * Where should a capture go? `on` is a promise to the caller, not a hint:
 * if Eagle is not running it fails before any screenshot is taken.
 */
export function eagleTarget(mode, running) {
  const resolved = normalizeEagleMode(mode)
  if (resolved === 'off') return 'folder'
  if (resolved === 'on') {
    if (!running) {
      throw new Error('inspiration.eagle is "on" but Eagle is not running. Open Eagle, or set it to "auto" / "off".')
    }
    return 'eagle'
  }
  return running ? 'eagle' : 'folder'
}

/* --------------------------------------------------------------- commands -- */

/** Find an executable on PATH without shelling out. */
export function findBinary(name, envPath = process.env.PATH ?? '') {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    if (!existsSync(candidate)) continue
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // exists but is not executable
    }
  }
  return null
}

export function awwwardsCommand(block = {}) {
  if (Array.isArray(block.command) && block.command.length) {
    return { command: block.command[0], args: block.command.slice(1) }
  }
  const binary = process.env.AWWWARDS_MCP_BIN || findBinary('awwwards-mcp')
  if (binary) return { command: binary, args: [] }
  return { command: 'npx', args: ['-y', 'awwwards-mcp'] }
}

export function pinterestCommand(block = {}) {
  if (Array.isArray(block.command) && block.command.length) {
    return { command: block.command[0], args: block.command.slice(1) }
  }
  return { command: 'npx', args: ['-y', block.package ?? '@sunkimkk/pinterest-mcp@1.2.0'] }
}

/* --------------------------------------------------------------- adapters -- */

/**
 * Awwwards' compact search answer is a numbered list:
 *   1. SANTAL (slug: santal) | live: https://santalarch.com | awards: … | tags: …
 * Structured output is preferred when a server version provides it.
 */
export function candidatesFromAwwwards(result) {
  const structured = result?.structuredContent
  const sites = Array.isArray(structured) ? structured : structured?.sites ?? structured?.siteCards
  if (Array.isArray(sites) && sites.length) {
    return sites
      .map((site) => ({
        url: site.liveUrl ?? site.live ?? site.url,
        title: site.title ?? site.name ?? '',
        slug: site.slug ?? '',
        tags: Array.isArray(site.tags) ? site.tags : [],
        source: 'awwwards',
      }))
      .filter((candidate) => /^https?:\/\//i.test(candidate.url ?? ''))
  }

  const candidates = []
  for (const line of mcpText(result).split('\n')) {
    const match = /^\s*\d+\.\s+(.*?)\s*\(slug:\s*([A-Za-z0-9_-]+)\)\s*\|\s*live:\s*(\S+)/.exec(line)
    if (!match) continue
    const tail = line.slice(match.index + match[0].length)
    const tagsText = /\|\s*tags:\s*(.+)$/.exec(tail)?.[1] ?? ''
    const tags = tagsText
      .split(',')
      .map((tag) => tag.trim().replace(/\s+\+\d+$/, ''))
      .filter(Boolean)
    candidates.push({
      url: match[3],
      title: match[1].trim(),
      slug: match[2],
      tags,
      source: 'awwwards',
    })
  }
  return candidates
}

/**
 * Pinterest returns a JSON document in a text block. A pin without a source
 * page cannot be captured live, so it is counted and skipped rather than
 * silently dropped.
 */
export function candidatesFromPinterest(result) {
  const data = result?.structuredContent ?? mcpJson(result) ?? {}
  const pins = Array.isArray(data.pins) ? data.pins : []
  const candidates = []
  let skipped = 0
  for (const pin of pins) {
    const url = pin.source_link
    if (!url || !/^https?:\/\//i.test(url)) {
      skipped += 1
      continue
    }
    candidates.push({
      url,
      title: pin.title ?? pin.description ?? url,
      note: pin.description ?? '',
      image: pin.image_url ?? null,
      board: pin.board?.name ?? null,
      pinner: pin.pinner ?? null,
      source: 'pinterest',
    })
  }
  return { candidates, skipped, nextBookmark: data.next_bookmark ?? null }
}

/**
 * A feed is the escape hatch for sources without an adapter: a JSON array (or
 * { items: [] }) of URLs or { url, title, note, tags } objects.
 */
export function readFeed(file) {
  if (!existsSync(file)) throw new Error(`feed not found: ${file}`)
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`feed is not valid JSON: ${file} — ${error.message}`)
  }
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null
  if (!items) throw new Error(`feed must be an array or { items: [] }: ${file}`)
  const candidates = []
  for (const [index, item] of items.entries()) {
    const entry = typeof item === 'string' ? { url: item } : item
    if (!entry || typeof entry.url !== 'string' || !/^https?:\/\//i.test(entry.url)) {
      throw new Error(`feed item ${index + 1} has no http(s) url: ${file}`)
    }
    candidates.push({
      url: entry.url,
      title: entry.title ?? entry.url,
      note: entry.note ?? '',
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      source: 'feed',
    })
  }
  return candidates
}

/* ---------------------------------------------------------------- picking -- */

/** FNV-1a: stable across runs, unlike Math.random or an object hash. */
export function hash32(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** URLs that differ only by hash or a trailing slash are the same reference. */
export function urlKey(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.href.replace(/\/$/, '').toLowerCase()
  } catch {
    return String(url ?? '').trim().toLowerCase()
  }
}

/**
 * Shuffle each source by seed, then interleave. Interleaving prevents a large
 * source from crowding out a smaller one, which is the whole point of enabling
 * two.
 */
export function pickMixed(pools, count, seed) {
  const seen = new Set()
  const ordered = pools.map(({ source, candidates }) => {
    const local = []
    const localSeen = new Set()
    for (const candidate of candidates) {
      if (!candidate?.url) continue
      const key = urlKey(candidate.url)
      if (localSeen.has(key)) continue
      localSeen.add(key)
      local.push({ ...candidate, source: candidate.source ?? source })
    }
    local.sort((a, b) => hash32(`${seed}:${urlKey(a.url)}`) - hash32(`${seed}:${urlKey(b.url)}`) || urlKey(a.url).localeCompare(urlKey(b.url)))
    return local
  })

  const picked = []
  let added = true
  while (picked.length < count && added) {
    added = false
    for (const list of ordered) {
      if (!list.length) continue
      const candidate = list.shift()
      const key = urlKey(candidate.url)
      if (seen.has(key)) continue
      seen.add(key)
      picked.push(candidate)
      added = true
      if (picked.length >= count) break
    }
  }
  return picked
}

export function slugify(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'reference'
}

/** Mutates `used` so the next call cannot return the same slug. */
export function nextSlug(base, used) {
  const root = slugify(base)
  if (!used.has(root)) {
    used.add(root)
    return root
  }
  let index = 2
  while (used.has(`${root}-${index}`)) index += 1
  const slug = `${root}-${index}`
  used.add(slug)
  return slug
}

/** Slugs already present in a capture manifest, so a second run adds rather than overwrites. */
export function usedSlugsFromManifest(manifest) {
  const items = Array.isArray(manifest) ? manifest : manifest?.items ?? []
  const used = new Set()
  for (const item of items) {
    if (!item?.id) continue
    used.add(String(item.id).replace(/-(?:\d+x\d+|\d{3,4})$/, ''))
  }
  return used
}
