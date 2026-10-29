#!/usr/bin/env node
/**
 * probe/brand.mjs — the brand interview, and the document it produces.
 *
 * A local app asks one question at a time. Every answer carries a status
 * (verified / assumption / tbc) and a source. At the end it writes brand.md and
 * brand.json — the record a design direction, a page brief or an agent reads.
 *
 *   node brand.mjs scaffold [--project <root>]
 *   node brand.mjs serve [--project <root>] [--port 4211]
 *   node brand.mjs status [--project <root>]
 *   node brand.mjs emit [--project <root>] [--dry]
 *
 * The config is the tool's default; a project may override it by keeping
 * docs/brand/brand.config.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawnSync, spawn } from 'node:child_process'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'

const here = import.meta.dirname

/** Split a command string, respecting quoted words, for spawning. */
function parseCmd(cmd) {
  const out = []
  for (const match of String(cmd ?? '').matchAll(/(?:[^\s"]+|"[^"]*")+/g)) {
    out.push(match[0].replace(/^"|"$/g, ''))
  }
  return out
}
const args = parseArgs(process.argv.slice(2))
const cmd = args.positionals[0] ?? 'serve'
const project = path.resolve(process.cwd(), args.get('project', '.'))
const brandDir = path.resolve(project, args.get('dir', 'docs/brand'))
const answersPath = path.join(brandDir, 'data/answers.json')
const projectConfig = path.join(brandDir, 'brand.config.json')
const toolConfig = path.join(here, 'brand.config.json')
const configPath = existsSync(projectConfig) ? projectConfig : toolConfig
const defaultConfig = () => JSON.parse(readFileSync(toolConfig, 'utf8'))

/**
 * Project config wins on shape; the tool default supplies the explanations
 * (why, example, tbcHint), so an old copied project config is not guaranteed
 * to hold stale wording forever.
 */
function loadConfig() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const defaults = JSON.parse(readFileSync(toolConfig, 'utf8'))
  const byId = new Map(defaults.questions.map((q) => [q.id, q]))
  for (const q of config.questions ?? []) {
    const d = byId.get(q.id)
    if (!d) continue
    for (const [key, doc] of Object.entries(d)) {
      if (['why', 'example', 'tbcHint', 'help'].includes(key)) {
        // Explanations fill gaps; a project may override the wording.
        if (q[key] == null) q[key] = doc
      } else if (['type', 'placeholder', 'help'].includes(key)) {
        // Behaviour follows the tool: an old scaffold should not pin a stale widget.
        q[key] = doc
      }
    }
    if (q.help == null) q.help = d.help
  }
  for (const section of config.sections ?? []) {
    const d = (defaults.sections ?? []).find((x) => x.id === section.id)
    if (d && section.note == null) section.note = d.note
  }
  return config
}
const loadAnswers = () => (existsSync(answersPath) ? JSON.parse(readFileSync(answersPath, 'utf8')) : { answers: {} })

const effectiveStatus = (answer) => answer?.status || (hasValue(answer?.value) ? 'assumption' : 'tbc')

function hasValue(value) {
  if (value == null) return false
  if (Array.isArray(value)) return value.filter((v) => String(v).trim()).length > 0
  if (typeof value === 'object') return Object.values(value).some((v) => hasValue(v))
  return String(value).trim().length > 0
}

/* --------------------------------------------------------------- contrast -- */

const hexToRgb = (hex) => {
  // 3-digit and 6-digit hex are both valid CSS; expand #fff rather than fail silently.
  const m = String(hex ?? '').match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** First hex in a free-text colour answer, normalised to 6 digits for display. */
const firstHex = (hex) => {
  const m = String(hex ?? '').match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return `#${h.toLowerCase()}`
}
const luminance = ([r, g, b]) => {
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a, b) => {
  const la = luminance(a)
  const lb = luminance(b)
  return Number(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(2))
}

function contrastResults(config, value) {
  const out = []
  for (const pair of config.contrastPairs ?? []) {
    const fg = hexToRgb(value(pair.fg))
    const bg = hexToRgb(value(pair.bg))
    if (!fg || !bg) continue
    const r = ratio(fg, bg)
    out.push({
      id: pair.id,
      label: pair.label,
      fg: firstHex(value(pair.fg)),
      bg: firstHex(value(pair.bg)),
      ratio: r,
      min: pair.min ?? 4.5,
      passes: r >= (pair.min ?? 4.5),
    })
  }
  return out
}

/* ------------------------------------------------------------------ emit -- */

function emit({ dry = false } = {}) {
  const config = loadConfig()
  const { answers = {} } = loadAnswers()
  const q = Object.fromEntries(config.questions.map((x) => [x.id, x]))
  const value = (id) => answers[id]?.value ?? null

  const rows = config.questions.map((question) => {
    const answer = answers[question.id] ?? {}
    return {
      id: question.id,
      section: question.section,
      label: question.label,
      question: question.question,
      status: effectiveStatus(answer),
      source: answer.source ?? null,
      value: answer.value ?? null,
      present: hasValue(answer.value),
    }
  })
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))

  const product = String(value('product') ?? '').trim()
  const oneLine = String(value('oneLine') ?? '').trim()
  if (!product) fail('nothing to emit: the "product" question has no answer')
  const generatedAt = new Date().toISOString()

  const contrast = contrastResults(config, value)

  const gaps = rows.filter((r) => r.status === 'tbc' || (q[r.id]?.required && !r.present))
  const assumptions = rows.filter((r) => r.status === 'assumption')
  const unverified = rows.filter((r) => r.status === 'verified' && !r.source)

  const list = (id) => {
    const v = value(id)
    if (Array.isArray(v)) return v.filter((x) => String(x).trim())
    return hasValue(v) ? [String(v)] : []
  }
  const dials = value('dials') ?? {}

  const identity = {
    palette: ['v2-paper', 'v2-ink', 'v2-accent', 'v2-surface']
      .map((id) => ({ role: q[id]?.label?.replace(/^V2 Colour — /, '') ?? id, value: value(id) }))
      .filter((x) => hasValue(x.value)),
    type: ['v3-display', 'v3-body', 'v3-ui']
      .map((id) => ({ role: q[id]?.label?.replace(/^V3 Type — /, '') ?? id, value: value(id) }))
      .filter((x) => hasValue(x.value)),
    logo: value('v1') ?? null,
    imagery: value('v4') ?? null,
    layout: value('v5') ?? null,
    motion: value('v6') ?? null,
    texture: value('v7') ?? null,
    forbidden: list('v8'),
  }

  const direction = {
    decisions: ['d1-1', 'd1-2', 'd1-3'].map((id) => value(id)).filter(hasValue),
    refusal: value('d1-refusal') ?? null,
    dials: Object.fromEntries(
      (config.questions.find((x) => x.id === 'dials')?.dials ?? []).map((d) => [
        d.id,
        { label: d.label, current: dials?.[d.id]?.current ?? null, target: dials?.[d.id]?.target ?? null },
      ]),
    ),
  }

  const spec = {
    product,
    oneLine: oneLine || null,
    generatedAt,
    stage: value('stage') ?? null,
    owner: value('owner') ?? null,
    sources: list('sources'),
    slots: Object.fromEntries(rows.map((r) => [r.id, { label: r.label, status: r.status, source: r.source, value: r.value }])),
    identity,
    direction,
    contrast,
    gaps: gaps.map((g) => ({ id: g.id, label: g.label, status: g.status })),
    assumptions: assumptions.map((a) => a.id),
  }

  const statusLabel = { verified: 'Verified', assumption: 'Assumption', tbc: 'TBC' }
  const sectionTitle = Object.fromEntries(config.sections.map((s) => [s.id, s.title]))

  const lines = []
  lines.push(`# Brand — ${product}`, '')
  const stageLabel = (() => {
    const o = q.stage?.options?.find((x) => x.id === value('stage'))
    return o?.label ?? value('stage') ?? 'not stated'
  })()
  if (oneLine) lines.push(`> ${oneLine}`)
  lines.push(`> Stage: ${stageLabel} · Owner: ${value('owner') ?? 'not stated'} · Generated ${generatedAt.slice(0, 10)}.`, '')
  if (contrast.length) {
    lines.push(
      '| Contrast | Pair | Ratio | Required | Result |',
      '|---|---|---|---|---|',
      ...contrast.map((c) => `| ${c.label} | ${c.fg} on ${c.bg} | ${c.ratio}:1 | ${c.min}:1 | ${c.passes ? 'pass' : 'FAIL'} |`),
      '',
    )
  }

  lines.push('## Sources', '')
  lines.push(...(list('sources').map((s) => `- ${s}`) || ['- none recorded']), '')

  for (const section of config.sections) {
    if (section.id === 'evidence') continue
    const sectionRows = rows.filter((r) => r.section === section.id)
    if (!sectionRows.length) continue
    lines.push(`## ${sectionTitle[section.id] ?? section.title}`, '')
    if (section.note) lines.push(`_${section.note}_`, '')
    for (const row of sectionRows) {
      const qq = q[row.id]
      lines.push(`### ${row.label} — ${statusLabel[row.status]}`, '')
      if (!row.present) {
        lines.push('`TBC` — not answered.', '')
        continue
      }
      if (qq.type === 'dials') {
        lines.push('| Dial | Current | Target | Gap |', '|---|---|---|---|')
        for (const [key, d] of Object.entries(direction.dials)) {
          const gap = d.current && d.target ? Number(d.target) - Number(d.current) : null
          lines.push(`| ${d.label} | ${d.current ?? '—'} | ${d.target ?? '—'} | ${gap != null ? (gap > 0 ? `+${gap}` : gap) : '—'} |`)
        }
        lines.push('')
        continue
      }
      const items = Array.isArray(row.value) ? row.value.filter((x) => String(x).trim()) : null
      if (items) lines.push(...items.map((i) => `- ${i}`), '')
      else lines.push(`${row.value}`, '')
      if (row.source) lines.push(`_Source: ${row.source}_`, '')
    }
  }

  lines.push('## Gaps', '')
  if (!gaps.length) {
    lines.push('None. Every required slot is answered.', '')
  } else {
    lines.push('| Slot | Status | What it blocks |', '|---|---|---|')
    for (const g of gaps) lines.push(`| ${g.label} | ${statusLabel[g.status]} | A direction or claim that depends on it |`)
    lines.push('')
  }
  if (unverified.length) {
    lines.push(
      `**Marked Verified without a source:** ${unverified.map((u) => u.label).join(' · ')}.`,
      'Either add the source it came from, or downgrade the status. A record cannot claim proof it did not record.',
      '',
    )
  }
  if (assumptions.length) {
    lines.push(
      `**Assumptions to verify:** ${assumptions.map((a) => a.label).join(' · ')}.`,
      'Each is an answer without a source. Do not quote them as fact.',
      '',
    )
  }

  if (direction.decisions.length || direction.refusal) {
    lines.push('## Direction in one page', '')
    direction.decisions.forEach((d, i) => lines.push(`${i + 1}. ${d}`))
    if (direction.refusal) lines.push('', `**Refusal:** ${direction.refusal}`)
    lines.push('')
  }

  lines.push('---', '')
  lines.push(
    'This record is the source for a brief, a page direction or an agent. Quote it; do not paraphrase it into something stronger.',
  )

  const md = lines.join('\n')
  if (dry) {
    console.log(md.split('\n').slice(0, 40).join('\n'))
    return { md, spec }
  }
  mkdirSync(brandDir, { recursive: true })
  writeFileSync(path.join(brandDir, 'brand.md'), md)
  writeFileSync(path.join(brandDir, 'brand.json'), JSON.stringify(spec, null, 2) + '\n')
  console.log(`brand → ${rel(path.join(brandDir, 'brand.md'))}`)
  console.log(`spec  → ${rel(path.join(brandDir, 'brand.json'))}`)
  console.log(`${rows.filter((r) => r.present).length}/${rows.length} answered · ${gaps.length} gap(s) · ${assumptions.length} assumption(s)`)
  return { md, spec }
}

/* ----------------------------------------------------------------- serve -- */

function serve() {
  const port = Number(args.get('port', 4211))
  const appDir = path.join(here, 'brand/app')
  if (!existsSync(appDir)) fail(`app not found: ${appDir}`)
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }

  mkdirSync(path.join(brandDir, 'data'), { recursive: true })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
      res.end(body)
    }
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return send(200, readFileSync(path.join(appDir, 'index.html')), MIME['.html'])
      }
      if (req.method === 'GET' && url.pathname === '/brand.config.json') {
        return send(200, JSON.stringify(loadConfig()), MIME['.json'])
      }
      if (req.method === 'GET' && url.pathname === '/api/answers') {
        return send(200, JSON.stringify(loadAnswers()), MIME['.json'])
      }
      if (req.method === 'POST' && url.pathname === '/api/ai-help') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { id, type } = JSON.parse(body || '{}')
        if (!id) return send(400, 'slot id required')
        const cfg = loadConfig()
        const question = cfg.questions.find((q) => q.id === id)
        if (!question) return send(404, `unknown slot ${id}`)
        const { answers: current = {} } = loadAnswers()

        // Context: everything answered so far. Truncated so one long slot
        // cannot crowd the rest of the record out of the prompt.
        const context = []
        for (const q of cfg.questions) {
          if (q.id === id) continue
          const a = current[q.id]
          if (a?.value == null) continue
          const text = Array.isArray(a.value) ? a.value.join('; ') : typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value)
          if (!text.trim()) continue
          context.push(`${q.label ?? q.id}: ${text.trim().slice(0, 240)}`)
        }
        const dials = current.dials?.value ?? cfg.dials
        if (dials && typeof dials === 'object') {
          const rows = Object.entries(dials)
            .map(([k, d]) => `${d.label ?? k} target ${d.target ?? '—'}`)
            .join(', ')
          if (rows) context.push(`Direction dials (where the brand is heading): ${rows}`)
        }

        const shape = {
          long: 'Answer in 1–2 plain sentences.',
          list: 'Answer as a short list, one item per line.',
          owner: 'Answer as one line in the exact form: Name — YYYY-MM-DD (use the current date for the date).',
          colour: 'Answer with a single hex colour like #a4452e.',
        }[type] ?? 'Answer in one short line.'

        const prompt = [
          `You are drafting one answer for a brand record for: ${current.product?.value ?? cfg.product ?? 'the project'}.`,
          current.oneLine?.value ? `What it is: ${current.oneLine.value}` : '',
          '',
          'Everything known so far:',
          context.length ? context.map((l) => `- ${l}`).join('\n') : '- nothing answered yet',
          '',
          `Slot to fill — ${question.label ?? id}: ${question.question}`,
          question.help ? `Guidance: ${question.help}` : '',
          question.why ? `Why this slot exists: ${question.why}` : '',
          '',
          'Rules:',
          `- Use only the context above. Do NOT invent facts, numbers, prices, dates or customer quotes.`,
          shape,
          `- If nothing in the context lets you answer honestly, reply exactly: TBC`,
          '- Reply with the answer only. No preamble, no quotes around it, no explanation.',
          '- Never present the answer as verified or sourced.',
        ].filter(Boolean).join('\n')

        const cmd = process.env.BRAND_AI_CMD ?? 'opencode run --format json'
        const [bin, ...args] = parseCmd(cmd)
        const model = process.env.BRAND_AI_MODEL
        const result = await new Promise((resolve) => {
          const child = spawn(bin, model ? [...args, '--model', model, prompt] : [...args, prompt], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] })
          let out = ''
          let err = ''
          const timer = setTimeout(() => child.kill('SIGKILL'), 90_000)
          child.stdout.on('data', (c) => { out += c })
          child.stderr.on('data', (c) => { err += c })
          child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: `${bin}: ${e.message}` }) })
          child.on('close', (code) => {
            clearTimeout(timer)
            let draft = ''
            for (const line of out.split('\n')) {
              if (line.startsWith('{')) {
                try {
                  const event = JSON.parse(line)
                  if (event.type === 'text') draft += event.part?.text ?? ''
                } catch {}
              }
            }
            if (!draft.trim() && code === 0 && out.trim()) draft = out.trim()
            resolve({ ok: code === 0 && draft.trim().length > 0, draft: draft.trim(), error: code === 0 ? '' : (err.trim().slice(-400) || `exit ${code}`) })
            console.error(`[ai-help] ${id} → exit ${code}, err: ${err.slice(0, 200) || '(silent)'}, stdout: ${out.slice(0, 150) || '(empty)'}`)
          })
        })
        if (!result.ok) return send(502, result.error || 'AI did not return anything')
        // A model sometimes answers the empty set with the string "null";
        // that is nothing, and nothing must not become an answer.
        if (/^null$/i.test(result.draft.trim())) return send(502, 'the model had nothing usable for this slot')
        return send(200, JSON.stringify({ draft: result.draft }), MIME['.json'])
      }
      if (req.method === 'POST' && url.pathname === '/api/answers') {
        let body = ''
        for await (const chunk of req) body += chunk
        if (body.length > 2_000_000) return send(413, 'too large')
        const payload = JSON.parse(body)
        mkdirSync(path.join(brandDir, 'data'), { recursive: true })
        // Merge per slot: a write that only carries some slots must not
        // erase the rest. The app always sends the full set; external tools
        // may not, and losing answers to a partial write is unacceptable.
        const existing = loadAnswers().answers ?? {}
        const incoming = payload.answers ?? {}
        const merged = { ...existing }
        for (const [id, slot] of Object.entries(incoming)) {
          const healed = JSON.parse(JSON.stringify(slot))
          if (typeof healed?.value === 'string' && /^\s*null\s*$/i.test(healed.value)) healed.value = null
          if (Array.isArray(healed?.value)) healed.value = healed.value.filter((x) => String(x).trim() && !/^\s*null\s*$/i.test(String(x)))
          if (Array.isArray(healed?.value) && healed.value.length === 0 && incoming[id]?.value?.length) healed.value = incoming[id].value
          merged[id] = healed
        }
        writeFileSync(answersPath, JSON.stringify({ savedAt: new Date().toISOString(), answers: merged }, null, 2))
        return send(200, JSON.stringify({ ok: true, savedAt: new Date().toISOString() }), MIME['.json'])
      }
      if (req.method === 'POST' && url.pathname === '/api/emit') {
        const result = spawnSync(process.execPath, [path.join(here, 'brand.mjs'), 'emit', '--project', project, '--dir', path.relative(project, brandDir)], { encoding: 'utf8' })
        return send(result.status === 0 ? 200 : 500, JSON.stringify({ ok: result.status === 0, out: result.stdout, err: result.stderr }), MIME['.json'])
      }
      if (req.method === 'GET' && url.pathname === '/api/contrast') {
        const cfg = loadConfig()
        const { answers: current = {} } = loadAnswers()
        return send(200, JSON.stringify({ pairs: contrastResults(cfg, (id) => current[id]?.value ?? null) }), MIME['.json'])
      }
      if (req.method === 'GET' && url.pathname === '/api/font-check') {
        const file = path.join(brandDir, 'data/font-check.json')
        if (!existsSync(file)) return send(200, JSON.stringify({ results: [] }), MIME['.json'])
        return send(200, readFileSync(file), MIME['.json'])
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/font/')) {
        // Browser pages on this port cannot fetch Eagle's server cross-origin
        // (it sends no CORS headers), so bytes are fetched here and served same-origin.
        const id = url.pathname.split('/').filter(Boolean).pop()
        const ext = url.searchParams.get('ext') ?? 'woff2'
        const template = process.env.EAGLE_MEDIA_URL || config?.sources?.mediaServer || 'http://127.0.0.1:41532/api/items/{id}/file'
        if (!template.includes('{id}')) return send(400, 'media server template needs {id}')
        try {
          const res = await fetch(template.replace('{id}', id), { signal: AbortSignal.timeout(15000) })
          if (!res.ok) return send(404, `media server ${res.status} for ${id}`)
          const type = res.headers.get('content-type') ?? ''
          if (type.startsWith('image/')) return send(404, 'not a font')
          const buffer = Buffer.from(await res.arrayBuffer())
          if (buffer.length < 64) return send(404, 'empty')
          const mime = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : 'font/ttf'
          return send(200, buffer, mime)
        } catch (error) {
          return send(502, `media server unreachable: ${error.message}`)
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/fonts') {
        const file = path.join(brandDir, 'data/fonts.json')
        if (!existsSync(file)) return send(200, JSON.stringify({ specimens: [] }), MIME['.json'])
        return send(200, readFileSync(file), MIME['.json'])
      }
      if (req.method === 'GET' && url.pathname.startsWith('/fonts/')) {
        const file = path.resolve(brandDir, url.pathname.replace(/^\/+/, ''))
        if (!file.startsWith(path.join(brandDir, 'fonts') + path.sep) || !existsSync(file)) return send(404, 'not found')
        return send(200, readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream')
      }
      if (req.method === 'GET' && url.pathname === '/brand.md') {
        const file = path.join(brandDir, 'brand.md')
        if (!existsSync(file)) return send(404, 'not generated yet')
        return send(200, readFileSync(file), 'text/markdown; charset=utf-8')
      }
      if (req.method === 'GET') {
        const file = path.resolve(appDir, url.pathname.replace(/^\/+/, ''))
        if (!file.startsWith(appDir + path.sep) || !existsSync(file)) return send(404, 'not found')
        return send(200, readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream')
      }
      send(404, 'not found')
    } catch (error) {
      send(500, String(error.message || error))
    }
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`brand interview → http://127.0.0.1:${port}`)
    console.log(`config  → ${rel(configPath)}`)
    console.log(`answers → ${rel(answersPath)}`)
    console.log(`output  → ${rel(path.join(brandDir, 'brand.md'))}`)
  })
}

/* ------------------------------------------------------------ scaffold --- */

function scaffold() {
  mkdirSync(path.join(brandDir, 'data'), { recursive: true })
  if (!existsSync(projectConfig)) {
    copyFileSync(toolConfig, projectConfig)
    console.log(`config → ${rel(projectConfig)} (edit to fit the project)`)
  } else {
    console.log(`config → ${rel(projectConfig)} (already exists)`)
  }
  const gitignore = path.join(brandDir, '.gitignore')
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, 'data/answers.json\n')
    console.log(`ignore → ${rel(gitignore)}`)
  }
  console.log(`
next:
  node probe.mjs brand serve --project ${rel(project)}
  # answer, then "Generate brand.md" — or:
  node probe.mjs brand emit --project ${rel(project)}`)
}

/* ------------------------------------------------------------------ main -- */

if (cmd === 'serve') serve()
else if (cmd === 'emit') emit({ dry: args.has('dry') })
else if (cmd === 'status') {
  const config = loadConfig()
  const { answers = {} } = loadAnswers()
  const rows = config.questions.map((q) => ({ q, status: effectiveStatus(answers[q.id]) }))
  const counts = rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {})
  console.log(`config ${config.id} · ${rows.length} questions`)
  console.log(`verified ${counts.verified ?? 0} · assumption ${counts.assumption ?? 0} · tbc ${counts.tbc ?? 0}`)
  console.log(existsSync(path.join(brandDir, 'brand.md')) ? `output → ${rel(path.join(brandDir, 'brand.md'))}` : 'output: not generated yet')
} else if (cmd === 'scaffold') scaffold()
else {
  console.error('usage: brand.mjs scaffold | serve | status | emit')
  process.exit(1)
}
