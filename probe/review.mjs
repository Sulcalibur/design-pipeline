#!/usr/bin/env node
/**
 * probe/review.mjs — the composite audit.
 *
 * The stage that answers "what is actually wrong with this surface?" in one run:
 * brand record, copy, content, launch, Lighthouse (axe), Hallmark's sloplint
 * render tier, and the Impeccable detector. Findings merge into one severity
 * list; the five dimensions are scored 0–4.
 *
 *   node review.mjs --config docs/design/home/probe.config.json --url https://acme.test/
 *   node review.mjs --project . --url https://acme.test/ --render --previous <ref>
 *   node review.mjs --project . --url https://acme.test/ --json
 *
 * Writes docs/design/<slug>/10-audit-<date>.md and evidence beside it.
 * Exits 1 on a blocking finding.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import {
  Report,
  loadBrand,
  resolveContext,
  writeDoc,
  walkFiles,
  chromePath,
  nowDate,
} from './checks.mjs'
import { reviewBrand } from './brand-review.mjs'
import { reviewCopy } from './copy.mjs'
import { reviewContent } from './content.mjs'
import { reviewLaunch } from './launch.mjs'

const here = import.meta.dirname
const toolRoot = path.resolve(here, '..')
const sloplint = path.join(toolRoot, 'bin', 'sloplint')
const lighthouse = path.join(here, 'audit.mjs')

const AREA_BY_CODE = {
  'alt-missing': 'accessibility', 'h1-count': 'accessibility', 'lang-missing': 'accessibility',
  'link-empty': 'accessibility', 'noindex': 'accessibility', 'heading-jump': 'accessibility',
  'viewport-missing': 'accessibility', 'alt-source': 'accessibility', 'link-source': 'accessibility',
  'title-missing': 'integrity', 'title-long': 'integrity', 'title-short': 'integrity',
  'title-duplicate': 'integrity', 'description-missing': 'integrity', 'description-length': 'integrity',
  'canonical-missing': 'integrity', 'og-missing': 'integrity', 'thin-content': 'integrity',
  'placeholder': 'integrity', 'placeholder-source': 'integrity', 'no-target': 'integrity',
  'record-stale': 'theming', 'contrast-ink-paper': 'accessibility', 'contrast-ink-surface': 'accessibility',
  'contrast-accent': 'accessibility', 'contrast-accent-fill': 'accessibility', 'colour-missing': 'theming',
  'tls-expired': 'integrity', 'tls-expiring': 'integrity', 'header-strict-transport-security': 'integrity',
  'header-content-security-policy': 'integrity', 'header-x-content-type-options': 'integrity',
  'header-referrer-policy': 'integrity', 'header-permissions-policy': 'integrity',
}

function areaFor(code) {
  const base = code.replace(/^[a-z-]+:/, '')
  return AREA_BY_CODE[base] ?? (base.startsWith('contrast') || base.startsWith('colour') ? 'theming' : 'integrity')
}

/** Duplicate custom properties with different values, across CSS files. */
function tokenDrift(project) {
  const cssFiles = walkFiles(project, ['.css']).filter(
    (f) => !/\/handoff\//.test(f) && !/\/audit-\d{4}-\d{2}-\d{2}\//.test(f) && !/\/od-roundtrip\//.test(f),
  )
  const files = cssFiles.filter((f) => !/\/(tokens|base)\.css$/i.test(f))
  const tokens = cssFiles.filter((f) => /(tokens|theme|variables)\.css$/i.test(f))
  const decl = new Map()
  let rawHex = 0
  for (const file of [...tokens, ...files]) {
    const css = readFileSync(file, 'utf8')
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
      const name = m[1].toLowerCase()
      const value = m[2].trim()
      if (!/^#[0-9a-f]{3,8}\b/i.test(value) && !/^(rgb|hsl|oklch)\(/i.test(value)) continue
      if (!decl.has(name)) decl.set(name, [])
      decl.get(name).push({ file, value })
    }
    if (!tokens.includes(file)) rawHex += (css.match(/#[0-9a-f]{6}\b/gi) ?? []).length
  }
  const dupes = [...decl.entries()].filter(([, rows]) => {
    const files = new Set(rows.map((r) => r.file))
    const values = new Set(rows.map((r) => r.value.toLowerCase()))
    // Light/dark variants in one token file are expected; the drift is the same
    // property redeclared in a different file with a different value.
    return files.size > 1 && values.size > 1
  })
  return { dupes, rawHex, files: files.length }
}

async function lighthouseRun(url, outDir) {
  const out = path.join(outDir, 'lh')
  const run = spawnSync(process.execPath, [lighthouse, '--url', url, '--out', out], {
    encoding: 'utf8',
    timeout: 420_000,
    env: { ...process.env, CHROME_PATH: chromePath() ?? process.env.CHROME_PATH ?? '' },
  })
  if (run.status !== 0) return { error: (run.stderr || run.stdout || '').trim().split('\n').slice(-3).join(' ') }
  try {
    return { data: JSON.parse(readFileSync(`${out}.json`, 'utf8')) }
  } catch (e) {
    return { error: e.message }
  }
}

function sloplintRun(url, outDir) {
  if (!existsSync(sloplint)) return { error: 'bin/sloplint not found' }
  const run = spawnSync(sloplint, ['--url', url, '--render', '--genre', 'editorial'], {
    encoding: 'utf8',
    timeout: 420_000,
    env: { ...process.env, CHROME_PATH: chromePath() ?? process.env.CHROME_PATH ?? '' },
  })
  const text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  writeFileSync(path.join(outDir, 'sloplint.txt'), text)
  const lines = text.split('\n')
  const findings = []
  for (const line of lines) {
    const m = /^\s+(FAIL|REFLEX|WARN)\s+(\S+)\s+/.exec(line)
    if (m) findings.push({ grade: m[1], gate: m[2], text: line.trim() })
  }
  return { findings, text }
}

function detectorRun(url, outDir) {
  const candidates = [
    process.env.IMPECCABLE_BIN,
    path.join(process.env.HOME ?? '', '.config/opencode/skills/impeccable/scripts/impeccable'),
    path.join(process.env.HOME ?? '', '.agents/skills/impeccable/scripts/impeccable'),
  ].filter(Boolean)
  const bin = candidates.find((p) => existsSync(p))
  if (!bin) return { error: 'Impeccable detector not installed' }
  const run = spawnSync(bin, ['detect', url, '--json', '--viewport', '1440x900'], {
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, IMPECCABLE_BROWSER: chromePath() ?? process.env.IMPECCABLE_BROWSER ?? '' },
  })
  const text = run.stdout || ''
  writeFileSync(path.join(outDir, 'detector.json'), text || JSON.stringify({ error: run.stderr ?? '' }))
  try {
    return { findings: JSON.parse(text) }
  } catch {
    return { error: (run.stderr || 'no JSON').trim().split('\n').slice(-2).join(' ') }
  }
}

function scoreFromSeverity(findings, area, ceiling = 4) {
  const inArea = findings.filter((f) => f.area === area)
  const blocking = inArea.filter((f) => f.sev === 'blocking').length
  const major = inArea.filter((f) => f.sev === 'major').length
  // One major is a half-point of damage; two cost one; blocking costs two.
  return Math.max(0, Math.min(4, ceiling - 2 * blocking - Math.ceil(major / 2)))
}

function band(total) {
  if (total >= 18) return 'Excellent'
  if (total >= 14) return 'Good'
  if (total >= 10) return 'Acceptable'
  if (total >= 6) return 'Poor'
  return 'Critical'
}

export async function runReview({ project, docDir, urls = [], previous = null, render = true, detector = true, responsive = null, launch = true }) {
  const report = new Report('Design audit')
  const url = urls[0] ?? null
  const date = nowDate()
  const targetDir = docDir ?? path.join(project, 'docs', 'design')
  const outDir = path.join(targetDir, 'audit-' + date)
  mkdirSync(outDir, { recursive: true })

  /* ------------------------------------------------------------- the checks -- */
  const brand = reviewBrand({ project, registry: true })
  for (const f of brand.findings) {
    const area = f.code === 'record-gap' || f.code.startsWith('slot') ? 'integrity' : f.code.startsWith('contrast') ? 'accessibility' : 'theming'
    report.add(f.sev, `brand:${f.code}`, f.message, { area })
  }
  for (const r of brand.rows) report.row(`brand · ${r.label}`, r.value)

  if (url) {
    const brandRecord = loadBrand(project)
    const copyFinal = await reviewCopy({ project, brand: brandRecord?.data ?? null, urls })
    for (const f of copyFinal.findings) report.add(f.sev, `copy:${f.code}`, f.message, { area: 'integrity' })

    const content = await reviewContent({ project, urls: [url], modelPath: null, srcDir: null, limit: 1 })
    for (const f of content.findings) report.add(f.sev, `content:${f.code}`, f.message, { area: areaFor(f.code) })

    const launchReport = launch ? await reviewLaunch({ url, previous }) : null
    if (launchReport) {
      for (const f of launchReport.findings) report.add(f.sev, `launch:${f.code}`, f.message, { area: areaFor(f.code) })
      for (const r of launchReport.rows) report.row(`launch · ${r.label}`, r.value)
    }
  } else {
    report.note('No URL given: Lighthouse, launch and page-content checks did not run.')
  }

  /* ------------------------------------------------------------- token drift -- */
  const drift = tokenDrift(project)
  if (drift.dupes.length) {
    const names = drift.dupes.map(([name]) => name)
    const where = [...new Set(drift.dupes.flatMap(([, rows]) => rows.map((r) => rel(r.file))))]
    report.add(
      'major',
      'token-duplicate',
      `${names.length} token(s) declared with different values across files: ${names.join(', ')} — ${where.join(', ')}`,
      { area: 'theming' },
    )
  }
  report.row('token drift', `${drift.dupes.length} duplicated propert${drift.dupes.length === 1 ? 'y' : 'ies'} · ${drift.rawHex} raw hex values outside token files`)

  /* --------------------------------------------------------------- mechanical -- */
  let perf = null
  let a11yLh = null
  if (url && render) {
    const lh = await lighthouseRun(url, outDir)
    if (lh.error) report.note(`Lighthouse did not complete: ${lh.error}`)
    else {
      perf = lh.data.scores?.performance?.score ?? null
      a11yLh = lh.data.scores?.accessibility?.score ?? null
      report.row('Lighthouse', `perf ${perf ?? '—'} · a11y ${a11yLh ?? '—'} · best practices ${lh.data.scores?.['best-practices']?.score ?? '—'} · seo ${lh.data.scores?.seo?.score ?? '—'}`)
      if (lh.data.failures?.length) {
        report.row('Lighthouse findings', lh.data.failures.map((f) => f.id).join(', '))
      }
    }

    const slope = sloplintRun(url, outDir)
    if (slope.error) report.note(`sloplint did not complete: ${slope.error}`)
    else {
      const fails = slope.findings.filter((f) => f.grade === 'FAIL').length
      const reflex = slope.findings.filter((f) => f.grade === 'REFLEX').length
      const warn = slope.findings.filter((f) => f.grade === 'WARN').length
      report.row('sloplint', `${fails} FAIL · ${reflex} REFLEX · ${warn} WARN (advisory on a non-Hallmark surface)`)
      report.note('Hallmark\'s Floor binds Hallmark builds. On this surface each sloplint finding is dispositioned fix / waive / dismiss in the audit, not treated as a build failure.')
    }

    if (detector) {
      const det = detectorRun(url, outDir)
      if (det.error) report.note(`Impeccable detector did not run: ${det.error}`)
      else {
        const bySev = { warning: 0, advisory: 0 }
        for (const f of det.findings ?? []) bySev[f.severity] = (bySev[f.severity] ?? 0) + 1
        report.row('detector', `${bySev.warning ?? 0} warning · ${bySev.advisory ?? 0} advisory`)
        const grouped = new Map()
        for (const f of det.findings ?? []) {
          if (f.severity !== 'warning') continue
          const key = f.antipattern
          if (!grouped.has(key)) grouped.set(key, [])
          grouped.get(key).push(f)
        }
        for (const [rule, rows] of grouped) {
          const selectors = [...new Set(rows.map((r) => r.selector).filter(Boolean))]
          const sev = rule === 'undersized-ui-text' ? 'major' : 'minor'
          report.add(
            sev,
            `detector:${rule}`,
            `${rows.length} instance(s)${selectors.length ? ` (${selectors.slice(0, 3).join(', ')}${selectors.length > 3 ? ', …' : ''})` : ''} — ${String(rows[0].message ?? rows[0].description ?? '').slice(0, 130)}`,
            { area: rule === 'undersized-ui-text' ? 'accessibility' : 'integrity' },
          )
        }
      }
    }
  }

  /* ------------------------------------------------------------------ scores -- */
  const all = report.findings
  const a11yCeil = a11yLh == null ? 3 : a11yLh === 100 ? 4 : a11yLh >= 90 ? 3 : a11yLh >= 70 ? 2 : 1
  const a11y = scoreFromSeverity(all.filter((f) => f.code !== 'noindex'), 'accessibility', a11yCeil)
  const performance = perf == null ? 3 : perf >= 95 ? 4 : perf >= 85 ? 3 : perf >= 70 ? 2 : perf >= 50 ? 1 : 0
  const theming = scoreFromSeverity(all, 'theming', 4)
  const responsiveScore = responsive == null ? 3 : Number(responsive)
  const integrity = scoreFromSeverity(all, 'integrity', 4)
  const scores = { accessibility: a11y, performance, theming, responsive: responsiveScore, integrity }
  const total = Object.values(scores).reduce((a, b) => a + b, 0)

  report.rows.unshift(
    { label: '#1 Accessibility', value: `${a11y}/4 — ${a11yLh == null ? 'axe not run' : `axe ${a11yLh}`}` },
    { label: '#2 Performance', value: `${performance}/4 — ${perf == null ? 'Lighthouse not run' : `Lighthouse ${perf}`}` },
    { label: '#3 Theming', value: `${theming}/4 — ${drift.dupes.length} token duplicate(s)` },
    { label: '#4 Responsive', value: `${responsiveScore}/4 — ${responsive == null ? 'not measured this run' : 'recorded by hand'}` },
    { label: '#5 Integrity', value: `${integrity}/4` },
    { label: 'Total', value: `${total}/20 — ${band(total)}` },
  )

  if (responsive == null) report.note('Responsive is a placeholder score: measure overflow and touch targets at 375 / 390 / 1440, then pass --responsive <0-4>.')
  report.note(`Evidence: ${rel(outDir)} (Lighthouse summary, sloplint text, detector JSON).`)
  report.note('The four-line read (what it is for, what works, what reads as generated, what is broken) is a handoff: look at the screenshots before writing it.')

  const intro = `<!-- probe:review -->\nTarget: ${url ?? project}\n\nA scored, evidence-backed audit. Findings are sorted by severity; each is fixed or dispositioned in the audit record.`
  const doc = report.render({ intro })
  let name = `10-audit-${date}.md`
  const existing = path.join(targetDir, name)
  if (existsSync(existing) && !readFileSync(existing, 'utf8').includes('<!-- probe:review -->')) {
    // A hand-written audit owns the canonical name; keep the machine run beside it.
    name = `10-audit-${date}-machine.md`
  }
  const file = writeDoc(targetDir, name, doc)
  return { report, scores, total, band: band(total), file, evidence: outDir, docDir: targetDir }
}

/* -------------------------------------------------------------------- CLI -- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const ctx = resolveContext(args)
  const urls = String(args.get('url', '') || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  if (!urls.length) fail('review needs a URL: node review.mjs --url https://example.com/')
  const result = await runReview({
    project: ctx.project,
    docDir: ctx.docDir,
    urls,
    previous: args.get('previous', null),
    render: !args.has('no-render'),
    detector: !args.has('no-detector'),
    responsive: args.get('responsive') ? Number(args.get('responsive')) : null,
    launch: !args.has('no-launch'),
  })

  if (args.has('json')) console.log(JSON.stringify({ scores: result.scores, total: result.total, band: result.band, findings: result.report.findings, evidence: result.evidence, file: result.file }, null, 2))
  else {
    process.stdout.write(`\n${result.total}/20 — ${result.band}\n\n`)
    console.table(result.scores)
    process.stdout.write(result.report.render())
    console.log(`\n→ ${rel(result.file)}`)
  }
  process.exit(result.report.blocking ? 1 : 0)
}
