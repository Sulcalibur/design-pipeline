#!/usr/bin/env node
/**
 * probe/ask.mjs — one question at a time, with branches and a gate.
 *
 * A pack is a constant spine plus conditions. The engine shows the next visible
 * question, offers a recommendation with a reason, records the answer and its
 * source, and refuses to close the stage while a required question is unanswered.
 *
 *   node ask.mjs --project . --stage brand --next
 *   node ask.mjs --project . --stage brand --answer kind=person --status verified --source "owner"
 *   node ask.mjs --project . --stage brand --tbc a4
 *   node ask.mjs --project . --stage brand --check
 *   node ask.mjs --project . --stage brand --list
 *
 * State lives in <docDir>/interview.json. The answers are a working record, not
 * the brand record: `probe brand emit` still writes brand.json from answers.json.
 */
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import { resolveContext, loadBrand, slotValue, readJson, writeDoc } from './checks.mjs'

const here = import.meta.dirname
const args = parseArgs(process.argv.slice(2))
const stage = args.get('stage', 'brand')

// Brief and direction are design-scoped. With several design folders and no
// --config/--slug, resolveContext falls back to <project>/docs, which silently
// puts the interview state in the wrong place. Refuse instead.
if (stage !== 'brand' && !args.get('config') && !args.get('slug') && !args.get('out')) {
  const project = path.resolve(process.cwd(), args.get('project', '.'))
  const designRoot = path.join(project, 'docs', 'design')
  let dirs = []
  try {
    dirs = readdirSync(designRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_') && !entry.name.startsWith('audit-'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    dirs = []
  }
  if (dirs.length > 1) {
    fail(`several design folders under ${path.relative(process.cwd(), designRoot) || designRoot}:\n  ${dirs.join('\n  ')}\n  Pass --config <probe.config.json> or --slug <slug>.`)
  }
}

const ctx = resolveContext(args)
const packPath = path.join(here, 'packs', `${stage}.json`)
if (!existsSync(packPath)) fail(`no question pack for "${stage}" at ${packPath}`)

const pack = JSON.parse(readFileSync(packPath, 'utf8'))
const include = pack.include ? JSON.parse(readFileSync(path.resolve(path.dirname(packPath), pack.include), 'utf8')) : { questions: [] }
const base = include.questions ?? []
const context = pack.context ?? []
const overrides = pack.askIf ?? {}
const questions = [...context, ...base].map((q) => ({ ...q, askIf: overrides[q.id] ?? q.askIf ?? null }))

const statePath = args.get('state')
  ? path.resolve(process.cwd(), args.get('state'))
  : path.join(ctx.docDir, 'interview.json')

// One state file, one section per stage: the brief can branch on brand.kind.
let all = readJson(statePath, { stages: {} }) ?? { stages: {} }
if (all.stage && all.answers) {
  // migrate the first single-stage shape
  all = { stages: { [all.stage]: { answers: all.answers, updatedAt: all.updatedAt } } }
}
all.stages ??= {}
const state = (all.stages[stage] ??= { answers: {}, updatedAt: null })
state.answers ??= {}

const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null)

function section(md, title) {
  if (!md) return null
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const lines = md.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${esc}\\s*$`, 'i').test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim() || null
}

function checkboxes(md) {
  if (!md) return []
  const out = []
  let current = null
  for (const line of md.split('\n')) {
    const m = /^- \[[ x]\]\s+(.*)$/.exec(line)
    if (m) {
      if (current) out.push(current)
      current = m[1].trim()
      continue
    }
    if (current && /^\s{2,}\S/.test(line)) current += ' ' + line.trim()
    else if (current && line.trim() !== '') {
      out.push(current)
      current = null
    }
  }
  if (current) out.push(current)
  return out
}

function bullets(md) {
  return (md?.match(/^-\s+(.+)$/gm) ?? []).map((line) => line.replace(/^-\s+/, '').trim())
}

function displayValue(value) {
  if (value == null) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const brand = loadBrand(ctx.project)?.data ?? null
// Seed the working record from the brand record, without overwriting an answer
// the interview already changed.
for (const q of questions) {
  if (state.answers[q.id]) continue
  const slot = brand?.slots?.[q.id]
  if (slot && slot.value != null) {
    state.answers[q.id] = { value: slot.value, status: slot.status ?? 'assumption', source: slot.source ?? 'brand.json', prefilled: true }
  }
}

// Pack-declared prefill: read an existing document section instead of asking.
for (const p of pack.prefill ?? []) {
  if (state.answers[p.id]) continue
  const file = path.resolve(ctx.docDir, p.file)
  const md = readIf(file)
  if (!md) continue
  const body = section(md, p.section)
  const value = p.type === 'checkboxes' ? checkboxes(body) : p.type === 'bullets' ? bullets(body) : body
  if (value && (Array.isArray(value) ? value.length : String(value).trim())) {
    state.answers[p.id] = { value, status: 'verified', source: `${p.file} — ${p.section}`, prefilled: true }
  }
}

function answerFor(key, answers = state.answers) {
  if (key.includes('.')) {
    const [otherStage, id] = key.split('.')
    return all.stages[otherStage]?.answers?.[id]?.value
  }
  return answers[key]?.value
}

function visible(q, answers = state.answers) {
  for (const [key, allowed] of Object.entries(q.askIf ?? {})) {
    const answer = answerFor(key, answers)
    if (answer == null) return false
    const values = Array.isArray(answer) ? answer.map(String) : [String(answer)]
    if (!values.some((v) => allowed.map(String).includes(v))) return false
  }
  return true
}

/* --------------------------------------------------------- recommendation -- */

function projectText() {
  const files = ['package.json', 'nuxt.config.ts', 'README.md', 'docs/brand/brand.md']
  return files
    .filter((f) => existsSync(path.join(ctx.project, f)))
    .map((f) => readFileSync(path.join(ctx.project, f), 'utf8'))
    .join('\n')
}

function detectKind() {
  const product = String(slotValue(brand, 'product') ?? '')
  const who = String(slotValue(brand, 'a2') ?? '')
  const oneLine = String(slotValue(brand, 'oneLine') ?? '')
  const text = `${who} ${product} ${oneLine}`
  if (/\b(council|department|ministry|authority|nhs)\b/i.test(product)) return { value: 'public', why: 'the product name reads as a public body' }
  if (/\b(ltd|limited|llc|studio|agency|consultancy|partners)\b/i.test(product)) return { value: 'company', why: 'the product name reads as a company' }
  if (/public[-\s]sector|government|council|nhs|dwp|department/i.test(text)) return { value: 'person', why: 'the record describes one person working in the public sector' }
  return { value: 'person', why: 'no company or public-body signal in the record' }
}

function detectSector() {
  const text = ['product', 'oneLine', 'a2', 'b1'].map((id) => String(slotValue(brand, id) ?? '')).join(' ')
  if (/public[-\s]sector|government|council|nhs|dwp|department|ministry/i.test(text)) return { value: 'public', why: 'the record names a public-sector context' }
  if (/financial|health|legal|education|safeguarding|fca|ofsted|gdpr/i.test(text)) return { value: 'regulated', why: 'the record names a regulated field' }
  return { value: 'neither', why: 'no regulated or public-sector signal' }
}

function detectIdentity() {
  const marks = ['v1', 'v2-paper', 'v2-ink', 'v2-accent', 'v3-display', 'v3-body', 'v3-ui'].filter((id) => slotValue(brand, id))
  if (marks.length >= 5) return { value: 'yes', why: 'the record already carries a mark, palette and type roles' }
  if (marks.length) return { value: 'partial', why: 'some identity slots are filled, not all' }
  return { value: 'no', why: 'no mark, palette or type in the record' }
}

function detectCms() {
  const text = projectText()
  if (/directus|contentful|sanity|strapi|payload|wordpress|ghost/i.test(text)) return { value: 'yes', why: 'the project names a CMS' }
  if (/\bcms\b|content model|content-model/i.test(text)) return { value: 'planned', why: 'a content model is mentioned but no CMS is installed' }
  return { value: 'no', why: 'no CMS signal in the project' }
}

function detectContent() {
  const text = projectText()
  if (/directus|contentful|sanity|strapi|payload|wordpress|ghost/i.test(text) || existsSync(path.join(ctx.project, 'shared/seed.ts'))) {
    return { value: 'exists', why: 'the project already holds content in a CMS or seed file' }
  }
  if (existsSync(path.join(ctx.docDir, '00-brief.md'))) return { value: 'partial', why: 'a brief exists; the page copy may not' }
  return { value: 'none', why: 'no content signal in the project' }
}

function recommendationFor(id) {
  if (id === 'kind') return detectKind()
  if (id === 'sector') return detectSector()
  if (id === 'identity') return detectIdentity()
  if (id === 'cms') return detectCms()
  if (id === 'job') return slotValue(brand, 'b1') ? { value: slotValue(brand, 'b1'), why: 'the brand promise states the job' } : null
  if (id === 'reader') return slotValue(brand, 'a2') ? { value: slotValue(brand, 'a2'), why: 'the brand audience is the reader' } : null
  if (id === 'content') return detectContent()
  if (id === 'mockPolicy') return { value: 'yes', why: 'marked mock keeps layout moving without shipping placeholders' }
  if (id === 'language') return { value: 'en-GB', why: 'the site declares en-GB' }
  if (id === 'stakeholders') {
    const kind = answerFor('brand.kind')
    return kind === 'company' || kind === 'public'
      ? { value: 'the owner and one approver', why: 'a company or public body needs one named decider' }
      : null
  }
  if (id === 'referenceBasis') {
    const has = [path.join(ctx.docDir, 'references/manifest.json'), path.join(ctx.project, 'references/manifest.json')].some(existsSync)
    return has
      ? { value: 'yes', why: 'a capture manifest with device/avoid notes exists' }
      : { value: 'no', why: 'no references/manifest.json; Eagle alone is not a captured pack' }
  }
  if (id === 'colourField') {
    const accent = String(slotValue(brand, 'v2-accent') ?? '')
    if (/band|field/i.test(accent)) return { value: 'field on evidence', why: 'the accent slot says the band carries the field' }
    return null
  }
  if (id === 'typeContrast') {
    const display = String(slotValue(brand, 'v3-display') ?? '')
    const body = String(slotValue(brand, 'v3-body') ?? '')
    return display && body ? { value: `${display} display / ${body} body`, why: 'the brand record names both roles' } : null
  }
  if (id === 'motion') {
    return { value: '200–250ms, one curve, reduced-motion neutralises all', why: 'the motion budget is one curve and one duration band' }
  }
  if (id === 'opening' || id === 'spine') {
    const direction = readIf(path.join(ctx.docDir, '02-direction.md')) ?? ''
    if (id === 'spine') {
      if (/contents/i.test(direction)) return { value: 'contents page', why: 'the direction already describes a contents spine' }
      if (/ledger/i.test(direction)) return { value: 'ledger', why: 'the direction is built on a ledger' }
      if (/index/i.test(direction)) return { value: 'index first', why: 'the direction opens on an index' }
      return null
    }
    if (/statement/i.test(direction)) return { value: 'statement first', why: 'the direction opens on a statement' }
    if (/index/i.test(direction)) return { value: 'index first', why: 'the direction opens on an index' }
    return null
  }
  return null
}

/* --------------------------------------------------------------- commands -- */

function save() {
  state.updatedAt = new Date().toISOString()
  all.stages[stage] = state
  writeFileSync(statePath, JSON.stringify(all, null, 2) + '\n')
}

function nextQuestion() {
  const vis = questions.filter((q) => visible(q))
  return vis.find((q) => q.required && !state.answers[q.id]) ?? vis.find((q) => !state.answers[q.id])
}

function optionLabel(q) {
  return (q.options ?? [])
    .map((o) => (typeof o === 'string' ? o : o.value ?? o.id ?? o.label))
    .filter(Boolean)
    .join(' · ')
}

function printNext(q) {
  if (!q) {
    console.log('\nNo visible unanswered questions.\n')
    console.log(`check the gate: probe ask --stage ${stage} --check`)
    return
  }
  console.log(`\nNext: ${q.id}  ·  ${q.section ?? 'general'}${q.required ? '  ·  required' : ''}`)
  console.log(`\n${q.question}`)
  if (q.help) console.log(`\n${q.help}`)
  if (q.why) console.log(`\nWhy it matters: ${q.why}`)
  if (q.options) console.log(`\nOptions: ${optionLabel(q)}`)
  if (q.type === 'list') console.log('\nList answer: comma- or semicolon-separated.')
  const rec = q.recommend ?? recommendationFor(q.id)
  if (rec?.value) console.log(`\nSuggested: ${rec.value}${rec.why ? ` — ${rec.why}` : ''}`)
  const example = q.type === 'list' ? `${q.id}="<item one>, <item two>"` : `${q.id}=<value>`
  console.log(`\nAnswer:\n  probe ask --stage ${stage} --answer ${example} --status verified --source "<where this came from>"`)
  console.log(`  probe ask --stage ${stage} --tbc ${q.id}    (only when not knowing is the honest answer)\n`)
}

function list() {
  const rows = questions.map((q) => {
    const a = state.answers[q.id]
    const vis = visible(q)
    return {
      id: q.id,
      section: q.section ?? '',
      required: q.required ? 'yes' : '',
      visible: vis ? 'yes' : 'hidden',
      status: a?.status ?? (a ? 'answered' : ''),
      value: displayValue(a?.value),
    }
  })
  if (args.has('json')) {
    console.log(JSON.stringify({ stage, state: statePath, questions: rows }, null, 2))
    return
  }
  console.log(`\n${pack.title ?? stage} — ${rows.filter((r) => r.visible === 'yes').length} visible of ${rows.length}\n`)
  for (const r of rows) {
    if (r.visible === 'hidden') console.log(`  · ${r.id.padEnd(14)} hidden by a branch`)
    else console.log(`  ${r.status === 'tbc' ? '!' : r.value ? '✓' : '·'} ${r.id.padEnd(14)} ${r.section.padEnd(10)} ${r.required ? 'req ' : '    '} ${r.status.padEnd(10)} ${r.value.slice(0, 70)}`)
  }
  console.log('')
}

function check() {
  const vis = questions.filter((q) => visible(q))
  const blocking = []
  const warnings = []
  for (const q of vis) {
    const a = state.answers[q.id]
    if (!a) {
      if (q.required) blocking.push({ id: q.id, why: 'required, unanswered' })
      continue
    }
    if (q.type === 'list' && Array.isArray(a.value) && a.value.length < (q.min ?? 1)) {
      blocking.push({ id: q.id, why: `needs at least ${q.min ?? 1} item(s)` })
    }
    if (a.status === 'tbc') {
      if (q.gate === 'blocking') blocking.push({ id: q.id, why: 'blocking question left TBC' })
      else warnings.push({ id: q.id, why: 'TBC' })
    }
    if (a.status === 'assumption' && q.required) warnings.push({ id: q.id, why: 'required, assumed' })
  }

  if (args.has('json')) {
    console.log(JSON.stringify({ stage, state: statePath, blocking, warnings, visible: vis.length, answered: vis.filter((q) => state.answers[q.id]).length }, null, 2))
  } else {
    console.log(`\n${pack.title ?? stage} — gate\n`)
    console.log(`  visible ${vis.length} · answered ${vis.filter((q) => state.answers[q.id]).length}`)
    if (blocking.length) {
      console.log('\n  blocking')
      for (const b of blocking) console.log(`    ✗ ${b.id.padEnd(14)} ${b.why}`)
    }
    if (warnings.length) {
      console.log('\n  recorded, not blocking')
      for (const w of warnings) console.log(`    ! ${w.id.padEnd(14)} ${w.why}`)
    }
    if (!blocking.length) console.log('\n  ✓ clear — no required question is unanswered')
    console.log(`\n  state: ${rel(statePath)}\n`)
  }

  if (args.has('write')) {
    const lines = [
      `# ${pack.title ?? `${stage} interview`}`,
      '',
      `> ${new Date().toISOString().slice(0, 10)} · ${vis.length} visible questions · ${blocking.length} blocking`,
      '',
      '| Question | Status | Answer | Source |',
      '|---|---|---|---|',
      ...vis.map((q) => {
        const a = state.answers[q.id]
        const value = displayValue(a?.value)
        return `| ${q.id} | ${a?.status ?? 'unanswered'} | ${value.replace(/\|/g, '\\|').slice(0, 120)} | ${a?.source ?? '—'} |`
      }),
      '',
    ]
    const file = writeDoc(ctx.docDir, `interview-${stage}.md`, lines.join('\n'))
    console.log(`→ ${rel(file)}`)
  }
  process.exit(blocking.length ? 1 : 0)
}

/* ------------------------------------------------------------------- main -- */

if (args.has('reset')) {
  rmSync(statePath, { force: true })
  console.log(`reset ${rel(statePath)}`)
  process.exit(0)
}

if (args.get('answer')) {
  const raw = args.get('answer')
  const at = raw.indexOf('=')
  if (at < 0) fail('--answer needs id=value')
  const id = raw.slice(0, at)
  const q = questions.find((x) => x.id === id)
  if (!q) fail(`no question "${id}" in the ${stage} pack`)
  const valueRaw = raw.slice(at + 1)
  if (!valueRaw) fail('--answer needs a value after "="')
  const value = q.type === 'list' ? valueRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : valueRaw
  state.answers[id] = {
    value,
    status: args.get('status', 'assumption'),
    source: args.get('source', 'owner'),
    at: new Date().toISOString(),
  }
  save()
  console.log(`recorded ${id} = ${Array.isArray(value) ? value.join(', ') : value} (${state.answers[id].status})`)
  if (!args.has('json')) {
    const n = nextQuestion()
    if (n) printNext(n)
    else console.log(`\nNo visible unanswered questions. Check: probe ask --stage ${stage} --check`)
  }
  process.exit(0)
}

if (args.get('tbc')) {
  const id = args.get('tbc')
  const q = questions.find((x) => x.id === id)
  if (!q) fail(`no question "${id}" in the ${stage} pack`)
  state.answers[id] = { value: null, status: 'tbc', source: args.get('source', 'owner'), at: new Date().toISOString() }
  save()
  console.log(`recorded ${id} = TBC`)
  const n = nextQuestion()
  if (n) printNext(n)
  process.exit(0)
}

if (args.has('list')) {
  list()
  process.exit(0)
}

if (args.has('check')) {
  check()
  process.exit(0)
}

printNext(nextQuestion())
