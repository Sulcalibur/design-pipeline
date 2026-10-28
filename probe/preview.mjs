#!/usr/bin/env node
/**
 * probe/preview.mjs — a static pair page for reviewing a run.
 *
 * Reads the config's pairs and the layers in analysis.json, and writes one
 * self-contained HTML page: two designs side by side, with what was measured,
 * what the live page says, and what was authored. Click a side to record a
 * choice; export the choices as JSON.
 *
 * This is for looking at and discussing a run. The real probe (serve) is the
 * blind, randomised interview; this page names the sources, so it cannot be
 * used to produce unbiased answers.
 *
 *   node preview.mjs --config … [--name preview.html] [--open]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolvePaths, loadConfig, loadCandidates, fail, rel } from './paths.mjs'

const paths = resolvePaths(process.argv.slice(2))
const config = loadConfig(paths.config)
const candidates = loadCandidates(paths.candidates) ?? []
const byId = new Map(candidates.map((c) => [c.id, c]))

const analysisPath = path.join(paths.data, 'analysis.json')
const analysis = existsSync(analysisPath) ? JSON.parse(readFileSync(analysisPath, 'utf8')).images ?? {} : {}

const outFile = path.join(paths.out, paths.args.get('name', 'preview.html'))
const assetDir = path.join(path.dirname(outFile), 'preview')
mkdirSync(assetDir, { recursive: true })

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function imageFor(id) {
  const entry = analysis[id]
  const option = optionById.get(id)
  const candidate = byId.get(id)
  const raw = option?.src || entry?.live?.screenshot || entry?.file || (candidate?.file && !candidate.file.endsWith('.info') ? candidate.file : null)
  if (!raw || !existsSync(raw)) return null
  const ext = path.extname(raw).toLowerCase() || '.png'
  const name = `${id}${ext}`
  copyFileSync(raw, path.join(assetDir, name))
  return `preview/${name}`
}

const optionById = new Map()
for (const pair of config.pairs ?? []) {
  for (const option of pair.options ?? []) optionById.set(option.id, option)
}

const pairs = (config.pairs ?? []).filter((p) => p.mode !== 'confirm')
const html = []

const palette = (m) =>
  m?.palette?.length
    ? `<div class="pal">${m.palette
        .slice(0, 6)
        .map((p) => `<span title="${p.hex} ${Math.round(p.share * 100)}%" style="background:${p.hex}"></span>`)
        .join('')}</div>`
    : ''

const fact = (label, value) => (value ? `<div class="fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '')

function card(id, side) {
  const option = optionById.get(id)
  const entry = analysis[id]
  const m = entry?.measured
  const live = entry?.live
  const authored = entry?.authored
  const img = imageFor(id)
  const host = (() => {
    try {
      return new URL(option?.url ?? live?.url ?? '').hostname.replace(/^www\./, '')
    } catch {
      return option?.label ?? id
    }
  })()
  const sections = (live?.sections ?? []).filter((s) => s.head).slice(0, 5)
  const fonts = live?.roles ?? {}

  return `<article class="card" data-id="${esc(id)}" data-side="${side}">
    <button class="pick" type="button" aria-pressed="false">Choose this</button>
    <div class="shot">${img ? `<img src="${esc(img)}" alt="${esc(option?.alt ?? option?.label ?? id)}" loading="lazy">` : '<span class="missing">no image</span>'}</div>
    <header>
      <h3>${esc(option?.label && option.label !== id ? option.label : host)}</h3>
      <p class="src">${esc(host)}${option?.url ? ` · <a href="${esc(option.url)}" target="_blank" rel="noreferrer">source</a>` : ''}</p>
      ${option?.vocab ? `<p class="vocab">${esc(option.vocab)}</p>` : ''}
    </header>
    ${palette(m)}
    <dl class="facts">
      ${fact('measured', m ? `${m.visualDensity} · ${Math.round((m.whitespace ?? 0) * 100)}% quiet · ${m.bands} bands · ${m.columns} col` : null)}
      ${fact('display', fonts.h1 ? `${fonts.h1.fontFamily} ${fonts.h1.fontSize}/${fonts.h1.lineHeight}` : null)}
      ${fact('body', fonts.body ? `${fonts.body.fontFamily} ${fonts.body.fontSize}` : null)}
      ${fact('nav', fonts.navLinks ? `${fonts.navLinks} links` : null)}
      ${fact('sections', live?.sections?.length ? `${live.sections.length}` : null)}
    </dl>
    ${sections.length ? `<ol class="sections">${sections.map((s) => `<li>${esc(s.head)}<span>${Math.round(s.height)}px${s.columns ? ` · ${esc(s.columns)}` : ''}</span></li>`).join('')}</ol>` : ''}
    ${authored?.layoutModel || authored?.style ? `<p class="authored">${esc([authored.style, authored.layoutModel].filter(Boolean).join(' — '))}</p>` : ''}
    ${authored?.devices?.length ? `<p class="authored"><strong>devices</strong> ${esc(authored.devices.join(' · '))}</p>` : ''}
    ${option?.note ? `<p class="note">${esc(option.note)}</p>` : ''}
  </article>`
}

let n = 0
for (const pair of pairs) {
  const [a, b] = pair.options ?? []
  if (!a || !b) continue
  n += 1
  html.push(`<section class="pair">
    <div class="pair-head">
      <span class="axis">${esc(pair.axis)}</span>
      <h2>${esc(pair.question ?? pair.axis)}</h2>
      ${pair.hint ? `<p class="hint">${esc(pair.hint)}</p>` : ''}
    </div>
    <div class="cards">${card(a.id, 'a')}${card(b.id, 'b')}</div>
    <p class="choice" aria-live="polite"></p>
  </section>`)
}

const populated = Object.values(analysis).filter((e) => e.measured || e.live).length

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.ui?.title ?? config.id)} — pair preview</title>
<style>
  :root{color-scheme:light;--ink:#1b1a18;--muted:#6d675e;--paper:#f7f4ee;--card:#fffdf8;--line:#e2dbcd;--accent:#7a4b2a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",sans-serif}
  a{color:var(--accent)}
  header.page{padding:40px 28px 24px;border-bottom:1px solid var(--line);max-width:1500px;margin:0 auto}
  h1{font:500 30px/1.2 Georgia,serif;margin:0 0 6px}
  .meta{color:var(--muted);margin:0}
  main{max-width:1500px;margin:0 auto;padding:28px}
  .pair{margin:0 0 56px}
  .pair-head{display:grid;grid-template-columns:110px 1fr;gap:6px 18px;align-items:baseline;margin-bottom:16px}
  .axis{grid-row:span 2;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);padding-top:6px}
  .pair h2{font:500 22px/1.25 Georgia,serif;margin:0}
  .hint{grid-column:2;margin:2px 0 0;color:var(--muted);font-size:13px}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  .card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px}
  .card.chosen{outline:2px solid var(--accent);outline-offset:-2px}
  .pick{position:absolute;top:10px;right:10px;z-index:2;font:600 11px/1 ui-sans-serif;letter-spacing:.04em;text-transform:uppercase;background:#fff;border:1px solid var(--line);border-radius:99px;padding:7px 11px;cursor:pointer}
  .pick[aria-pressed="true"]{background:var(--accent);color:#fff;border-color:var(--accent)}
  .shot{aspect-ratio:16/10;overflow:hidden;border-radius:6px;background:#ece6da;border:1px solid var(--line)}
  .shot img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
  .missing{display:grid;place-items:center;height:100%;color:var(--muted);font-size:12px}
  .card h3{font:600 17px/1.3 ui-sans-serif;margin:0}
  .src,.vocab,.note,.authored{margin:2px 0 0;font-size:12.5px;color:var(--muted)}
  .vocab{color:var(--ink)}
  .pal{display:flex;gap:4px}
  .pal span{width:26px;height:18px;border-radius:3px;border:1px solid rgba(0,0,0,.08)}
  .facts{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0;font-size:12.5px}
  .fact{display:contents}
  .facts dt{color:var(--muted)}
  .facts dd{margin:0}
  .sections{margin:0;padding-left:18px;font-size:12.5px;color:var(--ink)}
  .sections li{margin:1px 0}
  .sections span{color:var(--muted);margin-left:6px;font-variant-numeric:tabular-nums}
  .authored{border-left:2px solid var(--line);padding-left:8px}
  .choice{margin:10px 2px 0;font-size:13px;color:var(--accent);min-height:1em}
  footer{max-width:1500px;margin:0 auto;padding:0 28px 60px;color:var(--muted);font-size:12.5px}
  @media (max-width:900px){.cards{grid-template-columns:1fr}.pair-head{grid-template-columns:1fr}.axis{grid-row:auto}}
</style></head>
<body>
<header class="page">
  <h1>${esc(config.ui?.title ?? config.id)} — pair preview</h1>
  <p class="meta">${pairs.length} pairs · ${populated} profiles · measured from pixels, live from the page, authored where someone looked.</p>
</header>
<main>${html.join('\n')}</main>
<footer>
  <p>Click a side to record a choice, then <button id="export" type="button">export choices</button>. Choices stay in this browser.</p>
  <p>Sources are shown, so this page is for review — the probe itself hides them until a run is saved.</p>
  <pre id="out" hidden></pre>
</footer>
<script>
  const key = 'preview:${esc(config.id ?? 'run')}'
  const state = JSON.parse(localStorage.getItem(key) || '{}')
  document.querySelectorAll('.card').forEach((card) => {
    const id = card.dataset.id
    const pair = card.closest('.pair')
    const pairKey = pair.querySelector('h2').textContent
    const btn = card.querySelector('.pick')
    const sync = () => {
      const chosen = state[pairKey] === id
      btn.setAttribute('aria-pressed', String(chosen))
      card.classList.toggle('chosen', chosen)
    }
    btn.addEventListener('click', () => {
      if (state[pairKey] === id) delete state[pairKey]
      else state[pairKey] = id
      localStorage.setItem(key, JSON.stringify(state))
      pair.querySelector('.choice').textContent = state[pairKey] ? 'kept: ' + state[pairKey] : ''
      document.querySelectorAll('.card').forEach((c) => {
        if (c.closest('.pair') === pair) {
          c.classList.toggle('chosen', state[pairKey] === c.dataset.id)
          c.querySelector('.pick').setAttribute('aria-pressed', String(state[pairKey] === c.dataset.id))
        }
      })
    })
    sync()
  })
  document.getElementById('export').addEventListener('click', async () => {
    const text = JSON.stringify({ probe: ${JSON.stringify(config.id ?? 'run')}, choices: state }, null, 2)
    const out = document.getElementById('out')
    out.hidden = false
    out.textContent = text
    try { await navigator.clipboard.writeText(text) } catch {}
  })
</script>
</body></html>`

writeFileSync(outFile, page)
console.log(`pairs ${pairs.length} · profiles ${populated}`)
console.log(`→ ${rel(outFile)}`)
if (paths.args.has('open')) {
  try {
    execFileSync('open', [outFile])
  } catch {}
}
