/**
 * probe/checks.mjs — the shared vocabulary for the post-build stages.
 *
 * Every stage added after verify (brand review, copy, content, launch, maintain,
 * composite audit) reports the same way: a severity, a code, a finding, and the
 * evidence. One Report class, one markdown shape, so the documents look alike
 * and a maintain run can diff them.
 *
 * No model calls. No dependencies. Network only where a check needs it.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import tls from 'node:tls'

export const SEV = ['blocking', 'major', 'minor', 'info']

export function sevRank(sev) {
  const i = SEV.indexOf(sev)
  return i === -1 ? 9 : i
}

export class Report {
  constructor(title) {
    this.title = title
    this.generatedAt = new Date().toISOString()
    this.findings = []
    this.rows = []
    this.notes = []
    this.status = 'ok'
  }

  add(sev, code, message, extra = {}) {
    this.findings.push({ sev, code, message, ...extra })
    return this
  }

  row(label, value) {
    this.rows.push({ label, value })
    return this
  }

  note(text) {
    this.notes.push(text)
    return this
  }

  count(sev) {
    return this.findings.filter((f) => f.sev === sev).length
  }

  get blocking() {
    return this.count('blocking')
  }

  get ok() {
    return this.blocking === 0
  }

  /** Findings sorted by severity, then code. */
  sorted() {
    return [...this.findings].sort((a, b) => sevRank(a.sev) - sevRank(b.sev) || a.code.localeCompare(b.code))
  }

  json() {
    return {
      title: this.title,
      generatedAt: this.generatedAt,
      status: this.status,
      counts: Object.fromEntries(SEV.map((s) => [s, this.count(s)])),
      findings: this.findings,
      rows: this.rows,
      notes: this.notes,
    }
  }

  render({ intro = '' } = {}) {
    const out = [`# ${this.title}`, '']
    if (intro) out.push(intro.trim(), '')
    out.push(`> Generated ${this.generatedAt.slice(0, 10)} · ${this.blocking} blocking · ${this.count('major')} major · ${this.count('minor')} minor`, '')

    if (this.rows.length) {
      out.push('| Measure | Value |', '|---|---|')
      for (const r of this.rows) out.push(`| ${esc(r.label)} | ${esc(r.value)} |`)
      out.push('')
    }

    if (this.findings.length) {
      out.push('| Severity | Code | Finding |', '|---|---|---|')
      for (const f of this.sorted()) out.push(`| ${f.sev} | ${esc(f.code)} | ${esc(f.message)} |`)
      out.push('')
    } else {
      out.push('No findings.', '')
    }

    if (this.notes.length) {
      out.push('## Notes', '')
      for (const n of this.notes) out.push(`- ${n}`)
      out.push('')
    }

    out.push('## Gate', '')
    out.push(this.blocking ? `**Blocked.** ${this.blocking} blocking finding(s) must be fixed or waived with a reason.` : '**Clear.** No blocking findings.')
    return out.join('\n') + '\n'
  }
}

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')
}

/* ------------------------------------------------------------------ fetch -- */

export async function fetchText(url, { timeout = 20000, redirect = 'follow', headers = {} } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout)
  const started = Date.now()
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect,
      headers: { 'user-agent': 'design-probe/1 (+audit)', ...headers },
    })
    const body = await res.text()
    return {
      ok: res.ok,
      status: res.status,
      url: res.url,
      headers: Object.fromEntries(res.headers.entries()),
      body,
      ms: Date.now() - started,
      error: null,
    }
  } catch (e) {
    return { ok: false, status: 0, url, headers: {}, body: '', ms: Date.now() - started, error: e.message }
  } finally {
    clearTimeout(timer)
  }
}

/* --------------------------------------------------------------- html facts -- */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', middot: '·',
}

export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const code = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[g.toLowerCase()] ?? m
  })
}

export function stripHtml(html) {
  return decodeEntities(
    String(html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim()
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = re.exec(tag)
  return m ? (m[2] ?? m[3] ?? m[4]) : null
}

export function parseHtml(html, baseUrl = '') {
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) ?? [])[1] ?? html
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const metas = {}
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(m[0], 'name') ?? attr(m[0], 'property')
    const content = attr(m[0], 'content')
    if (key && content != null) metas[key.toLowerCase()] = decodeEntities(content)
  }
  const links = []
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    links.push({ rel: (attr(m[0], 'rel') ?? '').toLowerCase(), href: attr(m[0], 'href'), tag: m[0] })
  }
  const headings = []
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    headings.push({ level: Number(m[1]), text: stripHtml(m[2]) })
  }
  const images = []
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    images.push({
      src: attr(tag, 'src'),
      hasAlt: /\balt\s*=/i.test(tag),
      alt: attr(tag, 'alt'),
      ariaHidden: (attr(tag, 'aria-hidden') ?? '').toLowerCase() === 'true',
      role: attr(tag, 'role'),
      loading: attr(tag, 'loading'),
    })
  }
  const anchors = []
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const inner = m[2]
    const imgAlt = (/<img\b[^>]*\balt\s*=\s*"([^"]*)"/i.exec(inner) ?? [])[1] ?? null
    anchors.push({
      href: attr(m[0], 'href'),
      text: stripHtml(inner),
      label: attr(m[0], 'aria-label'),
      title: attr(m[0], 'title'),
      imgAlt,
      ariaHidden: (attr(m[0], 'aria-hidden') ?? '').toLowerCase() === 'true',
      tabindex: attr(m[0], 'tabindex'),
    })
  }
  return {
    title: titleMatch ? decodeEntities(stripHtml(titleMatch[1])) : null,
    description: metas.description ?? null,
    lang: attr((/<html\b[^>]*>/i.exec(html) ?? [''])[0], 'lang'),
    viewport: metas.viewport ?? null,
    robots: metas.robots ?? null,
    canonical: links.find((l) => l.rel === 'canonical')?.href ?? null,
    icon: links.find((l) => l.rel.includes('icon'))?.href ?? null,
    og: Object.fromEntries(Object.entries(metas).filter(([k]) => k.startsWith('og:'))),
    twitter: Object.fromEntries(Object.entries(metas).filter(([k]) => k.startsWith('twitter:'))),
    headings,
    images,
    anchors,
    text: stripHtml(html),
    metas,
    links,
    baseUrl,
  }
}

export function normaliseUrl(base, href) {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

/* ------------------------------------------------------------------ files -- */

export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.nuxt', '.output', '.data', '.hallmark', '.wrangler', 'coverage', 'build', '.vercel', '.netlify'])

export function walkFiles(dir, exts) {
  const out = []
  const visit = (d) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) visit(full)
      else if (!exts || exts.some((x) => e.name.toLowerCase().endsWith(x))) out.push(full)
    }
  }
  visit(path.resolve(dir))
  return out
}

/** Text a copy gate can read, from the files a project actually keeps copy in. */
export function textFromFile(file) {
  const raw = readFileSync(file, 'utf8')
  const ext = path.extname(file).toLowerCase()
  if (ext === '.json') {
    const strings = []
    const walk = (v) => {
      if (typeof v === 'string') strings.push(v)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    try {
      walk(JSON.parse(raw))
      return strings.join('\n')
    } catch {
      return raw
    }
  }
  if (['.vue', '.svelte'].includes(ext)) {
    const template = (/<template\b[^>]*>([\s\S]*?)<\/template>/i.exec(raw) ?? [])[1] ?? ''
    const strings = [...raw.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.){12,})\1/g)]
      .map((m) => m[2])
      .filter((s) => /\s/.test(s) && /[a-z]{3}/i.test(s))
    return [stripHtml(template), ...strings].join('\n')
  }
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
    return [...raw.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.){12,})\1/g)]
      .map((m) => m[2])
      .filter((s) => /\s/.test(s) && /[a-z]{3}/i.test(s) && !/^[\w./-]+$/.test(s))
      .join('\n')
  }
  if (ext === '.md' || ext === '.txt') return raw
  return stripHtml(raw)
}

/* ------------------------------------------------------------------ brand -- */

export function findProjectRoot(start) {
  let cursor = path.resolve(start)
  while (cursor !== path.dirname(cursor)) {
    if (
      existsSync(path.join(cursor, 'docs', 'brand')) ||
      existsSync(path.join(cursor, 'package.json')) ||
      existsSync(path.join(cursor, '.git'))
    ) {
      return cursor
    }
    cursor = path.dirname(cursor)
  }
  return path.resolve(start)
}

export function loadBrand(projectDir) {
  let cursor = path.resolve(projectDir)
  while (cursor !== path.dirname(cursor)) {
    const file = path.join(cursor, 'docs', 'brand', 'brand.json')
    if (existsSync(file)) {
      try {
        return { file, data: JSON.parse(readFileSync(file, 'utf8')) }
      } catch {
        return { file, data: null, error: 'brand.json is not valid JSON' }
      }
    }
    cursor = path.dirname(cursor)
  }
  return null
}

export function slotValue(brand, id) {
  const slots = brand?.data?.slots ?? brand?.slots ?? null
  return slots?.[id]?.value ?? null
}

/** A slot as a clean list — arrays, or bullet/newline strings. */
export function listFrom(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  return String(value)
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
}

export function brandList(brand, id) {
  return listFrom(slotValue(brand, id))
}

/* ----------------------------------------------------------------- context -- */

/**
 * A stage can be invoked with a probe config, a design slug, or just a project.
 * All three resolve to the same three things: project root, document directory,
 * and the brand record if there is one.
 */
export function resolveContext(args, cwd = process.cwd()) {
  const configArg = args.get('config')
  let project
  let docDir
  if (configArg) {
    const configPath = path.resolve(cwd, configArg)
    docDir = path.dirname(configPath)
    project = findProjectRoot(docDir)
  } else {
    project = path.resolve(cwd, args.get('project', '.'))
    const slug = args.get('slug')
    const designRoot = path.join(project, 'docs', 'design')
    let auto = null
    if (!slug && !args.get('out')) {
      try {
        const dirs = readdirSync(designRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('audit-'))
          .map((d) => d.name)
        if (dirs.length === 1) auto = dirs[0]
      } catch {
        auto = null
      }
    }
    docDir = args.get('out')
      ? path.resolve(cwd, args.get('out'))
      : slug
        ? path.join(designRoot, slug)
        : auto
          ? path.join(designRoot, auto)
          : path.join(project, 'docs')
  }
  return { project, docDir, brand: loadBrand(project) }
}

export function writeDoc(docDir, name, content) {
  mkdirSync(docDir, { recursive: true })
  const file = path.join(docDir, name)
  writeFileSync(file, content)
  return file
}

/* ------------------------------------------------------------------ utils -- */

export function chromePath() {
  const home = process.env.HOME ?? ''
  const candidates = [
    process.env.CHROME_PATH,
    path.join(home, 'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    path.join(home, '.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean)

  // The cached automation builds change version; scan the two caches rather than
  // hardcoding a version that a Playwright/Puppeteer update silently invalidates.
  const relatives = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-linux64/chrome',
    'chrome-linux/chrome',
    'chrome-win64/chrome.exe',
  ]
  const dynamic = []
  for (const root of [path.join(home, '.cache/puppeteer/chrome'), path.join(home, 'Library/Caches/ms-playwright')]) {
    if (!existsSync(root)) continue
    for (const version of readdirSync(root).sort().reverse()) {
      for (const rel of relatives) {
        const candidate = path.join(root, version, rel)
        if (existsSync(candidate)) dynamic.push(candidate)
      }
    }
  }
  return [...candidates, ...dynamic].find((p) => existsSync(p)) ?? null
}

export function contrast(hexA, hexB) {
  const lum = (hex) => {
    const h = hex.replace('#', '')
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const [a, b] = [lum(hexA), lum(hexB)].sort((x, y) => y - x)
  return Number(((a + 0.05) / (b + 0.05)).toFixed(2))
}

export function firstHex(value) {
  const m = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(String(value ?? ''))
  return m ? `#${m[1]}` : null
}

export function tlsExpiry(hostname, timeout = 8000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      resolve(v)
    }
    try {
      const socket = tls.connect({ host: hostname, servername: hostname, port: 443, timeout }, () => {
        const cert = socket.getPeerCertificate()
        finish({ validTo: cert?.valid_to ?? null, issuer: cert?.issuer?.O ?? cert?.issuer?.CN ?? null })
        socket.end()
      })
      socket.on('error', (e) => finish({ error: e.message }))
      socket.on('timeout', () => {
        finish({ error: 'TLS timeout' })
        socket.destroy()
      })
    } catch (e) {
      finish({ error: e.message })
    }
  })
}

export function daysUntil(dateString) {
  if (!dateString) return null
  const ms = new Date(dateString).getTime() - Date.now()
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null
}

export function hashFinding(f) {
  return `${f.code}::${String(f.message).toLowerCase().replace(/\d+/g, '#').slice(0, 120)}`
}

export function nowDate() {
  return new Date().toISOString().slice(0, 10)
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function dirMtime(file) {
  try {
    return statSync(file).mtime
  } catch {
    return null
  }
}
