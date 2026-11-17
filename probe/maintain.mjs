#!/usr/bin/env node
/**
 * probe/maintain.mjs — the recurring check.
 *
 * A launch is not the end. This runs the composite audit again, compares it with
 * the last recorded run, and reports only what changed: new findings, resolved
 * findings, score movement. It is the stage that catches drift before a user
 * does.
 *
 *   node maintain.mjs --config docs/design/home/probe.config.json --url https://acme.test/
 *   node maintain.mjs --project . --url https://acme.test/ --previous <ref>
 *
 * Writes docs/design/<slug>/check-<date>.md and maintain.json (the state the
 * next run diffs against). Exits 1 on a new blocking finding.
 */
import { writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import { resolveContext, writeDoc, readJson, hashFinding, nowDate } from './checks.mjs'
import { runReview } from './review.mjs'

export async function runMaintain({ project, docDir, urls, previous = null, render = true, responsive = null }) {
  const date = nowDate()
  const statePath = path.join(docDir, 'maintain.json')
  const prior = existsSync(statePath) ? readJson(statePath, null) : null

  const result = await runReview({ project, docDir, urls, previous, render, detector: true, responsive })
  const findings = result.report.findings.map((f) => ({ ...f, hash: hashFinding(f) }))
  const previousHashes = new Set((prior?.findings ?? []).map((f) => f.hash))
  const currentHashes = new Set(findings.map((f) => f.hash))
  const added = prior ? findings.filter((f) => !previousHashes.has(f.hash)) : []
  const resolved = prior ? (prior.findings ?? []).filter((f) => !currentHashes.has(f.hash)) : []

  const scoreDelta = prior
    ? Object.fromEntries(Object.entries(result.scores).map(([k, v]) => [k, v - (prior.scores?.[k] ?? v)]))
    : null

  writeFileSync(
    statePath,
    JSON.stringify(
      {
        date,
        url: urls[0] ?? null,
        scores: result.scores,
        total: result.total,
        band: result.band,
        findings,
      },
      null,
      2,
    ) + '\n',
  )

  const lines = []
  lines.push(`# Check — ${date}`, '')
  lines.push(`> Target: ${urls[0] ?? project}${previous ? ` · previous deploy: ${previous}` : ''}`, '')
  lines.push(`**${result.total}/20 — ${result.band}**${prior ? ` (${deltaLabel(result.total - (prior.total ?? result.total))} vs ${prior.date})` : ' · baseline recorded'}`)
  lines.push('')
  lines.push('| Dimension | Score | Change |', '|---|---|---|')
  for (const [k, v] of Object.entries(result.scores)) {
    const d = scoreDelta?.[k] ?? 0
    lines.push(`| ${k} | ${v}/4 | ${prior ? (d === 0 ? '—' : d > 0 ? `+${d}` : `${d}`) : 'baseline'} |`)
  }
  lines.push('')

  if (prior) {
    lines.push('## New since the last run', '')
    if (!added.length) lines.push('None.', '')
    else {
      lines.push('| Severity | Code | Finding |', '|---|---|---|')
      for (const f of added.sort((a, b) => a.sev.localeCompare(b.sev))) lines.push(`| ${f.sev} | ${f.code} | ${String(f.message).replace(/\|/g, '\\|')} |`)
      lines.push('')
    }
    lines.push('## Resolved since the last run', '')
    if (!resolved.length) lines.push('None.', '')
    else for (const f of resolved) lines.push(`- ${f.code} — ${String(f.message).replace(/\n/g, ' ')}`)
    lines.push('')
  } else {
    lines.push('## Baseline', '')
    lines.push('This is the first recorded run. The next run reports only what changed against it.', '')
  }

  lines.push('## Full audit', '')
  lines.push(`The evidence and the scored report are in \`${rel(result.file)}\` and \`${rel(result.evidence)}/\`.`, '')
  lines.push('## Gate', '')
  lines.push(result.report.blocking ? `**Blocked.** ${result.report.blocking} blocking finding(s).` : '**Clear.** No blocking findings.')

  const file = writeDoc(docDir, `check-${date}.md`, lines.join('\n') + '\n')
  return { file, statePath, result, added, resolved, prior }
}

function deltaLabel(n) {
  return n === 0 ? 'no change' : n > 0 ? `+${n}` : `${n}`
}

/* -------------------------------------------------------------------- CLI -- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const ctx = resolveContext(args)
  const urls = String(args.get('url', '') || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  if (!urls.length) fail('maintain needs a URL: node maintain.mjs --url https://example.com/')
  const out = await runMaintain({
    project: ctx.project,
    docDir: ctx.docDir,
    urls,
    previous: args.get('previous', null),
    render: !args.has('no-render'),
    responsive: args.get('responsive') ? Number(args.get('responsive')) : null,
  })

  if (args.has('json')) {
    console.log(
      JSON.stringify(
        {
          scores: out.result.scores,
          total: out.result.total,
          band: out.result.band,
          added: out.added,
          resolved: out.resolved,
          file: out.file,
          state: out.statePath,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`\n${out.result.total}/20 — ${out.result.band}${out.prior ? ` (${deltaLabel(out.result.total - (out.prior.total ?? out.result.total))} vs ${out.prior.date})` : ' · baseline'}`)
    console.log(`${out.added.length} new · ${out.resolved.length} resolved · ${out.result.report.blocking} blocking`)
    console.log(`→ ${rel(out.file)}`)
    console.log(`→ ${rel(out.statePath)}`)
  }
  process.exit(out.result.report.blocking || out.added.some((f) => f.sev === 'blocking') ? 1 : 0)
}
