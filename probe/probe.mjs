#!/usr/bin/env node
/**
 * probe/probe.mjs — one entry point for the reference probe.
 *
 * The curator data lives in probe.config.json. This script validates it, builds
 * the runtime copy, and runs every other step. Nothing here calls a model.
 *
 *   node probe.mjs build            validate + write app/probe.json
 *   node probe.mjs validate         check the config only
 *   node probe.mjs status           config, library pool, last run, last spec
 *   node probe.mjs ingest           index the Eagle library
 *   node probe.mjs sheet            build the contact sheet for curation
 *   node probe.mjs serve [--port]   run the probe
 *   node probe.mjs emit [--dry]     write 05-decision.md + build-spec.json
 *   node probe.mjs record [--apply] write verdicts back into Eagle
 *
 * Editing probe.config.json is the only step that needs judgement. Everything
 * else is deterministic and safe to re-run.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { resolvePaths, loadConfig, loadCandidates, fail, rel } from './paths.mjs'
import { loadBrandRecord, brandBlock } from './brand-link.mjs'

const here = import.meta.dirname
const argv = process.argv.slice(2)
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'build'
const rest = cmd === argv[0] ? argv.slice(1) : argv
const paths = resolvePaths(rest)
const { config: configPath, candidates: candidatesPath, answers: answersPath, spec: specPath } = paths

/* ------------------------------------------------------------------ load -- */


/* -------------------------------------------------------------- validate -- */

function validate(config, candidates) {
  const errors = []
  const warnings = []
  const ids = new Set()
  const pushId = (id, where) => {
    if (!id) errors.push(`${where}: missing id`)
    else if (ids.has(id)) errors.push(`${where}: duplicate id "${id}"`)
    else ids.add(id)
  }

  if (!config.id) errors.push('config: missing id')
  if (!Array.isArray(config.intake) || !config.intake.length) errors.push('config: intake must be a non-empty array')
  if (!Array.isArray(config.pairs)) errors.push('config: pairs must be an array')
  else if (!config.pairs.length) warnings.push('pairs: none yet — the probe has nothing to show until pairs are curated')
  if (!Array.isArray(config.followups)) errors.push('config: followups must be an array')

  const byId = candidates ? new Map(candidates.map((c) => [c.id, c])) : null
  const basePairs = (config.pairs ?? []).filter((p) => p.mode !== 'confirm')
  const axisKeys = new Set(basePairs.map((p) => p.axisKey ?? p.id))
  const constraintKeys = new Set()

  for (const pair of config.pairs ?? []) {
    for (const option of pair.options ?? []) {
      for (const key of Object.keys(option.constraints ?? {})) constraintKeys.add(key)
    }
  }
  for (const q of config.followups ?? []) {
    for (const option of q.options ?? []) {
      for (const key of Object.keys(option.constraint ?? {})) constraintKeys.add(key)
    }
  }

  const intakeIds = new Set((config.intake ?? []).map((q) => q.id))
  for (const f of config.facts ?? []) {
    if (!f.text || !f.source) errors.push('facts: every fact needs text and source')
    for (const key of Object.keys(f.when ?? {})) {
      if (!intakeIds.has(key)) errors.push(`facts: when uses unknown intake question "${key}"`)
    }
  }
  if (config.intakeClose && !config.intakeClose.question) errors.push('intakeClose: missing question')
  if (config.baseline) {
    if (!config.baseline.direction) errors.push('baseline: missing direction')
    if (!config.baseline.constraints || typeof config.baseline.constraints !== 'object') errors.push('baseline: missing constraints')
    for (const key of Object.keys(config.baseline.when ?? {})) {
      if (!intakeIds.has(key)) errors.push(`baseline: when uses unknown intake question "${key}"`)
    }
  }

  for (const q of config.intake ?? []) {
    pushId(q.id, 'intake')
    const rec = Array.isArray(q.recommend) ? q.recommend : q.recommend ? [q.recommend] : []
    for (const id of rec) {
      if (!(q.options ?? []).some((o) => o.id === id)) errors.push(`intake ${q.id}: recommends unknown option "${id}"`)
    }
    if (rec.length && !q.recommendWhy) warnings.push(`intake ${q.id}: recommendation has no reason`)
    if (!['single', 'multi'].includes(q.type)) errors.push(`intake ${q.id}: type must be single or multi`)
    if (!q.question) errors.push(`intake ${q.id}: missing question`)
    if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`intake ${q.id}: needs at least two options`)
    for (const o of q.options ?? []) {
      if (!o.id || !o.label) errors.push(`intake ${q.id}: every option needs id and label`)
      for (const key of Object.keys(o.boosts ?? {})) {
        if (axisKeys.size && !axisKeys.has(key)) warnings.push(`intake ${q.id} → ${o.id}: boost "${key}" is not a known axis`)
      }
    }
  }

  const pairIds = new Set((config.pairs ?? []).map((p) => p.id))
  for (const pair of config.pairs ?? []) {
    pushId(pair.id, 'pair')
    if (!pair.axis) errors.push(`pair ${pair.id}: missing axis`)
    if (!pair.question) errors.push(`pair ${pair.id}: missing question`)
    if (pair.mode === 'confirm') {
      if (!pair.after) errors.push(`pair ${pair.id}: confirm pair needs "after"`)
      else if (!basePairs.some((p) => p.id === pair.after)) errors.push(`pair ${pair.id}: after "${pair.after}" is not a base pair`)
    } else if (!pair.axisKey) {
      errors.push(`pair ${pair.id}: base pair needs axisKey`)
    }
    if (!Array.isArray(pair.options) || pair.options.length !== 2) {
      errors.push(`pair ${pair.id}: needs exactly two options`)
      continue
    }
    const local = new Set()
    for (const o of pair.options) {
      if (!o.id) errors.push(`pair ${pair.id}: option missing id`)
      else if (local.has(o.id)) errors.push(`pair ${pair.id}: duplicate option "${o.id}"`)
      else local.add(o.id)
      if (!o.source) errors.push(`pair ${pair.id}/${o.id}: missing source`)
      if (!o.alt) errors.push(`pair ${pair.id}/${o.id}: missing alt`)
      if (!o.vocab) errors.push(`pair ${pair.id}/${o.id}: missing vocab`)
      // The app dereferences these at save time — half-formed options must
      // fail validation, not the browser.
      if (!o.url) errors.push(`pair ${pair.id}/${o.id}: missing url`)
      if (!o.avoid) errors.push(`pair ${pair.id}/${o.id}: missing avoid`)
      if (!o.note) errors.push(`pair ${pair.id}/${o.id}: missing note`)
      if (!o.src && byId && !byId.has(o.id)) errors.push(`pair ${pair.id}/${o.id}: no Eagle candidate and no src`)
      if (byId && !byId.has(o.id) && !o.src) warnings.push(`pair ${pair.id}/${o.id}: external image; write-back will skip it`)
    }
    if (pair.mode === 'confirm') {
      const keys = new Set(pair.options.flatMap((o) => Object.keys(o.constraints ?? {})))
      if (!keys.size) errors.push(`pair ${pair.id}: confirm options need constraints to compare`)
    }
  }

  const seenImages = new Map()
  for (const pair of basePairs) {
    for (const o of pair.options ?? []) {
      if (!o.id) continue
      if (seenImages.has(o.id) && seenImages.get(o.id) !== pair.axisKey) {
        warnings.push(`image ${o.id} appears on two axes (${seenImages.get(o.id)} and ${pair.axisKey})`)
      }
      seenImages.set(o.id, pair.axisKey)
    }
  }

  for (const q of config.followups ?? []) {
    pushId(q.id, 'followup')
    if (!q.question) errors.push(`followup ${q.id}: missing question`)
    if (!['single', 'multi'].includes(q.type)) errors.push(`followup ${q.id}: type must be single or multi`)
    if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`followup ${q.id}: needs at least two options`)
    for (const [key, values] of Object.entries(q.when ?? {})) {
      if (!constraintKeys.has(key)) errors.push(`followup ${q.id}: when uses unknown constraint "${key}"`)
      if (!Array.isArray(values) || !values.length) errors.push(`followup ${q.id}: when.${key} must be a non-empty array`)
    }
    for (const o of q.options ?? []) {
      if (!o.id || !o.label) errors.push(`followup ${q.id}: every option needs id and label`)
      if (!o.constraint || !Object.keys(o.constraint).length) errors.push(`followup ${q.id}/${o.id}: missing constraint`)
    }
  }

  const axes = new Map()
  for (const p of basePairs) {
    const k = p.axisKey ?? p.id
    axes.set(k, (axes.get(k) ?? 0) + 1)
  }
  for (const [axis, n] of axes) if (n === 1) warnings.push(`axis "${axis}" has only one pair; no "try another pair"`)

  return { errors, warnings, basePairs, axisKeys, constraintKeys }
}

function printReport({ errors, warnings, basePairs }, config) {
  const unique = new Set((config.pairs ?? []).flatMap((p) => (p.options ?? []).map((o) => o.id)))
  console.log(
    `config ${config.id} · intake ${config.intake?.length ?? 0} · pairs ${config.pairs?.length ?? 0} (${basePairs.length} base) · followups ${config.followups?.length ?? 0} · images ${unique.size}`,
  )
  for (const w of warnings) console.log(`  ! ${w}`)
  for (const e of errors) console.log(`  ✗ ${e}`)
  if (errors.length) {
    console.error(`\n${errors.length} error(s). Nothing written.`)
    process.exit(1)
  }
  console.log(`  ✓ valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}`)
}

/* --------------------------------------------------------------- commands -- */

function build() {
  const config = loadConfig(configPath)
  const candidates = loadCandidates(candidatesPath)
  if (!candidates) console.warn('  ! data/candidates.json not found; skipping image-id checks (run ingest first)')
  const report = validate(config, candidates)
  printReport(report, config)
  const { record, block } = brandFor(paths)
  if (block) {
    console.log(`  · brand → ${rel(record.file)} (${block.product ?? 'unnamed'}, ${block.status})`)
  }
  mkdirSync(paths.build, { recursive: true })
  writeFileSync(paths.runtime, JSON.stringify(withUi({ ...config, brand: block }), null, 2))
  console.log(`→ ${rel(paths.runtime)}`)
}

/** Walk up from the config dir to find a project-level brand record, if any. */
function brandFor(paths) {
  const record = loadBrandRecord(paths.root, { readFile: readFileSync })
  if (!record) return { record: null, block: null }
  const block = brandBlock(record.data)
  return { record, block }
}

/** The runtime copy carries the UI strings the app needs, so the app stays generic. */
function withUi(config) {
  const ui = config.ui ?? {}
  return {
    ...config,
    ui: {
      title: ui.title ?? config.id ?? 'Reference probe',
      mark: ui.mark ?? '',
      storageKey: ui.storageKey ?? `probe:${config.id ?? 'default'}`,
      note: ui.note ?? '',
    },
  }
}

function validateOnly() {
  const config = loadConfig(configPath)
  const candidates = loadCandidates(candidatesPath)
  const report = validate(config, candidates)
  printReport(report, config)
}

function status() {
  const config = loadConfig(configPath)
  const candidates = loadCandidates(candidatesPath)
  const report = validate(config, candidates)
  printReport(report, config)

  console.log(`\nconfig: ${rel(configPath)}`)
  const libFile = path.join(paths.data, 'library.json')
  if (existsSync(libFile)) {
    try {
      const lib = JSON.parse(readFileSync(libFile, 'utf8'))
      console.log(`library: ${lib.name} · ${lib.total ?? '?'} items · via ${lib.via ?? 'index'}`)
    } catch {}
  }
  console.log(`candidates: ${candidates ? candidates.length : 'not ingested'}`)
  if (existsSync(answersPath)) {
    const runs = JSON.parse(readFileSync(answersPath, 'utf8'))
    const latest = runs[runs.length - 1]
    console.log(`answers: ${runs.length} run(s) · latest ${latest.runId.slice(0, 8)} · ${Object.keys(latest.answers).length} decisions`)
  } else {
    console.log('answers: none yet')
  }
  const specPathLegacy = specPath.includes('build-spec.json') ? specPath.replace('build-spec.json', 'design-spec.json') : null
  const specSource = existsSync(specPath) ? specPath : (specPathLegacy && existsSync(specPathLegacy) ? specPathLegacy : null)
  if (specSource) {
    const spec = JSON.parse(readFileSync(specSource, 'utf8'))
    console.log(`spec: ${spec.status} · ${spec.generatedAt.slice(0, 10)} · ${spec.buildRules?.length ?? 0} rules${specSource !== specPath ? ' (legacy spec file)' : ''}`)
  } else {
    console.log('spec: not generated yet')
  }
  const { record, block } = brandFor(paths)
  if (record && block) {
    console.log(`brand: ${block.product} · ${block.status} · ${rel(record.file)}`)
  } else {
    console.log('brand: none — the spec will not carry brand constraints')
  }
}

function runScript(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(here, script), ...args], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

function serve(args) {
  const child = spawn(process.execPath, [path.join(here, 'serve.mjs'), ...args], { stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 0))
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
}

function help() {
  console.log(`Reference probe — shared engine, per-project config

  node probe.mjs init <dir>        scaffold docs/design/<slug>/ from templates
  node probe.mjs build             validate probe.config.json + write build/probe.json
  node probe.mjs validate          check the config only
  node probe.mjs status            config, library pool, last run, last spec
  node probe.mjs ingest            index the reference source (Eagle or a folder)
  node probe.mjs sheet             build the contact sheet for curation
  node probe.mjs analyze           measure references + write their profile
  node probe.mjs live              read the reference's live page (fonts, colours, sections)
  node probe.mjs links             resolve a gallery capture to the site it depicts
  node probe.mjs preview           write a static pair page for review
  node probe.mjs brand             brand interview: scaffold | serve | status | emit
  node probe.mjs fonts             index type specimens · validate named families
  node probe.mjs audit             Lighthouse: performance, accessibility, SEO
  node probe.mjs serve [--port]    run the probe at http://127.0.0.1:4210
  node probe.mjs emit [--dry]      write 05-decision.md + build-spec.json
  node probe.mjs record [--apply]  write verdicts back into Eagle

Global flags, valid on every command:
  --config <path>   the project's probe.config.json (default ./probe.config.json)
  --out <dir>       where 05-decision.md, build-spec.json and 02-direction.md land
  --data <dir>      answers.json, candidates.json
  --build <dir>     generated probe.json and sheet.html

Only editing probe.config.json needs judgement. Everything else is deterministic.`)
}

/* ------------------------------------------------------------------ main -- */

switch (cmd) {
  case 'init':
    runScript('init.mjs', rest)
    break
  case 'build':
    build()
    break
  case 'validate':
    validateOnly()
    break
  case 'status':
    status()
    break
  case 'ingest':
    runScript('ingest.mjs', rest)
    break
  case 'sheet':
    runScript('sheet.mjs', rest)
    break
  case 'analyze':
    runScript('analyze.mjs', rest)
    break
  case 'live':
    runScript('live.mjs', rest)
    break
  case 'links':
    runScript('links.mjs', rest)
    break
  case 'preview':
    runScript('preview.mjs', rest)
    break
  case 'brand':
    runScript('brand.mjs', rest)
    break
  case 'fonts':
    runScript('fonts.mjs', rest)
    break
  case 'audit':
    runScript('audit.mjs', rest)
    break
  case 'serve':
    serve(rest)
    break
  case 'emit':
    runScript('emit.mjs', rest)
    break
  case 'record':
    runScript('record.mjs', rest)
    break
  case 'help':
  case '--help':
  case '-h':
    help()
    break
  default:
    console.error(`unknown command: ${cmd}\n`)
    help()
    process.exit(1)
}
