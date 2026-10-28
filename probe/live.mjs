#!/usr/bin/env node
/**
 * probe/live.mjs — read the reference's live page, as text, not pixels.
 *
 * A screenshot proves what was seen; the live page proves what is true now:
 * the actual font stacks, computed colours, declared custom properties, section
 * sizes and the motion that exists. Both are evidence, for different questions.
 *
 * Uses puppeteer-core (installed in this repo) and an isolated Chrome for
 * Testing binary. One page per id, no crawling.
 *
 *   node live.mjs --config …                    # ids referenced by pairs
 *   node live.mjs --config … --ids a,b --limit 10
 *   node live.mjs --config … --all [--limit 20]
 *
 * Gallery captures are skipped: a land-book / landingfolio URL is the gallery,
 * not the site, and following it is scraping, not research.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolvePaths, loadConfig, loadCandidates, fail, rel } from './paths.mjs'

const require = createRequire(import.meta.url)
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
if (args.get('limit')) ids = ids.slice(0, Number(args.get('limit')))
if (!ids.length) fail('no ids: add pairs to the config, pass --ids, or use --all after ingest')

/* ------------------------------------------------------------- browser -- */

function resolveChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(
      process.env.HOME,
      'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ),
    path.join(
      process.env.HOME,
      '.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ),
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) ?? null
}

async function loadPuppeteer() {
  try {
    return (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default
  } catch {}
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return (await import(pathToFileURL(createRequire(path.join(root, 'noop.js')).resolve('puppeteer-core')).href)).default
  } catch {}
  return null
}

const puppeteer = await loadPuppeteer()
if (!puppeteer) fail('puppeteer-core not found — run: npm i --save-optional puppeteer-core@24 in this repo')
const chrome = resolveChrome()
if (!chrome) fail('no Chrome for Testing found — set CHROME_PATH')

/* ------------------------------------------------------------- extract -- */

const EXTRACT = () => {
  const style = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90),
      fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      color: cs.color,
      background: cs.backgroundColor,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  const rootProps = {}
  for (const sheet of Array.from(document.styleSheets)) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin stylesheet: not readable
    }
    for (const rule of Array.from(rules ?? [])) {
      if (!rule.selectorText || !/:root|^html$/.test(rule.selectorText)) continue
      for (const name of Array.from(rule.style ?? [])) {
        if (!name.startsWith('--')) continue
        const value = rule.style.getPropertyValue(name).trim()
        if (value && !/var\(/.test(value)) rootProps[name] = value
      }
    }
  }

  const colourCount = new Map()
  const bump = (value) => {
    if (!value || value === 'rgba(0, 0, 0, 0)' || value === 'transparent') return
    colourCount.set(value, (colourCount.get(value) ?? 0) + 1)
  }
  for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 4000)) {
    const cs = getComputedStyle(el)
    bump(cs.color)
    bump(cs.backgroundColor)
  }

  // Sections: the direct children of the main container. A framework page may
  // put everything in one wrapper, so fall back to body children, then <section>.
  const container = ['main', '[role="main"]', '#main', '#content']
    .map((sel) => document.querySelector(sel))
    .find((el) => el && el.children.length >= 2)

  const kids = (el) =>
    Array.from(el?.children ?? []).filter((child) => !['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(child.tagName))

  // Framework roots often wrap the whole page in one div; descend through
  // single-child wrappers until the layout actually branches.
  const descend = (el, depth = 0) => {
    const children = kids(el).filter((child) => child.getBoundingClientRect().height > 40)
    if (children.length >= 2 || depth >= 3) return children
    const only = kids(el)[0]
    return only ? descend(only, depth + 1) : children
  }

  let sectionSource = container ? descend(container) : descend(document.body)
  if (sectionSource.length < 2) {
    const tagged = Array.from(document.querySelectorAll('section, article')).filter(
      (el) => el.getBoundingClientRect().height > 40,
    )
    if (tagged.length >= 2) sectionSource = tagged
  }

  // A wrapper that owns most of the page height is not a section; open it and
  // read its children instead.
  const pageHeight = document.documentElement.scrollHeight || 1
  const expanded = []
  for (const el of sectionSource) {
    const height = el.getBoundingClientRect().height
    if (height > pageHeight * 0.5) {
      const inner = descend(el).filter((child) => child.getBoundingClientRect().height > 80)
      if (inner.length >= 2) {
        expanded.push(...inner)
        continue
      }
    }
    expanded.push(el)
  }

  const sections = expanded
    .filter((el) => !/skip/i.test(`${el.id || ''} ${el.className || ''}`))
    .slice(0, 14)
    .map((el) => {
      const cs = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      const head = el.querySelector('h1, h2, h3')
      return {
        tag: el.tagName.toLowerCase(),
        hint: (el.id || el.className || '').toString().slice(0, 60) || null,
        height: Math.round(rect.height),
        background: cs.backgroundColor,
        display: cs.display,
        columns: cs.gridTemplateColumns && cs.gridTemplateColumns !== 'none' ? cs.gridTemplateColumns : null,
        head: head ? head.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) : null,
      }
    })
    .filter((s) => s.height > 40)

  let transitions = 0
  let animations = 0
  for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 4000)) {
    const cs = getComputedStyle(el)
    if (cs.transitionDuration && cs.transitionDuration !== '0s') transitions += 1
    if (cs.animationName && cs.animationName !== 'none') animations += 1
  }

  return {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content ?? null,
    lang: document.documentElement.lang || null,
    roles: (() => {
      const paragraphs = Array.from(document.querySelectorAll('main p, article p, p')).filter(
        (el) => (el.textContent || '').trim().length > 40,
      )
      // The "body" sample is the largest running text, not the longest string:
      // a long footnote should not define the typography.
      const body = paragraphs.sort((a, b) => {
        const size = (el) => parseFloat(getComputedStyle(el).fontSize) || 0
        return size(b) - size(a) || (b.textContent || '').length - (a.textContent || '').length
      })[0]
      const links = Array.from(document.querySelectorAll('a, button')).filter((el) => {
        const text = (el.textContent || '').trim()
        if (text.length < 2) return false
        if (/skip/i.test(text) || /skip/i.test(el.className || '')) return false
        if ((el.getAttribute('href') || '').startsWith('#')) return false
        return true
      })
      const action =
        links.find((el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)') ?? links[0] ?? null
      const nav = document.querySelector('nav') ?? document.querySelector('header')
      return {
        h1: style(document.querySelector('h1')),
        h2: style(document.querySelector('h2')),
        body: style(body),
        nav: style(nav?.querySelector('a') ?? document.querySelector('header a')),
        navLinks: nav ? nav.querySelectorAll('a').length : 0,
        action: style(action),
      }
    })(),
    rootProps: Object.fromEntries(Object.entries(rootProps).slice(0, 120)),
    colours: [...colourCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, n]) => ({ value, elements: n })),
    sections,
    motion: { transitions, animations },
    a11y: {
      h1Count: document.querySelectorAll('h1').length,
      images: document.querySelectorAll('img').length,
      imagesMissingAlt: document.querySelectorAll('img:not([alt])').length,
    },
  }
}

/* ---------------------------------------------------------------- run -- */

mkdirSync(path.join(paths.data, 'live'), { recursive: true })
const analysisPath = path.join(paths.data, 'analysis.json')
const analysis = existsSync(analysisPath) ? JSON.parse(readFileSync(analysisPath, 'utf8')) : { images: {} }
analysis.images ??= {}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true })
const results = []

try {
  for (const id of ids) {
    const option = optionsById.get(id)
    const candidate = byId.get(id)
    const url = option?.url ?? candidate?.url ?? null

    if (!url) {
      results.push({ id, skipped: 'no url' })
      continue
    }
    if (candidate?.via) {
      results.push({ id, skipped: `gallery capture (${candidate.via}) — the URL is the gallery, not the site` })
      continue
    }
    if (/\.(png|jpe?g|webp|gif|pdf)$/i.test(url)) {
      results.push({ id, skipped: 'URL is a file, not a page' })
      continue
    }

    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 })
      const status = response?.status() ?? null
      // Let entrance animation settle before the shot, without waiting forever.
      await new Promise((r) => setTimeout(r, 1200))
      const data = await page.evaluate(EXTRACT)
      const shot = path.join(paths.data, 'live', `${id}.png`)
      await page.screenshot({ path: shot, type: 'png' })

      analysis.images[id] = {
        ...(analysis.images[id] ?? { id, name: candidate?.name ?? option?.label ?? id }),
        live: {
          url,
          finalUrl: page.url(),
          status,
          fetchedAt: new Date().toISOString(),
          screenshot: shot,
          ...data,
        },
      }
      results.push({ id, status, title: data.title, fonts: data.roles, sections: data.sections.length })
    } catch (error) {
      results.push({ id, error: String(error.message || error).slice(0, 140) })
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}

writeFileSync(analysisPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...analysis }, null, 2) + '\n')

/* ------------------------------------------------------------- report ---- */

const ok = results.filter((r) => !r.skipped && !r.error)
console.log(`fetched ${ok.length} · skipped ${results.filter((r) => r.skipped).length} · failed ${results.filter((r) => r.error).length}`)
for (const r of results) {
  if (r.error) console.log(`  ✗ ${r.id}: ${r.error}`)
  else if (r.skipped) console.log(`  · ${r.id}: ${r.skipped}`)
  else {
    const font = r.fonts?.h1?.fontFamily ?? '—'
    console.log(`  ✓ ${r.id} ${String(r.status).padEnd(4)} ${font.padEnd(22)} ${r.sections} sections  ${r.title?.slice(0, 48) ?? ''}`)
  }
}
console.log(`→ ${rel(analysisPath)}  (live layer)`)

if (ok.length) {
  console.log(`
Live evidence is the truth for fonts, colours and declared tokens. The saved
capture is the truth for what you actually saw. Where they disagree, record the
drift in the authored layer; do not silently replace one with the other.`)
}
