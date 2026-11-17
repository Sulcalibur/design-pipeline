#!/usr/bin/env node
/**
 * probe/brand-review.mjs — the gate between the brand record and the work.
 *
 * The interview can finish with gaps; the record can drift from the build. This
 * stage is what makes "the record is true" checkable: every slot has a status
 * and a source, the contrast pairs pass, the rules a copy gate needs exist, and
 * the live palette still carries the anchor.
 *
 *   node brand-review.mjs --project . [--json] [--no-write]
 *   node brand-review.mjs --project . --max-tbc 2 --max-assumption 10
 *
 * Writes docs/brand/review.md. Exits 1 when anything blocks.
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import {
  Report,
  loadBrand,
  slotValue,
  brandList,
  firstHex,
  contrast,
  dirMtime,
  writeDoc,
  nowDate,
  readJson,
} from './checks.mjs'

const here = import.meta.dirname
const toolConfig = path.join(here, 'brand.config.json')
const brandlint = path.join(here, '..', 'bin', 'brandlint')
const HOME = process.env.HOME ?? ''
const REGISTRY_CANDIDATES = [
  path.join(HOME, '.config/design-pipeline/brand-registry.json'),
  path.join(HOME, 'Developer/ai-config/brand-registry.json'),
]

const COLOUR_SLOTS = ['v2-paper', 'v2-ink', 'v2-accent', 'v2-surface']
const TYPE_SLOTS = ['v3-display', 'v3-body', 'v3-ui']
const DIALS = ['density', 'contrast', 'warmth', 'editoriality', 'ornament', 'motion']

function expandHome(p) {
  return p?.startsWith('~') ? path.join(process.env.HOME ?? '', p.slice(1)) : p
}

/** The 39 slot ids the interview asks for, taken from the tool's own config. */
function requiredSlots() {
  try {
    const config = JSON.parse(readFileSync(toolConfig, 'utf8'))
    return config.questions.map((q) => q.id)
  } catch {
    return []
  }
}

function tokenFile(project, override) {
  const candidates = override
    ? [path.resolve(project, override)]
    : [
        path.join(project, 'app/assets/css/tokens.css'),
        path.join(project, 'src/styles/tokens.css'),
        path.join(project, 'styles/tokens.css'),
        path.join(project, 'tokens.json'),
        path.join(project, 'app/globals.css'),
        path.join(project, 'src/app/globals.css'),
      ]
  return candidates.find((f) => existsSync(f)) ?? null
}

/** Match this project to a product in the shared brand registry, by folder. */
function registryProduct(project) {
  const explicit = process.env.BRAND_REGISTRY
  const registryPath = explicit
    ? path.resolve(expandHome(explicit))
    : REGISTRY_CANDIDATES.map(expandHome).find((p) => existsSync(p)) ?? REGISTRY_CANDIDATES[0]
  if (!existsSync(registryPath)) return { registryPath, product: null }
  const reg = readJson(registryPath, null)
  if (!reg) return { registryPath, product: null, broken: true }
  const want = path.resolve(project)
  const product = (reg.products ?? []).find((p) => {
    if (!p.local) return false
    const local = path.resolve(expandHome(p.local))
    return local === want || want.startsWith(local + path.sep)
  })
  return { registryPath, product: product ?? null }
}

export function reviewBrand({ project, maxTbc = 1, maxAssumption = null, maxAgeDays = 1, id = null, registry = true, tokens = null }) {
  const report = new Report('Brand review')
  const brand = loadBrand(project)
  if (!brand || !brand.data) {
    report.add('blocking', 'record-missing', `no readable docs/brand/brand.json under ${project}`)
    report.status = 'blocked'
    return report
  }
  const data = brand.data
  const slots = data.slots ?? {}
  const ids = requiredSlots()
  const colour = Object.fromEntries(COLOUR_SLOTS.map((s) => [s, firstHex(slotValue(data, s))]))
  const accentOnPaper = colour['v2-accent'] && colour['v2-paper'] ? contrast(colour['v2-accent'], colour['v2-paper']) : null
  const inkOnPaper = colour['v2-ink'] && colour['v2-paper'] ? contrast(colour['v2-ink'], colour['v2-paper']) : null
  const inkOnSurface = colour['v2-ink'] && colour['v2-surface'] ? contrast(colour['v2-ink'], colour['v2-surface']) : null
  const paperOnAccent = colour['v2-paper'] && colour['v2-accent'] ? contrast(colour['v2-paper'], colour['v2-accent']) : null

  /* ---------------------------------------------------------------- slots -- */
  const missing = ids.filter((s) => !slots[s])
  if (missing.length > 5) report.add('blocking', 'slots-missing', `${missing.length} of ${ids.length} slots absent: ${missing.slice(0, 8).join(', ')}`)
  else for (const s of missing) report.add('major', 'slot-missing', `slot ${s} is absent from the record`)

  const counts = { verified: 0, assumption: 0, tbc: 0, other: 0 }
  for (const [sid, slot] of Object.entries(slots)) {
    const status = String(slot?.status ?? '').toLowerCase()
    if (status in counts) counts[status] += 1
    else counts.other += 1
    const empty = slot?.value == null || (Array.isArray(slot.value) ? !slot.value.length : String(slot.value).trim() === '')
    if (empty && status !== 'tbc') report.add('major', 'slot-empty', `${sid} has no value`)
    if (!['verified', 'assumption', 'tbc'].includes(status)) {
      report.add('major', 'slot-status', `${sid} has status "${slot?.status ?? 'none'}" (verified / assumption / tbc)`)
    }
    if (status === 'verified' && !String(slot?.source ?? '').trim()) {
      report.add('major', 'slot-unsourced', `${sid} is marked verified with no source`)
    }
  }

  if (counts.tbc > maxTbc) report.add('major', 'tbc-budget', `${counts.tbc} TBC slot(s); budget is ${maxTbc}`)
  const assumptionLimit = maxAssumption ?? Math.ceil(Object.keys(slots).length * 0.3)
  if (counts.assumption > assumptionLimit) {
    report.add('major', 'assumption-budget', `${counts.assumption} assumption(s); budget is ${assumptionLimit} (30%)`)
  }
  for (const gap of data.gaps ?? []) {
    report.add('major', 'record-gap', `${gap.label ?? gap.id}: ${gap.status ?? 'open'}`)
  }

  /* ----------------------------------------------------------- enforceable -- */
  if (!brandList(data, 'c1-banned').length) {
    report.add('blocking', 'banned-words-empty', 'C1 banned words is empty — the copy gate would have nothing to enforce')
  }
  if (!brandList(data, 'v8').length) report.add('major', 'forbidden-empty', 'V8 forbidden territory is empty')
  if (!slotValue(data, 'b1')) report.add('major', 'promise-empty', 'B1 promise is empty — a direction cannot be tested against it')
  for (const slot of TYPE_SLOTS) {
    if (!String(slotValue(data, slot) ?? '').trim()) report.add('major', 'type-missing', `${slot} names no type family`)
  }

  /* -------------------------------------------------------------- contrast -- */
  for (const [slot, hex] of Object.entries(colour)) {
    if (!hex) report.add('blocking', 'colour-missing', `${slot} has no usable hex`)
  }
  if (inkOnPaper != null && inkOnPaper < 4.5) report.add('blocking', 'contrast-ink-paper', `ink on paper is ${inkOnPaper}:1 (AA needs 4.5:1)`)
  if (inkOnSurface != null && inkOnSurface < 4.5) report.add('blocking', 'contrast-ink-surface', `ink on surface is ${inkOnSurface}:1 (AA needs 4.5:1)`)
  if (accentOnPaper != null && accentOnPaper < 4.5) report.add('major', 'contrast-accent', `accent on paper is ${accentOnPaper}:1 — body-size accent text needs 4.5:1`)
  if (paperOnAccent != null && paperOnAccent < 4.5) report.add('major', 'contrast-accent-fill', `paper on accent fill is ${paperOnAccent}:1 — normal-size button text needs 4.5:1`)

  /* ----------------------------------------------------------------- dials -- */
  const dials = slotValue(data, 'dials') ?? data.direction?.dials ?? null
  if (!dials || typeof dials !== 'object') report.add('minor', 'dials-missing', 'D2 dials are absent or unreadable')
  else {
    const missingDials = DIALS.filter((d) => dials[d] == null)
    if (missingDials.length) report.add('minor', 'dials-partial', `dials missing: ${missingDials.join(', ')}`)
    for (const [name, d] of Object.entries(dials)) {
      const target = typeof d === 'object' ? d.target : d
      if (target != null && (target < 0 || target > 5)) report.add('minor', 'dial-range', `dial ${name} target ${target} is outside 0–5`)
    }
  }

  /* -------------------------------------------------------------- staleness -- */
  const tokensPath = tokenFile(project, tokens)
  const generated = data.generatedAt ? new Date(data.generatedAt) : null
  if (tokensPath && generated) {
    const mtime = dirMtime(tokensPath)
    if (mtime) {
      const lag = Math.round((mtime.getTime() - generated.getTime()) / 86_400_000)
      if (lag > maxAgeDays) {
        report.add('major', 'record-stale', `${rel(tokensPath)} changed ${lag} day(s) after the brand record was emitted`)
      }
    }
  }
  if (!existsSync(path.join(path.dirname(brand.file), 'brand.md'))) {
    report.add('minor', 'markdown-missing', 'brand.md is absent; agents and humans read it first')
  }

  /* --------------------------------------------------------------- registry -- */
  let registryId = id
  if (registry) {
    const found = registryProduct(project)
    registryId = registryId ?? found.product?.id ?? null
    if (found.broken) report.note(`registry ${rel(found.registryPath)} is not valid JSON`)
    if (!found.product && !id) report.note(`project is not in the brand registry (${rel(found.registryPath)}) — drift check skipped`)
    if (registryId && existsSync(brandlint)) {
      const run = spawnSync(process.execPath, [brandlint, '--json', '--only', registryId], { encoding: 'utf8', timeout: 120_000 })
      const parsed = (() => {
        try {
          return JSON.parse(run.stdout)
        } catch {
          return null
        }
      })()
      if (!parsed) report.note(`brandlint returned no JSON for "${registryId}"`)
      else {
        if (!parsed.findings?.length) report.row(`registry ${registryId}`, 'no findings')
        for (const f of parsed.findings ?? []) {
          const sev = f.sev === 'Blocking' ? 'blocking' : f.sev === 'Major' ? 'major' : 'minor'
          report.add(sev, `brandlint:${f.code}`, `${f.msg}`)
        }
      }
    }
  }

  /* ----------------------------------------------------------------- rows -- */
  report.row('record', rel(brand.file))
  report.row('emitted', data.generatedAt?.slice(0, 10) ?? 'unknown')
  report.row('slots', `${Object.keys(slots).length} of ${ids.length}`)
  report.row('statuses', `${counts.verified} verified · ${counts.assumption} assumption · ${counts.tbc} TBC`)
  report.row('contrast', [
    inkOnPaper != null ? `ink/paper ${inkOnPaper}:1` : null,
    inkOnSurface != null ? `ink/surface ${inkOnSurface}:1` : null,
    accentOnPaper != null ? `accent/paper ${accentOnPaper}:1` : null,
    paperOnAccent != null ? `paper/accent ${paperOnAccent}:1` : null,
  ].filter(Boolean).join(' · '))
  report.row('tokens', tokensPath ? rel(tokensPath) : 'not found')
  report.row('registry', registryId ?? 'not matched')

  report.status = report.blocking ? 'blocked' : 'ok'
  return report
}

/* ------------------------------------------------------------------- CLI -- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const project = path.resolve(process.cwd(), args.get('project', '.'))
  const report = reviewBrand({
    project,
    maxTbc: Number(args.get('max-tbc', 1)),
    maxAssumption: args.get('max-assumption') ? Number(args.get('max-assumption')) : null,
    maxAgeDays: Number(args.get('max-age', 1)),
    id: args.get('id', null),
    registry: !args.has('no-registry'),
    tokens: args.get('tokens', null),
  })

  if (args.has('json')) console.log(JSON.stringify(report.json(), null, 2))
  else {
    process.stdout.write(report.render({ intro: `Project: ${project}` }))
    if (!args.has('no-write')) {
      const file = writeDoc(path.join(project, 'docs/brand'), 'review.md', report.render({ intro: `Project: ${project}` }))
      console.log(`\n→ ${rel(file)}`)
    }
  }
  process.exit(report.blocking ? 1 : 0)
}
