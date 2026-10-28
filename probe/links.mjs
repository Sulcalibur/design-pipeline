#!/usr/bin/env node
/**
 * probe/links.mjs — resolve a gallery capture to the site it depicts.
 *
 * Eagle often stores the gallery page (lapa.ninja, land-book, landingfolio…) as
 * the item URL. The gallery page links to the real site; that hop is the join
 * between the image and a page that can actually be read.
 *
 * Resolution order:
 *   1. an existing link.siteUrl in analysis.json (manual or previous run)
 *   2. `--set <id>=<url>` — record a resolution made elsewhere (e.g. by the agent)
 *   3. JSON-LD on the gallery page (isBasedOn / url / sameAs)
 *   4. an anchor whose text says visit / preview / launch
 *   5. any off-host link that is not a social, CDN or affiliate host
 *
 * Many galleries sit behind Cloudflare and refuse non-browser clients. When that
 * happens the entry is marked `needsManual` with the reason — it is never guessed.
 *
 *   node links.mjs --config … [--ids a,b] [--all] [--limit 50] [--refresh]
 *   node links.mjs --config … --set LNHYNKWGWER0J=https://frontapp.com/
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { resolvePaths, loadConfig, loadCandidates, fail, rel } from './paths.mjs'

const paths = resolvePaths(process.argv.slice(2))
const args = paths.args

// Params that only ever exist to attribute a click. Stripped by default.
const TRACKING_PARAM =
  /^(ref|referrer|referer|ref_src|ref_url|source|src|via|from|utm_.*|utm|fbclid|gclid|dclid|msclkid|yclid|twclid|igshid|mc_cid|mc_eid|mkt_tok|_hsenc|_hsmi|_ga|_gl|vero_id|trk|trkcampaign|sc_cid|campaign|campaignid|affiliate|aff|partner|partnerid|cid|sid|sessionid|spm|share|sharesource)$/i

/**
 * Canonical form: no tracker params, no fragment, no default port, no trailing
 * slash, sorted query. The raw href is kept by the caller as provenance.
 */
function canonicalUrl(raw, mode = 'tracking', keep = [], base) {
  try {
    const url = new URL(raw, base)
    url.hash = ''
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = ''
    }
    if (mode !== 'none') {
      for (const key of [...url.searchParams.keys()]) {
        if (mode === 'all' || TRACKING_PARAM.test(key)) url.searchParams.delete(key)
      }
    }
    if (keep.length) {
      for (const key of [...url.searchParams.keys()]) {
        if (!keep.includes(key)) url.searchParams.delete(key)
      }
    }
    url.searchParams.sort()
    if (url.pathname !== '/' && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString().replace(/\?$/, '')
  } catch {
    return null
  }
}

// Debug helper: works without a config, so a URL can be checked anywhere.
if (args.get('clean')) {
  const output = canonicalUrl(args.get('clean'), args.get('strip') ?? 'tracking')
  console.log(output ?? 'could not parse')
  process.exit(output ? 0 : 1)
}

const config = loadConfig(paths.config)
const candidates = loadCandidates(paths.candidates)
if (!candidates) fail(`no candidates at ${paths.candidates} — run ingest first`)
const byId = new Map(candidates.map((c) => [c.id, c]))

const optionsById = new Map()
for (const pair of config.pairs ?? []) {
  for (const option of pair.options ?? []) optionsById.set(option.id, option)
}

const analysisPath = path.join(paths.data, 'analysis.json')
const analysis = existsSync(analysisPath) ? JSON.parse(readFileSync(analysisPath, 'utf8')) : { images: {} }
analysis.images ??= {}

if (args.get('clean')) {
  const input = args.get('clean')
  const output = cleanUrl(input)
  console.log(output ?? 'could not parse')
  process.exit(output ? 0 : 1)
}

/* --------------------------------------------------------- manual sets -- */

const manual = new Map()
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] !== '--set') continue
  const value = process.argv[i + 1] ?? ''
  const eq = value.indexOf('=')
  if (eq > 0) manual.set(value.slice(0, eq), value.slice(eq + 1))
}

/* ---------------------------------------------------------------- ids --- */

let ids
if (args.get('ids')) ids = String(args.get('ids')).split(',').map((s) => s.trim()).filter(Boolean)
else if (args.has('all')) ids = candidates.map((c) => c.id)
else ids = [...optionsById.keys()]
if (args.get('limit')) ids = ids.slice(0, Number(args.get('limit')))
if (!ids.length) fail('no ids: add pairs to the config, pass --ids, or use --all after ingest')

/* --------------------------------------------------------------- cache -- */

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30
const cacheDir = (() => {
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), 'Library/Caches')
  const dir = path.join(base, 'design-pipeline', 'links')
  mkdirSync(dir, { recursive: true })
  return dir
})()
const cacheKey = (url) => createHash('sha1').update(url).digest('hex').slice(0, 16)

/* -------------------------------------------------------------- fetch --- */

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-GB,en;q=0.9',
  'cache-control': 'no-cache',
  'sec-ch-ua': '"Chromium";v="156", "Not:A-Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
}

const SOCIAL = /(^|\.)(facebook\.com|twitter\.com|x\.com|instagram\.com|dribbble\.com|behance\.net|linkedin\.com|youtube\.com|pinterest\.[a-z.]+|t\.me|threads\.net|tiktok\.com|bsky\.app|cosmos\.so)$/i
const AFFILIATE = /(^|\.)(webflow\.com|framer\.link|framer\.com|cloudflare\.com|godaddy\.com|shopify\.com|squarespace\.com)$/i
const GALLERY = /(^|\.)(lapa\.ninja|land-book\.com|landingfolio\.com|saaslandingpage\.com|pagecollective\.com|godly\.website|awwwards\.com|siteinspire\.com)$/i

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const stripMode = args.get('strip') ?? config.links?.stripQuery ?? 'tracking'

/** Project-aware wrapper: mode and keep-list come from the config. */
function cleanUrl(raw, base) {
  return canonicalUrl(raw, stripMode, Array.isArray(config.links?.keepParams) ? config.links.keepParams : [], base)
}

/** Pick the site URL out of a gallery page. Returns {url, method} or null. */
function extractSite(html, galleryUrl) {
  const host = hostOf(galleryUrl)

  // 1. JSON-LD: the machine-readable answer when a gallery publishes one.
  for (const match of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim())
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) {
        for (const key of ['isBasedOn', 'url', 'contentUrl', 'mainEntityOfPage']) {
          const value = node?.[key]
          const raw = typeof value === 'string' ? value : value?.['@id'] ?? value?.url
          if (!raw) continue
          const url = cleanUrl(raw, galleryUrl)
          if (url && hostOf(url) && hostOf(url) !== host) return { url, linkedAs: raw, method: `ld-json:${key}` }
        }
        const sameAs = node?.sameAs ?? node?.subjectOf?.url
        for (const raw of Array.isArray(sameAs) ? sameAs : sameAs ? [sameAs] : []) {
          const url = cleanUrl(raw, galleryUrl)
          if (url && hostOf(url) && hostOf(url) !== host) return { url, linkedAs: raw, method: 'ld-json:sameAs' }
        }
      }
    } catch {
      // malformed block: ignore and keep looking
    }
  }

  // 2. The call to action galleries actually use.
  const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi)].map((m) => ({
    href: m[1],
    text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }))
  const usable = (url) => {
    const h = hostOf(url)
    return h && h !== host && !SOCIAL.test(h) && !AFFILIATE.test(h) && !GALLERY.test(h)
  }
  for (const { href, text } of anchors) {
    if (!/visit\s*(the\s*)?(website|site)|view\s*(the\s*)?site|live\s*(preview|site)|launch\s*site|open\s*site/i.test(text)) continue
    const url = cleanUrl(href, galleryUrl)
    if (url && usable(url)) return { url, method: 'anchor-cta' }
  }

  // 3. Last resort: an off-host, non-social link.
  for (const { href } of anchors) {
    const url = cleanUrl(href, galleryUrl)
    if (url && usable(url)) return { url, linkedAs: href, method: 'anchor-outbound' }
  }
  return null
}

async function fetchPage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal })
    const text = await res.text()
    const blocked = res.status === 403 || /Attention Required|Just a moment|cf-chl|Enable JavaScript and cookies/i.test(text)
    return { status: res.status, finalUrl: res.url, html: text, blocked }
  } catch (error) {
    return { status: null, finalUrl: url, html: '', blocked: false, error: error.message }
  } finally {
    clearTimeout(timer)
  }
}

async function verify(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12000) })
    const text = res.ok ? await res.text() : ''
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null
    return { status: res.status, finalUrl: res.url, title }
  } catch (error) {
    return { status: null, finalUrl: url, title: null, error: error.message }
  }
}

/* ---------------------------------------------------------------- run --- */

const results = []
const refresh = args.has('refresh')

for (const id of ids) {
  const option = optionsById.get(id)
  const candidate = byId.get(id)
  const galleryUrl = option?.url ?? candidate?.url ?? null
  const existing = analysis.images[id]?.link ?? null

  if (manual.has(id)) {
    const url = cleanUrl(manual.get(id))
    const verified = url ? await verify(url) : null
    analysis.images[id] = {
      ...(analysis.images[id] ?? { id, name: candidate?.name ?? option?.label ?? id }),
      link: {
        galleryUrl: existing?.galleryUrl ?? cleanUrl(galleryUrl),
        linkedAs: manual.get(id),
        siteUrl: url,
        finalUrl: verified?.finalUrl ?? url,
        title: verified?.title ?? null,
        status: verified?.status ?? null,
        method: 'manual',
        checkedAt: new Date().toISOString(),
        needsManual: false,
      },
    }
    results.push({ id, siteUrl: url, method: 'manual', status: verified?.status ?? null })
    continue
  }

  if (existing?.siteUrl && !refresh) {
    results.push({ id, siteUrl: existing.siteUrl, method: `${existing.method} (cached)`, status: existing.status ?? null })
    continue
  }

  if (!galleryUrl) {
    results.push({ id, skipped: 'no url on the candidate' })
    continue
  }

  if (!candidate?.via && !GALLERY.test(hostOf(galleryUrl))) {
    // Already the site: nothing to resolve.
    analysis.images[id] = {
      ...(analysis.images[id] ?? { id, name: candidate?.name ?? option?.label ?? id }),
      link: {
        galleryUrl: null,
        siteUrl: galleryUrl,
        finalUrl: galleryUrl,
        title: null,
        status: null,
        method: 'direct',
        checkedAt: new Date().toISOString(),
        needsManual: false,
      },
    }
    results.push({ id, siteUrl: galleryUrl, method: 'direct', status: null })
    continue
  }

  const cachePath = path.join(cacheDir, `${cacheKey(galleryUrl)}.json`)
  if (!refresh && existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (Date.now() - Date.parse(cached.checkedAt) < CACHE_TTL_MS) {
      analysis.images[id] = {
        ...(analysis.images[id] ?? { id, name: candidate?.name ?? option?.label ?? id }),
        link: cached,
      }
      results.push({ id, siteUrl: cached.siteUrl, method: `${cached.method} (cache)`, status: cached.status ?? null })
      continue
    }
  }

  const page = await fetchPage(galleryUrl)
  const found = page.blocked || !page.html ? null : extractSite(page.html, galleryUrl)
  const checkedAt = new Date().toISOString()

  let link
  if (found) {
    const verified = await verify(found.url)
    link = {
      galleryUrl: cleanUrl(galleryUrl) ?? galleryUrl,
      linkedAs: found.linkedAs ?? null,
      siteUrl: found.url,
      finalUrl: verified.finalUrl,
      title: verified.title,
      status: verified.status,
      method: found.method,
      checkedAt,
      needsManual: false,
    }
  } else {
    link = {
      galleryUrl: cleanUrl(galleryUrl) ?? galleryUrl,
      linkedAs: null,
      siteUrl: null,
      finalUrl: null,
      title: null,
      status: page.status,
      method: null,
      checkedAt,
      needsManual: true,
      reason: page.blocked
        ? `gallery refused the request (${page.status ?? 'blocked'}) — Cloudflare or similar`
        : page.error
          ? `fetch failed: ${page.error}`
          : 'no site link found on the gallery page',
    }
  }

  // Only a real resolution is cached. A block is a property of the network and
  // the moment; caching it would make a later attempt impossible.
  if (!link.needsManual) writeFileSync(cachePath, JSON.stringify(link, null, 2))
  analysis.images[id] = {
    ...(analysis.images[id] ?? { id, name: candidate?.name ?? option?.label ?? id }),
    link,
  }
  results.push({ id, siteUrl: link.siteUrl, method: link.method ?? 'unresolved', status: link.status, reason: link.reason })
}

mkdirSync(paths.data, { recursive: true })
writeFileSync(analysisPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...analysis }, null, 2) + '\n')

/* ------------------------------------------------------------- report --- */

const resolved = results.filter((r) => r.siteUrl)
const manualNeeded = results.filter((r) => !r.siteUrl && !r.skipped)
console.log(`resolved ${resolved.length} · needs manual ${manualNeeded.length} · skipped ${results.filter((r) => r.skipped).length}`)
for (const r of results) {
  if (r.skipped) console.log(`  · ${r.id}: ${r.skipped}`)
  else if (r.siteUrl) console.log(`  ✓ ${r.id} ${String(r.status ?? '').padEnd(4)} ${r.method.padEnd(18)} ${r.siteUrl}`)
  else console.log(`  ! ${r.id}: ${r.reason}`)
}
console.log(`→ ${rel(analysisPath)}  (link layer)`)

if (manualNeeded.length) {
  console.log(`
Some galleries refuse a non-browser client. That is not a failure to hide.

Resolve those with any tool that can read the page — a fetch tool, a browser,
or by hand — then record the answer:

  node probe.mjs links --config … --set <id>=<site-url>

The gallery page's "Visit website" link is the answer. The recorded link is
what \`live\` will use, and what the authored layer cites.`)
}
