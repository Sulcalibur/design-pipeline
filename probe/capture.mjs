#!/usr/bin/env node
/**
 * probe/capture.mjs — take a reference screenshot and file it where it belongs.
 *
 * One command for the step before `ingest`: point it at a live page, get a PNG,
 * and record the provenance in a folder manifest. If Eagle is running it can
 * also copy the capture into an Eagle folder, tagged, so the same reference is
 * available to the visual library. Eagle is optional; the folder manifest is
 * always the portable record.
 *
 *   node capture.mjs --url https://example.com/ --slug acme
 *   node capture.mjs --url https://example.com/ --slug acme --viewport mobile
 *   node capture.mjs --url https://example.com/ --slug acme --full --to eagle
 *   node capture.mjs --url https://example.com/ --scroll 4 --to folder
 *
 * Flags: --viewport desktop|mobile|WxH · --full · --scroll <n> · --wait <ms>
 *        --name <base> · --note "…" · --device "…" · --avoid "…" · --fits "…"
 *        --evidence "…" · --tags a,b · --to auto|eagle|folder
 *        --eagle-folder <name> · --out <dir> · --config <probe.config.json>
 *        --project . · --slug <slug> · --json · --hide-overlays
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import { resolveContext, readJson, nowDate, chromePath } from './checks.mjs'
import { EAGLE, eagleStatus } from './library.mjs'

const args = parseArgs(process.argv.slice(2))
const url = args.get('url')
if (!url) fail('capture needs a URL: node capture.mjs --url https://example.com/')
let parsed
try {
  parsed = new URL(url)
} catch {
  fail(`not a URL: ${url}`)
}

const ctx = resolveContext(args)
const slug = args.get('slug') ?? (ctx.docDir.split(path.sep).filter(Boolean).pop() || parsed.hostname.replace(/^www\./, ''))
const outDir = args.get('out')
  ? path.resolve(process.cwd(), args.get('out'))
  : existsSync(path.join(ctx.docDir, 'probe.config.json')) || ctx.docDir.includes(`${path.sep}design${path.sep}`)
    ? path.join(ctx.docDir, 'references')
    : path.join(ctx.project, 'references')
mkdirSync(outDir, { recursive: true })

const to = args.get('to', 'auto')
if (!['auto', 'eagle', 'folder'].includes(to)) fail('--to must be auto, eagle or folder')

/* --------------------------------------------------------------- viewport -- */

function viewport() {
  const raw = args.get('viewport', 'desktop')
  if (raw === 'desktop') return { width: 1440, height: 900, deviceScaleFactor: 1, label: '1440' }
  if (raw === 'mobile') return { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, label: '390' }
  const m = /^(\d+)x(\d+)$/.exec(raw)
  if (!m) fail('--viewport must be desktop, mobile, or WxH (e.g. 1280x800)')
  return { width: Number(m[1]), height: Number(m[2]), deviceScaleFactor: 1, label: `${m[1]}x${m[2]}` }
}

/* ----------------------------------------------------------------- eagle -- */

async function eagleAvailable() {
  return (await eagleStatus()).running
}

function findFolder(nodes, name) {
  for (const node of nodes ?? []) {
    if (node.name === name) return node
    const hit = findFolder(node.children, name)
    if (hit) return hit
  }
  return null
}

async function eagleFolder(name) {
  const res = await fetch(`${EAGLE}/api/folder/list`, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`folder/list ${res.status}`)
  const json = await res.json()
  const found = findFolder(json.data ?? [], name)
  if (found) return found
  const created = await fetch(`${EAGLE}/api/folder/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ folderName: name }),
    signal: AbortSignal.timeout(4000),
  })
  if (!created.ok) throw new Error(`folder/create ${created.status}`)
  const body = await created.json()
  return body.data ?? { id: null, name }
}

async function addToEagle({ file, name, folder, tags, note, device, avoid, fits, evidence }) {
  const annotation = [
    device ? `Device: ${device}` : null,
    avoid ? `Not to copy: ${avoid}` : null,
    fits ? `Fits: ${fits}` : null,
    evidence ? `Evidence: ${evidence}` : null,
    note,
    `Captured ${nowDate()}`,
    `Source: ${parsed.href}`,
  ]
    .filter(Boolean)
    .join('\n')
  const body = {
    path: file,
    name,
    website: parsed.href,
    annotation,
    tags,
    ...(folder?.id ? { folderId: folder.id } : {}),
  }
  const res = await fetch(`${EAGLE}/api/item/addFromPath`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || (json.status && json.status !== 'success')) {
    throw new Error(json.message ?? `addFromPath ${res.status}`)
  }
  return true
}

/* --------------------------------------------------------------- capture -- */

let puppeteer
try {
  puppeteer = (await import('puppeteer-core')).default
} catch {
  fail('capture needs puppeteer-core. Install it in the design-pipeline repo: npm install puppeteer-core')
}
const executablePath = chromePath()
if (!executablePath) fail('no Chrome/Chromium found — set CHROME_PATH to a Chrome for Testing binary')

const vp = viewport()
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({
  width: vp.width,
  height: vp.height,
  deviceScaleFactor: vp.deviceScaleFactor,
  ...(vp.isMobile ? { isMobile: true, hasTouch: true } : {}),
})

console.log(`capture ${url} · ${vp.label} · ${to}`)
try {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
} catch {
  await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch((e) => fail(`page did not load: ${e.message}`))
}
await new Promise((resolve) => setTimeout(resolve, Number(args.get('wait', 1500))))

if (args.has('hide-overlays')) {
  await page.evaluate(() => {
    const sels = [
      '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#cookie-banner', '#cookieConsent',
      '[class*="cookie-banner"]', '[class*="consent-banner"]', '[id*="cookie-banner"]',
    ]
    for (const sel of sels) document.querySelectorAll(sel).forEach((el) => el.remove())
  }).catch(() => {})
}

const base = args.get('name') ?? `${nowDate()}-${slug}-${vp.label}`
const frames = []

async function shoot(name) {
  const file = path.join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  frames.push(file)
  return file
}

if (args.has('scroll')) {
  const n = Math.max(1, Math.min(12, Number(args.get('scroll'))))
  for (let i = 0; i < n; i += 1) {
    await page.evaluate((y) => window.scrollTo(0, y), i * vp.height)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await shoot(`${base}-${String(i + 1).padStart(2, '0')}`)
  }
} else {
  const file = path.join(outDir, `${base}.png`)
  await page.screenshot({ path: file, fullPage: args.has('full') })
  frames.push(file)
}

await browser.close()

/* -------------------------------------------------------------- manifest -- */

const manifestFile = path.join(outDir, 'manifest.json')
const manifest = readJson(manifestFile, { items: [] })
const items = Array.isArray(manifest) ? manifest : manifest.items ?? []
const byId = new Map(items.map((item) => [item.id, item]))

for (const [index, file] of frames.entries()) {
  const suffix = frames.length > 1 ? `-${String(index + 1).padStart(2, '0')}` : ''
  const id = `${slug}-${vp.label}${suffix}`
  byId.set(id, {
    id,
    name: `${slug} — ${vp.label}${suffix ? ` (${index + 1})` : ''}`,
    file: path.relative(outDir, file),
    url: parsed.href,
    kind: 'page',
    capturedAt: new Date().toISOString(),
    ...(args.get('note') ? { note: args.get('note') } : {}),
    ...(args.get('device') ? { device: args.get('device') } : {}),
    ...(args.get('avoid') ? { avoid: args.get('avoid') } : {}),
    ...(args.get('fits') ? { fits: args.get('fits') } : {}),
    ...(args.get('evidence') ? { evidence: args.get('evidence') } : {}),
  })
}

writeFileSync(manifestFile, JSON.stringify({ ...(Array.isArray(manifest) ? {} : manifest), items: [...byId.values()] }, null, 2) + '\n')

/* ----------------------------------------------------------------- eagle -- */

let eagle = null
if (to !== 'folder') {
  if (await eagleAvailable()) {
    try {
      const folderName = args.get('eagle-folder', slug)
      const folder = await eagleFolder(folderName)
      const tags = ['design-probe', 'ref', slug, ...(args.get('tags', '') || '').split(',').map((t) => t.trim()).filter(Boolean)]
      for (const [index] of frames.entries()) {
        const suffix = frames.length > 1 ? `-${String(index + 1).padStart(2, '0')}` : ''
        const item = byId.get(`${slug}-${vp.label}${suffix}`)
        await addToEagle({
          file: path.join(outDir, item.file),
          name: `${slug} — ${vp.label}${suffix}`,
          folder,
          tags,
          note: args.get('note'),
          device: args.get('device'),
          avoid: args.get('avoid'),
          fits: args.get('fits'),
          evidence: args.get('evidence'),
        })
      }
      eagle = { added: frames.length, folder: folderName }
    } catch (e) {
      eagle = { added: 0, error: e.message }
    }
  } else if (to === 'eagle') {
    fail('Eagle is not running (nothing on :41595). Open Eagle, or use --to folder.')
  } else {
    eagle = { added: 0, note: 'Eagle not running; folder only' }
  }
}

/* ------------------------------------------------------------------ report -- */

if (!args.get('device')) {
  console.warn('  ! no --device: this is a picture, not a reference. `probe refs` will flag it.')
}

for (const file of frames) console.log(`  png  ${rel(file)} (${Math.round(statSync(file).size / 1024)} KB)`)
console.log(`  manifest ${rel(manifestFile)}`)
if (eagle) console.log(eagle.error ? `  eagle failed: ${eagle.error}` : eagle.added ? `  eagle +${eagle.added} → folder ${eagle.folder}` : `  eagle skipped: ${eagle.note}`)
console.log(`\nnext: bin/probe ingest --config <probe.config.json> --source folder  (manifest at ${rel(path.dirname(manifestFile))})`)

if (args.has('json')) {
  console.log(JSON.stringify({ url: parsed.href, viewport: vp.label, files: frames.map((f) => rel(f)), manifest: rel(manifestFile), eagle }, null, 2))
}
