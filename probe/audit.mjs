#!/usr/bin/env node
/**
 * probe/audit.mjs — the mechanical verification pass for a built page.
 *
 * Lighthouse runs in the cached Chrome for Testing. Its accessibility category
 * is axe-core, so one run covers performance, accessibility, best practices and
 * SEO. The output is a small JSON summary plus a markdown block for review.md —
 * not the 500 KB Lighthouse report.
 *
 *   node audit.mjs --url http://localhost:3000/ [--out docs/design/<slug>/audit]
 *   node audit.mjs --url https://example.com/ --slug home-refresh
 *
 * Requires network for the first `npx lighthouse` fetch (pinned major), and a
 * Chrome for Testing binary; CHROME_PATH wins if set.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import { chromePath } from './checks.mjs'

const args = parseArgs(process.argv.slice(2))
const url = args.get('url')
if (!url) fail('audit needs a URL: node audit.mjs --url http://localhost:3000/')

const project = path.resolve(process.cwd(), args.get('project', '.'))
const slug = args.get('slug')
const base = args.get('out')
  ? path.resolve(project, args.get('out'))
  : slug
    ? path.join(project, 'docs/design', slug, 'audit')
    : path.join(project, 'docs/audit')

const browser = chromePath()
if (!browser) fail('no Chrome or Chromium found — set CHROME_PATH to a Chrome for Testing binary')

const tmp = path.join(os.tmpdir(), `lh-${process.pid}.json`)
const categories = args.get('categories', 'performance,accessibility,best-practices,seo')
const version = args.get('lighthouse', 'lighthouse@12')

console.log(`audit ${url}`)
console.log(`chrome ${browser}`)
const result = spawnSync(
  'npx',
  [
    '-y', version, url,
    '--output=json',
    `--output-path=${tmp}`,
    '--chrome-flags=--headless=new --no-sandbox',
    '--quiet',
    `--only-categories=${categories}`,
  ],
  { encoding: 'utf8', timeout: 240_000, env: { ...process.env, CHROME_PATH: browser } },
)

if (result.status !== 0 || !existsSync(tmp)) {
  const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-6).join('\n')
  fail(`Lighthouse did not complete${result.error ? `: ${result.error.message}` : ''}\n${detail}`)
}

const report = JSON.parse(readFileSync(tmp, 'utf8'))
rmSync(tmp, { force: true })

const scores = Object.fromEntries(
  Object.entries(report.categories ?? {}).map(([id, category]) => [
    id,
    { title: category.title, score: category.score == null ? null : Math.round(category.score * 100) },
  ]),
)

const failures = Object.values(report.audits ?? {})
  .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'notApplicable')
  .map((a) => ({
    id: a.id,
    title: a.title,
    score: a.score,
    display: a.displayValue ?? null,
    detail: (a.description ?? '').split('. ')[0],
  }))
  .slice(0, 25)

const summary = {
  url,
  finalUrl: report.finalDisplayedUrl ?? report.finalUrl ?? url,
  fetchedAt: new Date().toISOString(),
  lighthouse: report.lighthouseVersion,
  scores,
  failures,
}

mkdirSync(path.dirname(base), { recursive: true })
writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2) + '\n')

const scoreRows = Object.entries(scores)
  .map(([id, s]) => `| ${s.title} | ${s.score == null ? '—' : s.score} |`)
  .join('\n')
const failRows = failures
  .filter((f) => f.score !== null)
  .map((f) => `| ${f.title} | ${f.display ?? Math.round((f.score ?? 0) * 100)} |`)
  .join('\n')

const md = `## Audit — ${url}

> Lighthouse ${report.lighthouseVersion} · ${summary.fetchedAt} · ${summary.finalUrl}

| Category | Score |
|---|---|
${scoreRows}

${failures.length ? `### Findings\n\n| Finding | Detail |\n|---|---|\n${failRows}\n\nFix or waive each one in \`review.md\`. A score is not a pass: name the finding you accepted and why.` : 'No failing audits.'}
`
writeFileSync(`${base}.md`, md)

console.log('')
console.table(Object.fromEntries(Object.entries(scores).map(([id, s]) => [s.title, s.score])))
console.log(`→ ${rel(`${base}.json`)}`)
console.log(`→ ${rel(`${base}.md`)}`)
console.log(`${failures.length} finding(s) — review.md records each fix or waiver.`)
