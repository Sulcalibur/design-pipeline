#!/usr/bin/env node
/**
 * probe/compare.mjs — put two to four artifacts side by side and look at them.
 *
 * The direction stage needs a board before it needs a verdict. `preview` does
 * this for a curated probe run; `compare` does it for any files: HTML
 * prototypes, exported screenshots, or a mix. No config, no candidates, no
 * analysis. The sources are named, so this is a review board, not the blind
 * pair interview.
 *
 *   node compare.mjs A.html B.html [C.html] [--out compare.html] [--title "…"]
 *   node compare.mjs before.png after.png --notes notes.json --open
 *
 * Notes: a JSON object keyed by file name or index, e.g.
 *   { "A-redline-statement.html": "Single statement, annotated in the margin." }
 *
 * HTML is inlined through srcdoc with a <base> pointing at its own folder, so
 * self-contained prototypes render without a server and relative assets still
 * resolve. Images are copied beside the board.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseArgs, fail, rel } from './paths.mjs'

const HTML_EXT = new Set(['.html', '.htm'])
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'])

const args = parseArgs(process.argv.slice(2))
const inputs = args.positionals.map((p) => path.resolve(process.cwd(), p))
if (inputs.length < 2) fail('compare needs at least two files: node compare.mjs A.html B.html [C.html]')
if (inputs.length > 4) fail('compare shows at most four artifacts side by side')

const missing = inputs.filter((f) => !existsSync(f))
if (missing.length) fail(`not found: ${missing.join(', ')}`)

const outFile = path.resolve(process.cwd(), args.get('out', 'compare.html'))
const title = args.get('title', 'Design comparison')
const outDir = path.dirname(outFile)
const assetDir = path.join(outDir, 'compare-assets')

const notesPath = args.get('notes', null)
let notes = {}
if (notesPath) {
  try {
    notes = JSON.parse(readFileSync(path.resolve(process.cwd(), notesPath), 'utf8'))
  } catch (e) {
    fail(`notes file is not valid JSON: ${e.message}`)
  }
}

function noteFor(file, index) {
  return notes[file] ?? notes[path.basename(file)] ?? notes[index] ?? notes[String(index)] ?? ''
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/** Give an inlined document a base so its relative assets resolve where it lives. */
function withBase(html, file) {
  if (/<base\b/i.test(html)) return html
  const base = `<base href="${escapeHtml(pathToFileURL(path.dirname(file) + path.sep).href)}">`
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => m + base)
  return base + html
}

const panels = inputs.map((file, index) => {
  const ext = path.extname(file).toLowerCase()
  const name = path.basename(file)
  const label = name.replace(/\.[^.]+$/, '')
  const note = noteFor(name, index)
  const size = statSync(file).size

  if (HTML_EXT.has(ext)) {
    const html = withBase(readFileSync(file, 'utf8'), file)
    // Base64 in a data attribute avoids every quoting and </script> problem.
    const b64 = Buffer.from(html, 'utf8').toString('base64')
    return { kind: 'html', file, name, label, note, size, b64 }
  }
  if (IMG_EXT.has(ext)) {
    mkdirSync(assetDir, { recursive: true })
    const safe = `${String(index + 1).padStart(2, '0')}-${name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    copyFileSync(file, path.join(assetDir, safe))
    return { kind: 'image', file, name, label, note, size, src: `compare-assets/${safe}` }
  }
  fail(`unsupported file type: ${name} (HTML or an image)`)
})

const kb = (n) => `${Math.round(n / 1024)} KB`

const grid = panels
  .map(
    (p, i) => `
    <figure class="panel">
      <figcaption>
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="label">${escapeHtml(p.label)}</span>
        <span class="meta">${escapeHtml(p.name)} · ${kb(p.size)}</span>
      </figcaption>
      <div class="frame" data-kind="${p.kind}"${p.b64 ? ` data-doc="${p.b64}"` : ''}>
        ${p.kind === 'image' ? `<img src="${escapeHtml(p.src)}" alt="${escapeHtml(p.label)}">` : '<iframe title="' + escapeHtml(p.label) + '"></iframe>'}
      </div>
      ${p.note ? `<p class="note">${escapeHtml(p.note)}</p>` : ''}
      <a class="open" href="${escapeHtml(pathToFileURL(p.file).href)}">open original ↗</a>
    </figure>`,
  )
  .join('')

const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --chrome: #111417; --chrome-2: #191d21; --line: #2a3036;
    --ink: #e9ecef; --muted: #9aa4ad; --accent: #b39bea;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--chrome); color: var(--ink);
    font: 15px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
  header { padding: 28px 28px 18px; border-bottom: 1px solid var(--line); display: flex;
    flex-wrap: wrap; align-items: baseline; gap: 10px 22px; }
  h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
  .sub { color: var(--muted); font-size: 13px; }
  .sub b { color: var(--ink); font-weight: 500; }
  main { display: grid; grid-template-columns: repeat(${panels.length}, minmax(0, 1fr));
    gap: 1px; background: var(--line); }
  .panel { margin: 0; background: var(--chrome-2); display: flex; flex-direction: column; min-width: 0; }
  figcaption { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px;
    padding: 14px 16px; border-bottom: 1px solid var(--line); }
  .idx { grid-row: span 2; color: var(--accent); font: 500 12px/1.4 ui-monospace, monospace; }
  .label { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--muted); font: 12px/1.4 ui-monospace, monospace; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .frame { position: relative; overflow: hidden; background: #fff; min-height: 240px; }
  .frame iframe { position: absolute; inset: 0 auto auto 0; width: 1440px; height: 900px;
    border: 0; transform-origin: top left; }
  .frame img { display: block; width: 100%; height: auto; }
  .note { margin: 0; padding: 12px 16px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); }
  .open { margin: 0 16px 14px; color: var(--accent); font-size: 12px; text-decoration: none; }
  .open:hover { text-decoration: underline; }
  footer { padding: 16px 28px 24px; color: var(--muted); font-size: 12px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <span class="sub"><b>${panels.length}</b> artifacts · sources named · review board, not a blind pair test</span>
</header>
<main>${grid}</main>
<footer>Generated ${new Date().toISOString().slice(0, 10)}. Each panel is the file as it stands; the board does not modify or score it.</footer>
<script>
  const fits = () => {
    document.querySelectorAll('.frame[data-kind="html"]').forEach((frame) => {
      const doc = frame.dataset.doc
      const iframe = frame.querySelector('iframe')
      if (!iframe || !doc) return
      if (!iframe.dataset.loaded) {
        iframe.srcdoc = new TextDecoder().decode(Uint8Array.from(atob(doc), (c) => c.charCodeAt(0)))
        iframe.dataset.loaded = '1'
      }
      const w = frame.clientWidth
      const scale = w ? Math.min(1, w / 1440) : 1
      iframe.style.transform = 'scale(' + scale + ')'
      frame.style.height = Math.round(900 * scale) + 'px'
    })
  }
  window.addEventListener('resize', fits)
  document.querySelectorAll('.frame[data-kind="html"] iframe').forEach((f) => f.addEventListener('load', fits))
  fits()
</script>
</body>
</html>
`

writeFileSync(outFile, html)
console.log(`compare ${panels.length} artifact(s)`)
for (const p of panels) console.log(`  ${p.kind.padEnd(5)} ${rel(p.file)}`)
console.log(`→ ${rel(outFile)}`)

if (args.has('open')) {
  spawnSync('open', [outFile], { stdio: 'ignore' })
}
