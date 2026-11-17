#!/usr/bin/env node
/**
 * probe/refs.mjs — review the reference pack as a pack.
 *
 * A capture is a picture until it names a transferable device and a thing not
 * to copy. This reads references/manifest.json, shows every capture beside the
 * note that justifies it, and blocks when a picture has no device or no avoid.
 *
 *   node refs.mjs --project . [--dir references] [--html refs.html] [--open]
 *   node refs.mjs --project . --json
 *   node refs.mjs --project . --lenient        # warnings, not a gate
 *
 * Writes <references>/refs.html (and refs.md with --md). Exits 1 when the gate
 * fails.
 */
import { existsSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import { resolveContext, readJson, nowDate } from './checks.mjs'

const args = parseArgs(process.argv.slice(2))
const ctx = resolveContext(args)
const dir = args.get('dir')
  ? path.resolve(ctx.project, args.get('dir'))
  : existsSync(path.join(ctx.docDir, 'references'))
    ? path.join(ctx.docDir, 'references')
    : path.join(ctx.project, 'references')
const manifestFile = path.join(dir, 'manifest.json')

if (!existsSync(manifestFile)) {
  fail(`no manifest at ${manifestFile}\n  Capture references first: probe capture --url … --device "…" --avoid "…"`)
}

const manifest = readJson(manifestFile, null)
const items = Array.isArray(manifest) ? manifest : manifest?.items ?? []
if (!items.length) fail(`manifest has no items: ${manifestFile}`)

/* --------------------------------------------------------------- analysis -- */

const analysisFile = path.join(ctx.docDir, 'data', 'analysis.json')
const analysis = existsSync(analysisFile) ? readJson(analysisFile, {})?.images ?? {} : {}

/* ------------------------------------------------------------------ shape -- */

const entries = items.map((item, index) => {
  const id = item.id ?? `ref-${String(index + 1).padStart(2, '0')}`
  const file = item.file ? (path.isAbsolute(item.file) ? item.file : path.resolve(dir, item.file)) : null
  const exists = !!file && existsSync(file)
  const blocking = []
  const warnings = []
  if (!exists) blocking.push('file missing')
  if (!item.device) blocking.push('no device')
  if (!item.avoid) blocking.push('no avoid')
  if (!item.fits) warnings.push('no fits')
  if (!item.evidence) warnings.push('no evidence')
  return {
    ...item,
    id,
    file,
    exists,
    palette: analysis[id]?.palette ?? item.palette ?? [],
    status: blocking.length ? 'blocked' : warnings.length ? 'partial' : 'complete',
    blocking,
    warnings,
  }
})

const blocked = entries.filter((e) => e.status === 'blocked')
const partial = entries.filter((e) => e.status === 'partial')
const complete = entries.filter((e) => e.status === 'complete')

/* ------------------------------------------------------------------- html -- */

const htmlFile = path.resolve(dir, args.get('html', 'refs.html'))
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const imgSrc = (e) => {
  if (!e.exists) return null
  const r = path.relative(path.dirname(htmlFile), e.file)
  return r.split(path.sep).join('/')
}
const swatches = (list) =>
  list?.length
    ? `<div class="pal">${list.slice(0, 6).map((p) => `<span title="${esc(p.hex)} ${Math.round((p.share ?? 0) * 100)}%" style="background:${esc(p.hex)}"></span>`).join('')}</div>`
    : ''

const rows = (e) => [
  ['Device', e.device],
  ['Not to copy', e.avoid],
  ['Fits', e.fits],
  ['Evidence', e.evidence],
  ['Note', e.note],
].filter(([, v]) => v)

const cards = entries
  .map((e) => {
    const src = imgSrc(e)
    return `<article class="card ${e.status}">
  <figure class="shot">${src ? `<img src="${esc(src)}" alt="${esc(e.name ?? e.id)}">` : '<div class="missing">image missing</div>'}</figure>
  <div class="body">
    <header>
      <span class="id">${esc(e.id)}</span>
      <span class="status ${e.status}">${e.status === 'complete' ? 'complete' : e.status === 'partial' ? e.warnings.join(' · ') : e.blocking.join(' · ')}</span>
    </header>
    ${e.url ? `<a class="url" href="${esc(e.url)}">${esc(e.url)}</a>` : ''}
    <dl>${rows(e).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${e.palette?.length ? `<div class="measure"><span>measured palette</span>${swatches(e.palette)}</div>` : ''}
    ${e.capturedAt ? `<p class="meta">captured ${esc(String(e.capturedAt).slice(0, 10))}</p>` : ''}
  </div>
</article>`
  })
  .join('')

const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reference pack — ${esc(path.basename(ctx.project))}</title>
<style>
  :root { --paper:#fbf9f5; --ink:#122821; --muted:#5c6b64; --rule:#e4e0d8; --accent:#5b21b6; --bad:#a13d2d; --good:#0f7a44; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif; }
  header.page { padding:28px 28px 16px; border-bottom:1px solid var(--rule); display:flex; flex-wrap:wrap; gap:10px 24px; align-items:baseline; }
  h1 { margin:0; font-size:20px; font-weight:600; }
  .counts { color:var(--muted); font-size:13px; }
  .counts b { color:var(--ink); }
  main { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:var(--rule); }
  .card { background:var(--paper); display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); align-items:start; min-width:0; }
  .shot { margin:0; background:#f1eee8; display:flex; align-items:center; justify-content:center; overflow:hidden; height:440px; padding:10px; }
  .shot img { max-width:100%; max-height:420px; width:auto; height:auto; object-fit:contain; display:block; box-shadow:0 1px 0 rgba(0,0,0,.08); }
  .missing { padding:40px; color:var(--muted); font-size:13px; }
  .body { padding:16px 18px; min-width:0; }
  .body header { display:flex; justify-content:space-between; gap:10px; align-items:baseline; }
  .id { font:500 12px/1.4 ui-monospace,monospace; color:var(--accent); }
  .status { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .status.blocked { color:var(--bad); } .status.complete { color:var(--good); }
  .url { display:block; margin:6px 0 12px; font-size:12px; color:var(--muted); word-break:break-all; text-decoration:none; }
  dl { margin:0; display:grid; grid-template-columns:auto; gap:2px; }
  dt { font:500 10px/1.4 ui-monospace,monospace; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); margin-top:10px; }
  dd { margin:0; font-size:13px; line-height:1.45; }
  .measure { margin-top:14px; font-size:11px; color:var(--muted); }
  .pal { display:flex; gap:4px; margin-top:6px; }
  .pal span { width:18px; height:18px; border-radius:50%; border:1px solid rgba(0,0,0,.12); }
  .meta { margin:14px 0 0; font-size:11px; color:var(--muted); }
  footer { padding:18px 28px 28px; color:var(--muted); font-size:12px; }
  @media (max-width:1100px){ main { grid-template-columns:1fr; } .card { grid-template-columns:1fr; } }
</style></head>
<body>
<header class="page">
  <h1>Reference pack — ${esc(path.basename(ctx.project))}</h1>
  <span class="counts"><b>${entries.length}</b> captures · <b>${complete.length}</b> complete · <b>${partial.length}</b> partial · <b>${blocked.length}</b> blocked</span>
</header>
<main>${cards}</main>
<footer>Generated ${nowDate()} from ${esc(path.relative(ctx.project, manifestFile))}. A reference needs a device and a thing not to copy; the rest is a picture.</footer>
</body></html>
`

writeFileSync(htmlFile, html)

/* -------------------------------------------------------------------- md -- */

if (args.has('md') || args.get('md')) {
  const name = args.get('md', 'refs.md')
  const mdFile = path.resolve(dir, name)
  const lines = [
    `# Reference pack — ${path.basename(ctx.project)}`,
    '',
    `> ${entries.length} captures · ${complete.length} complete · ${partial.length} partial · ${blocked.length} blocked · ${nowDate()}`,
    '',
    '| ID | Device | Not to copy | Fits | Status |',
    '|---|---|---|---|---|',
    ...entries.map((e) => `| ${e.id} | ${e.device ?? '—'} | ${e.avoid ?? '—'} | ${e.fits ?? '—'} | ${e.status} |`),
    '',
  ]
  writeFileSync(mdFile, lines.join('\n'))
  console.log(`→ ${rel(mdFile)}`)
}

/* ----------------------------------------------------------------- report -- */

console.log(`refs ${entries.length} · ${complete.length} complete · ${partial.length} partial · ${blocked.length} blocked`)
for (const e of entries) {
  const flag = e.status === 'complete' ? '✓' : e.status === 'partial' ? '!' : '✗'
  console.log(`  ${flag} ${e.id.padEnd(22)} ${e.device ? e.device.slice(0, 46) : '(no device)'}`)
}
console.log(`→ ${rel(htmlFile)}`)

if (args.has('json')) {
  console.log(JSON.stringify({ manifest: rel(manifestFile), entries: entries.map(({ file, ...e }) => e), complete: complete.length, partial: partial.length, blocked: blocked.length }, null, 2))
}

const gateFails = blocked.length > 0 && !args.has('lenient')
if (args.has('lenient') && blocked.length) console.warn(`\n! ${blocked.length} blocked capture(s); --lenient downgrades the gate to a warning.`)
process.exit(gateFails ? 1 : 0)
