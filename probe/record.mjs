#!/usr/bin/env node
/**
 * probe/record.mjs — write the probe verdict back into Eagle.
 *
 * Adds three tags and an annotation line to every item the probe showed:
 *   probe:<probe-id>   axis:<axis>   verdict:picked|rejected|neither
 *
 * Dry run by default. --apply talks to Eagle's local API (port 41595), which
 * must be running. Every operation is also written to data/eagle-writeback.json
 * so it can be audited or replayed. Idempotent: a second run skips items that
 * already carry the probe tag.
 *
 *   node record.mjs [--run <id>] [--apply] [--api http://localhost:41595]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { resolvePaths, loadConfig, fail } from './paths.mjs'

const paths = resolvePaths(process.argv.slice(2))
const args = paths.args
const apply = args.has('apply')
const api = args.get('api', 'http://localhost:41595').replace(/\/$/, '')

const answersPath = path.resolve(paths.root, args.get('answers', paths.answers))
if (!existsSync(answersPath)) {
  console.error(`✗ no answers at ${answersPath}. Run the probe first.`)
  process.exit(1)
}
const history = JSON.parse(readFileSync(answersPath, 'utf8'))
const runs = Array.isArray(history) ? history : [history]
const run = args.get('run', null) ? runs.find((r) => r.runId === args.get('run', null)) : runs[runs.length - 1]
if (!run) {
  console.error('✗ run not found')
  process.exit(1)
}

if (!existsSync(paths.runtime)) fail(`runtime config missing: ${paths.runtime} — run probe.mjs build`)
const probe = loadConfig(paths.runtime)
const probeTag = `probe:${probe.id}`
const date = new Date(run.completedAt ?? run.startedAt).toISOString().slice(0, 10)

/* ------------------------------------------------------------- build ops -- */

const ops = []
for (const pair of probe.pairs.filter((p) => p.mode !== 'confirm' && !(run.sampleMode ?? {})[p.id])) {
  const answer = run.answers[pair.id]
  if (!answer || answer.kind !== 'pair') continue

  if (answer.side === 'neither') {
    for (const option of pair.options) {
      ops.push({
        id: option.id,
        axis: pair.axis,
        verdict: 'neither',
        line: `Probe ${date} · ${probe.id} · ${pair.axis.toLowerCase()}: neither. ${answer.reason ? `Reason: ${answer.reason}` : 'No reason given.'}`,
      })
    }
    continue
  }

  // Use the resolved winner, not the option clicked before a tension was settled.
  let chosenId = answer.optionId
  const chosen = pair.options.find((o) => o.id === chosenId)
  for (const k of Object.keys(chosen?.constraints ?? {})) {
    const r = run.resolved?.[k]
    if (r !== undefined && r !== chosen.constraints[k]) {
      const alt = pair.options.find((o) => o.constraints?.[k] === r)
      if (alt) chosenId = alt.id
    }
  }

  for (const option of pair.options) {
    if (option.src) continue // external capture: no Eagle item to tag
    const picked = option.id === chosenId
    const other = pair.options.find((o) => o.id !== chosenId)
    ops.push({
      id: option.id,
      axis: pair.axis,
      verdict: picked ? 'picked' : 'rejected',
      line: picked
        ? `Probe ${date} · ${probe.id} · ${pair.axis.toLowerCase()}: picked (${option.label}). Paired against ${other.label}.`
        : `Probe ${date} · ${probe.id} · ${pair.axis.toLowerCase()}: rejected (${option.label}). Chosen: ${other.label}.`,
    })
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/* --------------------------------------------------------- gather + plan -- */

async function itemInfo(id) {
  const res = await fetch(`${api}/api/item/info?id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`Eagle API ${res.status} for ${id}`)
  const json = await res.json()
  if (json.status !== 'success' || !json.data) throw new Error(`Eagle did not return ${id}`)
  return json.data
}

const plan = []
for (const op of ops) {
  try {
    const item = await itemInfo(op.id)
    const tags = item.tags ?? []
    const annotation = item.annotation ?? ''
    const probed = tags.includes(probeTag)
    const already = probed && tags.includes(`verdict:${op.verdict}`)
    // Re-answering a pair must replace the old verdict, not stack a second one.
    const base = probed ? tags.filter((t) => !t.startsWith('verdict:')) : tags
    const newTags = [...base]
    for (const t of [probeTag, `axis:${slug(op.axis)}`, `verdict:${op.verdict}`]) {
      if (!newTags.includes(t)) newTags.push(t)
    }
    // Replace our previous annotation line for this probe rather than appending twice.
    const kept = annotation
      .split('\n')
      .filter((line) => !line.includes(`${probe.id} ·`))
      .join('\n')
      .trim()
    const newAnnotation = kept ? `${kept}\n\n${op.line}` : op.line
    plan.push({
      id: op.id,
      name: item.name,
      axis: op.axis,
      verdict: op.verdict,
      skipped: already && newAnnotation === annotation,
      tags: newTags,
      annotation: newAnnotation,
      changed: newAnnotation !== annotation || newTags.length !== tags.length,
    })
  } catch (error) {
    plan.push({ id: op.id, axis: op.axis, verdict: op.verdict, error: error.message })
  }
}

const sidecar = {
  generatedAt: new Date().toISOString(),
  runId: run.runId,
  probe: probe.id,
  applied: apply,
  ops: plan,
}
writeFileSync(paths.writeback, JSON.stringify(sidecar, null, 2))

/* ---------------------------------------------------------------- report -- */

const failed = plan.filter((p) => p.error)
const skipped = plan.filter((p) => p.skipped)
const todo = plan.filter((p) => !p.error && !p.skipped)

console.log(`run ${run.runId.slice(0, 8)} · ${plan.length} items · ${todo.length} to tag · ${skipped.length} already tagged`)
for (const p of plan) {
  if (p.error) console.log(`  ✗ ${p.id} ${p.axis}: ${p.error}`)
  else console.log(`  ${p.skipped ? '·' : '+'} ${p.id} ${p.verdict.padEnd(8)} ${p.axis}`)
}

if (!apply) {
  console.log(`\ndry run. Nothing written. Re-run with --apply to tag ${todo.length} item(s) in Eagle.`)
  process.exit(failed.length ? 1 : 0)
}

let written = 0
for (const p of todo) {
  try {
    const res = await fetch(`${api}/api/item/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, tags: p.tags, annotation: p.annotation }),
    })
    const json = await res.json()
    if (json.status !== 'success') throw new Error(json.message ?? 'update failed')
    written += 1
  } catch (error) {
    console.error(`  ✗ ${p.id}: ${error.message}`)
    failed.push({ ...p, error: error.message })
  }
}

console.log(`\nwrote ${written}/${todo.length} · sidecar: data/eagle-writeback.json`)
if (failed.length) process.exit(1)
