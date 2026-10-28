#!/usr/bin/env node
/**
 * probe/sheet.mjs — contact sheet of the slice worth looking at.
 *
 * An Eagle library is 19k items and most captures are SaaS galleries; a folder
 * manifest is already curated. The slice rules live in `sheet.slice`, so the
 * genre judgement is project content, not engine code.
 *
 *   node sheet.mjs --config <project>/probe.config.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { resolvePaths, loadConfig, fail, rel } from './paths.mjs'

const paths = resolvePaths(process.argv.slice(2))
const config = loadConfig(paths.config)
const sliceConfig = config.sheet?.slice ?? {}
const sourceKind = config.sources?.kind ?? 'eagle'

if (!existsSync(paths.candidates)) fail(`no candidates at ${paths.candidates} — run ingest first`)
const candidates = JSON.parse(readFileSync(paths.candidates, 'utf8'))

// Optional: measured profiles from `analyze`, shown on the card so curation can
// be done from the sheet rather than by opening every capture.
const analysisPath = path.join(paths.data, 'analysis.json')
const measured = existsSync(analysisPath) ? JSON.parse(readFileSync(analysisPath, 'utf8')).images ?? {} : {}
const profileLine = (id) => {
  const m = measured[id]?.measured
  if (!m) return ''
  const chips = m.palette.slice(0, 4).map((p) => `<i style="background:${p.hex}"></i>`).join('')
  return `<span class="prof">${chips}<b>${m.visualDensity}</b> · ${m.bands} bands · ${m.columns} col${m.columns === 1 ? '' : 's'}</span>`
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const includeHosts = sliceConfig.hosts?.length ? new RegExp(sliceConfig.hosts.map(escapeRe).join('|'), 'i') : null
const excludeHosts = sliceConfig.excludeHosts?.length
  ? new RegExp(`(^|\\.)(${sliceConfig.excludeHosts.map(escapeRe).join('|')})$`, 'i')
  : null

const isEditorial = (i) =>
  (sliceConfig.tags ?? []).some((t) => i.tags?.includes(t)) ||
  (sliceConfig.folders ?? []).some((f) => i.folders?.some((x) => x === f || x.includes(f))) ||
  (includeHosts ? includeHosts.test(i.host ?? '') : false)

const curated = sourceKind === 'folder' || (!sliceConfig.tags?.length && !sliceConfig.folders?.length && !includeHosts)
const seen = new Set()
const slice = candidates
  .filter((i) => curated || isEditorial(i))
  .filter((i) => !(excludeHosts && excludeHosts.test(i.host ?? '')))
  .filter((i) => {
    const key = i.url || i.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  .sort((a, b) => (a.host ?? '').localeCompare(b.host ?? '') || (a.name ?? '').localeCompare(b.name ?? ''))

const dims = (i) => (i.width && i.height ? `${i.width}×${i.height}` : i.width ? `${i.width}px wide` : 'dimensions unknown')

const cards = slice
  .map(
    (i, n) => `
    <figure>
      <div class="shot"><img src="/img/${encodeURIComponent(i.id)}?thumb=1" loading="lazy" alt=""></div>
      <figcaption><b>${String(n + 1).padStart(3, '0')}</b> ${escapeHtml(i.name)}<span>${escapeHtml(i.host ?? 'local')} · ${dims(i)}</span>${profileLine(i.id)}</figcaption>
    </figure>`,
  )
  .join('')

const title = sliceConfig.title ?? `${curated ? 'Reference slice' : 'Editorial slice'} — ${slice.length} captures`
const meta =
  sliceConfig.meta ??
  (sourceKind === 'folder'
    ? `${path.basename(config.sources?.path ?? 'references')}/manifest.json · ${candidates.length} curated entries`
    : [
        config.sources?.library ? `${config.sources.library}.library` : 'Eagle library',
        (sliceConfig.tags ?? []).length ? `tags ${sliceConfig.tags.join('/')}` : null,
        (sliceConfig.folders ?? []).length ? sliceConfig.folders.join(' · ') : null,
        (sliceConfig.hosts ?? []).length ? 'named hosts' : null,
      ]
        .filter(Boolean)
        .join(' · '))

mkdirSync(paths.build, { recursive: true })
writeFileSync(
  paths.sheet,
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Probe sheet · ${slice.length}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #f6f4ef; color: #1a1a1a;
         font: 13px/1.4 ui-sans-serif, -apple-system, sans-serif; }
  h1 { font: 500 18px/1.3 Georgia, serif; margin: 0 0 4px; }
  p.meta { margin: 0 0 20px; color: #6b665c; }
  .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 18px 14px; }
  figure { margin: 0; }
  .shot { aspect-ratio: 3 / 4; overflow: hidden; background: #e7e2d8; border-radius: 3px;
          box-shadow: 0 1px 2px rgb(0 0 0 / 8%); }
  .shot img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; }
  figcaption { font-size: 11px; line-height: 1.35; margin-top: 6px; color: #333; }
  figcaption b { display: inline-block; min-width: 26px; color: #8a8378; font-weight: 600; }
  figcaption span { display: block; color: #8a8378; margin-top: 1px; }
  figcaption .prof { display: flex; align-items: center; gap: 3px; color: #6b665c; }
  figcaption .prof i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  figcaption .prof b { color: #333; font-weight: 600; margin-left: 4px; }
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${escapeHtml(meta)}</p>
  <div class="grid">${cards}</div>
</body></html>`,
)

console.log(`sheet: ${slice.length} cards → ${rel(paths.sheet)}`)
console.log('hosts:', [...new Set(slice.map((i) => i.host ?? '(local)'))].length)

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}
