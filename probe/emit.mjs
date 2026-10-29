#!/usr/bin/env node
/**
 * probe/emit.mjs — turn an adaptive probe run into a design spec.
 *
 * Reads the latest saved run (or --run <id>), writes:
 *   <out>/05-decision.md    human decision readback + build rules
 *   <out>/build-spec.json    machine brief for agents
 *   <out>/02-direction.md   marked "Probe result" block
 *
 * A run may be partial: "I've seen enough" is a valid ending. Unprobed axes are
 * reported as unprobed, never filled in.
 *
 *   node emit.mjs [--answers data/answers.json] [--run <id>] [--out <dir>] [--dry] [--no-touch]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { resolvePaths, loadConfig, fail, rel } from './paths.mjs'
import { loadBrandRecord, brandBlock } from './brand-link.mjs'
import { writeDesignIndex } from './design-index.mjs'

const paths = resolvePaths(process.argv.slice(2))
const args = paths.args
const outDir = paths.out
const answersPath = path.resolve(paths.root, args.get('answers', paths.answers))
const wantRun = args.get('run', null)
const dry = args.has('dry')
const touchDirection = !args.has('no-touch')

if (!existsSync(answersPath)) {
  console.error(`✗ no answers at ${answersPath}`)
  console.error('  Run the probe first: node probe.mjs serve')
  process.exit(1)
}

const history = JSON.parse(readFileSync(answersPath, 'utf8'))
const runs = Array.isArray(history) ? history : [history]
const run = wantRun ? runs.find((r) => r.runId === wantRun) : runs[runs.length - 1]
if (!run) {
  console.error(`✗ run not found: ${wantRun}`)
  process.exit(1)
}

if (!existsSync(paths.runtime)) fail(`runtime config missing: ${paths.runtime} — run probe.mjs build`)
const probe = loadConfig(paths.runtime)
const config = loadConfig(paths.config)
const brandRecord = loadBrandRecord(paths.root, { readFile: readFileSync })
const brand = brandBlock(brandRecord?.data ?? null)
const semantics = config.semantics ?? {}
const output = config.output ?? {}

/* --------------------------------------------------------------- guards --- */

// The token file is optional: a project may have none, or keep its system elsewhere.
const tokens = (() => {
  const file = config.system?.tokensFile
  if (!file) return null
  const p = path.resolve(paths.root, file)
  if (!existsSync(p)) return null
  const json = JSON.parse(readFileSync(p, 'utf8'))
  const ns = config.system?.tokensNamespace
  return ns ? (json[ns] ?? json) : json
})()

const flatTokens = (() => {
  const out = new Set()
  if (!tokens) return out
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('$')) continue
      if (v && typeof v === 'object' && !Array.isArray(v) && !('$value' in v)) walk(v, `${prefix}${k}.`)
      else out.add(`${prefix}${k}`)
    }
  }
  walk(tokens, '')
  return out
})()

const TOKEN_REFS = config.system?.tokenRefs ?? []
const missingTokens = tokens ? TOKEN_REFS.filter((t) => !flatTokens.has(t)) : []
if (missingTokens.length) {
  console.error(`✗ token references no longer exist in ${config.system.tokensFile}: ${missingTokens.join(', ')}`)
  process.exit(1)
}

/* ------------------------------------------------------------ derive spec -- */

const answers = run.answers ?? {}
const intakeMatches = (when) =>
  Object.entries(when ?? {}).every(([k, vals]) => {
    const a = answers[k]
    if (!a) return false
    const ids = Array.isArray(a.value) ? a.value : [a.value]
    return ids.some((x) => vals.includes(x))
  })
const pairNodes = probe.pairs.filter((p) => p.mode !== 'confirm' && !(run.sampleMode ?? {})[p.id])
const confirmNodes = probe.pairs.filter((p) => p.mode === 'confirm')
const optionById = (pair, id) => pair.options.find((o) => o.id === id)

// Project vocabulary: how a constraint value reads in prose. A project with no
// vocabulary gets the raw value, hyphenated words turned into spaces.
const VALUE_LABEL = semantics.vocabulary ?? {}
const human = (k, v) => (Array.isArray(v) ? v.map((x) => VALUE_LABEL[k]?.[x] ?? x).join(' + ') : VALUE_LABEL[k]?.[v] ?? String(v).replace(/-/g, ' '))
// `{intensity}` in authored prose resolves to the run's intensity name.
const fill = (s) => String(s ?? '').replace(/\{intensity\}/g, intensity.name)

function effectiveOption(pair, a) {
  let o = optionById(pair, a.optionId)
  for (const k of Object.keys(o?.constraints ?? {})) {
    const r = run.resolved?.[k]
    if (r !== undefined && r !== o.constraints[k]) {
      const alt = pair.options.find((x) => x.constraints?.[k] === r)
      if (alt) o = alt
    }
  }
  return o
}

const choices = []
const seenAxes = new Set()
for (const pair of pairNodes) {
  const axisKey = pair.axisKey ?? pair.id
  if (seenAxes.has(axisKey)) continue
  seenAxes.add(axisKey)
  const answered = pairNodes.find((p) => (p.axisKey ?? p.id) === axisKey && answers[p.id])
  const chosenPair = answered ?? pair
  const a = answers[chosenPair.id]
  choices.push({ pair: chosenPair, answer: a ?? null, option: a && a.side !== 'neither' ? effectiveOption(chosenPair, a) : null })
}

const constraints = run.constraints ? { ...run.constraints } : {}
for (const [k, v] of Object.entries(constraints)) {
  if (Array.isArray(v) && v.length === 1) constraints[k] = v[0]
}

const intakeRows = probe.intake.map((q) => {
  const a = answers[q.id]
  const ids = a ? (Array.isArray(a.value) ? a.value : [a.value]) : []
  const labels = ids.filter(Boolean).map((id) => q.options.find((o) => o.id === id)?.label ?? id)
  const rec = Array.isArray(q.recommend) ? q.recommend : q.recommend ? [q.recommend] : []
  const followed = rec.length > 0 && rec.length === ids.length && rec.every((x) => ids.includes(x))
  return { question: q.question, labels, answered: labels.length > 0, recommended: rec, followed, why: q.recommendWhy ?? null }
})

const detailRows = probe.followups.map((q) => {
  const a = answers[q.id]
  const ids = a ? (Array.isArray(a.value) ? a.value : [a.value]) : []
  const labels = ids.filter(Boolean).map((id) => q.options.find((o) => o.id === id)?.label ?? id)
  return { label: q.label ?? 'Detail', question: q.question, labels, answered: labels.length > 0 }
})

// Measured profiles, when `analyze` has run. Evidence for the builder, never a
// substitute for the authored judgement in the direction document.
const analysis = (() => {
  const file = path.join(paths.data, 'analysis.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')).images ?? null
  } catch {
    return null
  }
})()

const sources = choices
  .filter((c) => c.option)
  .map((c) => {
    const m = analysis?.[c.option.id]?.measured
    return {
      axis: c.pair.axis,
      source: c.option.source,
      url: c.option.url,
      borrow: c.option.note,
      label: c.option.label,
      profile: m
        ? {
            palette: m.palette,
            whitespace: m.whitespace,
            density: m.visualDensity,
            bands: m.bands,
            columns: m.columns,
            alignment: m.alignment,
            contrast: m.contrast,
            temperature: m.temperature,
          }
        : null,
    }
  })

const avoided = run.avoided?.length
  ? run.avoided.filter((a) => a && !String(a).startsWith('undefined'))
  : choices
      .filter((c) => c.option)
      .map((c) => c.pair.options.find((o) => o.id !== c.answer.optionId)?.avoid)
      .filter(Boolean)

const unanswered = run.unanswered ?? {
  pairs: pairNodes.filter((p) => !answers[p.id]).map((p) => p.id),
  followups: probe.followups.filter((q) => !answers[q.id]).map((q) => q.id),
}

const PRESET_VALUES = {
  restrained: { motionMs: 200, motionPx: 8, rulePx: 1, imageScale: 1, ornament: 'none' },
  expressive: { motionMs: 520, motionPx: 24, rulePx: 2, imageScale: 1.03, ornament: 'margin-note' },
}
const intensity = {
  name: run.intensity?.name ?? 'restrained',
  ...PRESET_VALUES[run.intensity?.name ?? 'restrained'],
}

const baseline = probe.baseline ?? null
const baselineApplies = Boolean(baseline && (!baseline.when || intakeMatches(baseline.when)))
const expected = baselineApplies ? baseline.constraints ?? {} : {}

// A conflict note is a written argument, so it belongs to the project. The
// generic fallback names both values rather than pretending to argue.
const CONFLICT_NOTE = semantics.conflictNotes ?? {}

const conflicts = []
for (const [key, value] of Object.entries(expected)) {
  const chosen = constraints[key]
  if (chosen && !Array.isArray(chosen) && chosen !== value) {
    conflicts.push({
      axis: key,
      baseline: value,
      chosen,
      note:
        (baseline.direction === 'A — Kept book' ? CONFLICT_NOTE[`${key}:${chosen}`] : null) ??
        `The baseline says ${value}; the probe chose ${chosen}.`,
    })
  }
}
if (baselineApplies && baseline.intensity && intensity.name !== baseline.intensity) {
  conflicts.push({
    axis: 'motion',
    baseline: baseline.intensity,
    chosen: intensity.name,
    note: `The committed direction uses ${baseline.intensity}; the probe chose ${intensity.name}.`,
  })
}

const IMPLICATIONS = semantics.implications ?? {}
const DETAIL_RULES = semantics.details ?? {}

// A constraint's own vocabulary is the fallback build rule: a project that has
// not written implications still gets a sentence the builder can act on.
const vocabByConstraint = {}
for (const pair of probe.pairs ?? []) {
  for (const option of pair.options ?? []) {
    for (const [key, value] of Object.entries(option.constraints ?? {})) {
      vocabByConstraint[`${key}:${value}`] = option.vocab
    }
  }
}

// A project that has authored implications is authoritative: no fallback rules
// are invented on top of them. A project with no semantics gets a usable
// sentence from the chosen option's own vocabulary.
const authoredRules = Object.keys(IMPLICATIONS).length > 0 || Object.keys(DETAIL_RULES).length > 0
const buildRules = []
for (const [key, value] of Object.entries(constraints)) {
  const vals = Array.isArray(value) ? value : [value]
  for (const v of vals) {
    const rule =
      IMPLICATIONS[key]?.[v] ??
      DETAIL_RULES[key]?.[v] ??
      (authoredRules ? undefined : vocabByConstraint[`${key}:${v}`])
    if (rule) buildRules.push({ key, value: v, rule })
  }
}

// Asset effects are rules, not a list: first matching rule per id wins. The
// project authors them because they name real slots and real content.
const assetMatches = (rule) =>
  Object.entries(rule.when ?? {}).every(([key, allowed]) => {
    const chosen = constraints[key]
    const values = Array.isArray(chosen) ? chosen : [chosen]
    const ok = Array.isArray(allowed) ? allowed : [allowed]
    return values.some((v) => ok.includes(v))
  })
const seenAssets = new Set()
const assets = []
for (const rule of semantics.assets ?? []) {
  if (seenAssets.has(rule.id)) continue
  if (!assetMatches(rule)) continue
  seenAssets.add(rule.id)
  assets.push({ id: rule.id, effect: fill(rule.effect) })
}

const pendingTokens = (semantics.pendingTokens ?? []).map((t) => ({
  name: t.name,
  value: t.valueFrom
    ? `${intensity[t.valueFrom.intensity] ?? ''}${t.valueFrom.suffix ?? ''}`
    : t.value,
  why: fill(t.why ?? ''),
}))

const genericQuestions = [
  'Micro-details (buttons, nav, hover) were not probed; they need live captures with coordinates.',
  'Captures are historical. Verify a live source before borrowing a detail.',
  'The probe reads preference, not performance. Verify the built page with a screenshot and a real reader.',
]
const openQuestions = [...(semantics.openQuestions ?? []), ...genericQuestions]
if (unanswered.pairs.length) {
  openQuestions.unshift(`Not probed: ${unanswered.pairs.map((id) => probe.pairs.find((p) => p.id === id)?.axis ?? id).join(', ')}. Do not invent a constraint for them.`)
}

const partial = unanswered.pairs.length > 0
const status = conflicts.length ? 'needs-decision' : partial ? 'partial' : 'confirmed'

const refQ = probe.intake.find((q) => q.id === 'reference')
const refId = answers.reference?.value
const reference = refQ && refId ? { id: refId, label: refQ.options.find((o) => o.id === refId)?.label, note: refQ.options.find((o) => o.id === refId)?.note } : null
const appQ = probe.intake.find((q) => q.id === 'application')
const appIds = answers.application?.value ? (Array.isArray(answers.application.value) ? answers.application.value : [answers.application.value]) : []
const applications = appIds.map((id) => appQ?.options.find((o) => o.id === id)?.label).filter(Boolean)

const CROSS_MEDIA = semantics.crossMedia ?? {}
const extrapolation = []
for (const [key, value] of Object.entries(constraints)) {
  const vals = Array.isArray(value) ? value : [value]
  for (const v of vals) {
    const rule = CROSS_MEDIA[key]?.[v]
    if (rule) extrapolation.push({ key, value: v, rule })
  }
}
for (const v of Array.isArray(constraints.never) ? constraints.never : constraints.never ? [constraints.never] : []) {
  if (v !== 'none') extrapolation.push({ key: 'never', value: v, rule: `Never: ${String(v).replace(/-/g, ' ')}.` })
}

const spec = {
  generatedAt: new Date().toISOString(),
  runId: run.runId,
  probe: probe.id,
  direction: baselineApplies ? baseline.direction : 'No committed direction',
  reference,
  applications,
  extrapolation,
  status,
  partial,
  intake: Object.fromEntries(intakeRows.map((r) => [r.question, r.labels])),
  facts: (probe.facts ?? []).filter((f) => !f.when || intakeMatches(f.when)),
  recommendations: intakeRows.map((r) => ({ question: r.question, answer: r.labels, recommended: r.recommended, followed: r.followed, why: r.why })),
  constraints,
  intensity,
  buildRules,
  assets,
  avoided,
  sources,
  confirmations: run.confirmations ?? {},
  consistency: Object.entries(run.confirmations ?? {})
    .filter(([, c]) => c)
    .map(([axis, c]) => {
      const key = c.key ?? Object.keys(probe.pairs.find((p) => p.mode === 'confirm' && p.axis === axis)?.options[0]?.constraints ?? {})[0]
      return { axis, key, consistent: c.consistent, first: c.first ?? null, second: c.second ?? null, resolved: key ? run.resolved?.[key] ?? null : null }
    }),
  tensions: run.tensionLog ?? [],
  conflicts,
  unanswered,
  brand,

  openQuestions,
  tokenRefs: TOKEN_REFS,
}

/* ------------------------------------------------------------ markdown ---- */

const fmt = (d) => new Date(d).toISOString().slice(0, 10)

const choiceRows = choices
  .map((c) => {
    if (!c.answer) return `| ${c.pair.axis} | not probed | — | — |`
    if (c.answer.side === 'neither') {
      return `| ${c.pair.axis} | neither | No preference${c.answer.reason ? ` — “${c.answer.reason}”` : ''} | — |`
    }
    const constraint = Object.entries(c.option.constraints ?? {})
      .map(([k, v]) => `\`${k}: ${human(k, v)}\``)
      .join(' · ')
    return `| ${c.pair.axis} | ${c.option.label} | ${c.option.vocab} | ${constraint} |`
  })
  .join('\n')

const intakeTable = intakeRows
  .filter((r) => r.answered)
  .map((r) => `| ${r.question} | ${r.labels.join(' · ')} | ${r.recommended.length ? (r.followed ? 'followed' : 'overridden') : '—'} |`)
  .join('\n')

const detailTable = detailRows
  .filter((r) => r.answered)
  .map((r) => `| ${r.label} | ${r.labels.join(' · ')} |`)
  .join('\n')

const consistency = Object.entries(run.confirmations ?? {})
  .filter(([, c]) => c)
  .map(([axis, c]) => {
    const key = c.key ?? Object.keys(probe.pairs.find((p) => p.mode === 'confirm' && p.axis === axis)?.options[0]?.constraints ?? {})[0]
    if (c.consistent) return `- **${axis}:** same answer on both pairs${key && c.first ? ` (${human(key, c.first)})` : ''}.`
    return `- **${axis}:** ${c.first ? human(key, c.first) : 'one answer'} on the first pair, ${c.second ? human(key, c.second) : 'the other'} on the second${key && run.resolved?.[key] ? ` → resolved to **${human(key, run.resolved[key])}**` : ' (unresolved)'}.`
  })
  .join('\n')

const tensions = (run.tensionLog ?? [])
  .map((t) => `- **${t.key}:** ${t.a.label} (${t.a.source}) vs ${t.b.label} (${t.b.source}) → **${human(t.key, t.winner)}** wins.`)
  .join('\n')

const readbackTitle = output.readbackTitle ?? `Probe result — ${probe.ui?.title ?? probe.id ?? 'reference probe'}`
const systemNote = output.systemNote ?? 'This file is the **direction layer** for this page.'
const DEFAULT_BRIEF = [
  'Build the structure, not the references. Borrow principles; never copy a layout wholesale.',
  'Every content image has alt text and a stated source; no layout shift on swap.',
  'Do not add motion beyond the intensity values above; gate it behind `prefers-reduced-motion`.',
  'Use the existing tokens. If a parameter is missing, add it to the token source and its runtime mirror together.',
  'Before claiming done: run the project’s own checks, render at 1440 and 390, and record what passed.',
]
const agentBrief = output.agentBrief ?? DEFAULT_BRIEF
const doNot = output.doNot ?? ['a carousel', 'three equal cards', 'scroll-triggered reveals', 'glassmorphism', 'fake metrics', 'lorem ipsum']
const listProse = (items) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`
const brandSection = (() => {
  // The heading appears only when a brand record exists, and it is never filled
  // with content derived from anything other than that record.
  if (!brand) return ''
  const parts = []
  if (brand.promise) parts.push(`**Promise:** ${brand.promise}\n`)
  if (brand.enemy) parts.push(`**Against:** ${brand.enemy}\n\n`)
  if (brand.bannedWords.length) {
    parts.push('**Banned words** — never used in copy, headings or labels:\n')
    parts.push(brand.bannedWords.map((w) => `- ${w}`).join('\n') + '\n\n')
  }
  if (brand.forbidden.length) {
    parts.push('**Forbidden** — the build must not include these:\n')
    parts.push(brand.forbidden.map((w) => `- ${w}`).join('\n') + '\n\n')
  }
  const dials = Object.entries(brand.dials ?? {}).filter(([, d]) => d.current != null || d.target != null)
  if (dials.length) {
    parts.push(
      [
        '| Dial | Current (brand) | Target (brand) |',
        '|---|---|---|',
        ...dials.map(([id, d]) => `| ${d.label} | ${d.current ?? '—'} | ${d.target ?? '—'} |`),
      ].join('\n') + '\n\n',
    )
  }
  parts.push(`_Source: ${(brandRecord?.file ?? '').replace(/^.*docs\//, 'docs/')} — edit the brand, not this list._\n\n`)
  return `## Brand constraints\n\n${parts.join('')}`
})()

const md = `# ${readbackTitle}

> Generated by the reference probe (\`emit.mjs\`) from run \`${run.runId}\` on ${fmt(run.completedAt ?? run.startedAt)}.
> Do not edit by hand: re-run the probe and the emitter.

**Reference point:** ${reference ? `${reference.label} — ${reference.note}` : 'not chosen'}

**Status:** ${
  status === 'confirmed'
    ? 'confirmed against the direction contract'
    : status === 'partial'
      ? `partial — ${unanswered.pairs.length} reference axis/axes not probed`
      : `${conflicts.length} conflict(s) with the direction contract — resolve before building${partial ? `; ${unanswered.pairs.length} axis/axes not probed` : ''}`
}.

${systemNote}

## What I already knew

${(probe.facts ?? [])
  .filter((f) => !f.when || intakeMatches(f.when))
  .map((f) => `- ${f.text} — *${f.source}*`)
  .join('\n') || 'Nothing looked up.'}

## What you told me

| Question | Answer | Recommendation |
|---|---|---|
${intakeTable}

## What you chose

| Axis | Choice | In one line | Constraint |
|---|---|---|---|
${choiceRows}

${
  consistency
    ? `## Consistency

A second pair on the same axis is a check, not a second vote.

${consistency}`
    : ''
}

${
  detailTable
    ? `## Details

| Question | Answer |
|---|---|
${detailTable}`
    : ''
}

## Tensions resolved

${tensions || 'None. No two choices contradicted each other.'}

## Intensity

**${intensity.name[0].toUpperCase() + intensity.name.slice(1)}** — ${intensity.motionMs}ms, ${intensity.motionPx}px shift, ${intensity.rulePx}px rules, image scale ${intensity.imageScale}, ornament: ${intensity.ornament}.

These are build parameters, not tokens yet. Before they reach CSS, add \`motion.duration\`, \`motion.shift\`, \`border.rule\` and \`image.hover-scale\` to \`tokens.json\` and mirror them in \`main.css\`, then run \`pnpm tokens:check\`.

## What this means for the page

${buildRules.length ? buildRules.map((r) => `- **${r.key}** — ${r.rule}`).join('\n') : 'No build rules: the run produced no constraints.'}

## Across formats

Style is extrapolated, not copied. Applied to: ${applications.join(' · ') || 'not chosen'}.

${extrapolation.length ? extrapolation.map((e) => `- ${e.rule}`).join('\n') : 'No cross-format rules from this run.'}

${
  assets.length
    ? `## Assets affected

${output.assetsNote ?? ''}

${assets.map((a) => `- \`${a.id}\` — ${a.effect}`).join('\n')}`
    : ''
}

## Rules out

${avoided.length ? avoided.map((a) => `- ${a}`).join('\n') : 'Nothing recorded.'}

${
  !baselineApplies
    ? '## Committed direction\n\nNo baseline applies to this run. There is nothing to conflict with; this is the first direction.'
    : conflicts.length
      ? `## Conflicts with the committed direction

These are not errors. They are decisions the probe cannot make for you.

${conflicts.map((c) => `- **${c.axis}:** the baseline says \`${c.baseline}\`; the probe chose \`${c.chosen}\`. ${c.note}`).join('\n')}

Resolve each by either changing the direction contract in \`02-direction.md\` or re-running the pair that caused it. Do not average the two.`
      : '## Conflicts with the committed direction\n\nNone. The probe agrees with the contract.'
}

${
  unanswered.pairs.length
    ? `## Not probed

${unanswered.pairs.map((id) => probe.pairs.find((p) => p.id === id)?.axis ?? id).join(' · ')}

These axes produced no constraint. The build must not invent one; if the page needs a decision here, run the pair.`
    : ''
}

#${brandSection}## Sources, and what to borrow

| Axis | Source | Borrow | Link |
|---|---|---|---|
${sources.map((s) => `| ${s.axis} | ${s.label} | ${s.borrow} | ${s.url} |`).join('\n')}

## Open questions

${openQuestions.map((q) => `- ${q}`).join('\n')}

## Agent brief

Read in this order: \`build-spec.json\` → \`02-direction.md\` → \`03-structure.md\` → \`04-assets.md\`.

${agentBrief.map((line, i) => `${i + 1}. ${line}`).join('\n')}

**Do not:** ${listProse(doNot)}.
`

/* --------------------------------------------------------------- write ---- */

if (dry) {
  console.log(`run ${run.runId} · status ${status} · rules ${buildRules.length} · conflicts ${conflicts.length}`)
  console.log(md.split('\n').slice(0, 26).join('\n'))
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(paths.readback, md)
writeFileSync(paths.spec, JSON.stringify(spec, null, 2))
const indexFiles = writeDesignIndex(paths.root, { slug: paths.slug ?? config.id, hasProbe: true })
if (indexFiles) console.log(`index → ${indexFiles.map((f) => rel(f)).join(' · ')}`)

const directionPath = output.directionFile
  ? path.resolve(paths.root, output.directionFile)
  : path.join(outDir, '02-direction.md')

if (touchDirection && existsSync(directionPath)) {
  const label =
    !baselineApplies
      ? 'no baseline — first direction'
      : status === 'confirmed'
        ? 'no conflict with the contract above'
        : status === 'partial'
          ? `partial — ${unanswered.pairs.length} axis/axes not probed`
          : `${conflicts.length} conflict(s) with the contract above — resolve before building${partial ? `; ${unanswered.pairs.length} axis/axes not probed` : ''}`
  const block = `<!-- probe:start -->
## Probe result (generated)

Run \`${run.runId}\` · ${fmt(run.completedAt ?? run.startedAt)} · **${label}**.

${Object.keys(answers).length} decisions answered; full readback in [05-decision.md](./05-decision.md). This block is generated: edit the probe, not this text.
<!-- probe:end -->`
  const current = readFileSync(directionPath, 'utf8')
  const next = current.includes('<!-- probe:start -->')
    ? current.replace(/<!-- probe:start -->[\s\S]*?<!-- probe:end -->/, block)
    : `${current.trimEnd()}\n\n${block}\n`
  writeFileSync(directionPath, next)
}

console.log(`run ${run.runId} · ${status}`)
console.log(`→ ${rel(paths.readback)}`)
console.log(`→ ${rel(paths.spec)}`)
if (touchDirection && existsSync(directionPath)) {
  console.log(`→ ${rel(directionPath)} (probe block)`)
} else if (touchDirection) {
  console.log(`  · no direction file at ${rel(directionPath)} — nothing to annotate`)
}
if (conflicts.length) {
  console.log('\nconflicts to resolve:')
  for (const c of conflicts) console.log(`  ${c.axis}: ${c.baseline} → ${c.chosen}`)
}
