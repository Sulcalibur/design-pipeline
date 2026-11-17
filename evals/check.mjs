#!/usr/bin/env node
/**
 * evals/check.mjs — did an artifact obey the context it was given?
 *
 * Not a design critique. It checks the things a context can make checkable:
 * one h1, lang and title, banned words, case expectations, colours that are not
 * in the tokens, and mock copy that should not have shipped.
 *
 *   node evals/check.mjs --file artifact.html --case work-index \
 *        --brand handoff/brand.json --tokens handoff/tokens.json
 *
 * Exit 1 on a failed check. `--json` for machine output.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from '../probe/paths.mjs'
import { parseHtml, slotValue, listFrom } from '../probe/checks.mjs'

const here = import.meta.dirname
const args = parseArgs(process.argv.slice(2))
const file = args.get('file')
if (!file || !existsSync(file)) {
  console.error('usage: node evals/check.mjs --file <artifact.html> --case <id> [--brand brand.json] [--tokens tokens.json] [--json]')
  process.exit(1)
}
const caseId = args.get('case', 'work-index')
const cases = JSON.parse(readFileSync(path.join(here, 'cases.json'), 'utf8')).cases ?? []
const testCase = cases.find((c) => c.id === caseId)
if (!testCase) {
  console.error(`unknown case "${caseId}" — one of: ${cases.map((c) => c.id).join(', ')}`)
  process.exit(1)
}

const html = readFileSync(file, 'utf8')
const facts = parseHtml(html)
const results = []
const check = (ok, label, detail = '') => results.push({ ok, label, detail })

/* --------------------------------------------------------------- structure -- */

const h1 = facts.headings.filter((h) => h.level === 1).length
check(h1 === (testCase.h1 ?? 1), 'one h1', `${h1} found`)
check(!!facts.lang, 'html lang', facts.lang ?? 'missing')
check(!!facts.title, 'page title', facts.title ?? 'missing')

/* ------------------------------------------------------------------ voice -- */

const brandPath = args.get('brand')
let banned = []
if (brandPath && existsSync(brandPath)) {
  const brand = JSON.parse(readFileSync(brandPath, 'utf8'))
  banned = listFrom(slotValue(brand, 'c1-banned'))
    .flatMap((entry) => String(entry).replace(/\([^)]*\)/g, '').split(/\s*\/\s*/))
    .map((t) => t.trim())
    .filter((t) => t && t.split(/\s+/).length <= 4)
}
const text = facts.text.toLowerCase()
for (const term of banned) {
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  check(!re.test(text), `banned word: ${term}`, re.test(text) ? 'found' : '')
}

/* ------------------------------------------------------------------ tokens -- */

const tokenPath = args.get('tokens')
if (tokenPath && existsSync(tokenPath)) {
  const tokens = JSON.parse(readFileSync(tokenPath, 'utf8'))
  const props = tokens.properties ?? tokens
  const known = new Set(
    Object.values(props).flatMap((v) => [...String(v).matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase())),
  )
  const used = [...new Set([...html.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase()))]
  const unknown = used.filter((h) => !known.has(h))
  check(unknown.length === 0, 'colours come from the tokens', unknown.join(', '))

  const fontProps = Object.entries(props).filter(([k]) => /font/i.test(k))
  const knownFamilies = new Set(
    fontProps
      .flatMap(([, v]) => String(v).split(','))
      .map((f) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
      .filter(Boolean),
  )
  const generic = new Set([
    'serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
    'georgia', 'times new roman', 'arial', 'helvetica', 'menlo', 'consolas', 'inherit', 'initial',
  ])
  const usedFamilies = [...html.matchAll(/font-family\s*:\s*([^;}]+)/gi)]
    .flatMap((m) => m[1].split(','))
    .map((f) => f.trim().replace(/^['"]|['"]$/g, '').split(/\s+/).slice(0, 3).join(' ').toLowerCase())
    .filter((f) => f && !f.startsWith('var('))
  const unknownFamilies = [...new Set(usedFamilies)].filter((f) => !knownFamilies.has(f) && !generic.has(f))
  check(unknownFamilies.length === 0, 'fonts come from the tokens', unknownFamilies.join(', '))
  check(!/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(html), 'no external font stylesheet')
}

/* -------------------------------------------------------------- case rules -- */

for (const pattern of testCase.expect ?? []) {
  check(new RegExp(pattern, 'i').test(html), `expects /${pattern}/`)
}
for (const pattern of testCase.forbid ?? []) {
  check(!new RegExp(pattern, 'i').test(html), `forbids /${pattern}/`)
}
if (!testCase.allowMock) {
  const mock = /lorem ipsum|data-mock\b|\bmock:/i.test(html)
  check(!mock, 'no mock copy shipped', mock ? 'found a placeholder or mock marker' : '')
}

/* ----------------------------------------------------------------- report -- */

const failed = results.filter((r) => !r.ok)
if (args.has('json')) {
  console.log(JSON.stringify({ file, case: caseId, passed: results.length - failed.length, failed: failed.length, results }, null, 2))
} else {
  console.log(`\neval ${caseId} — ${path.basename(file)}\n`)
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`)
  console.log(`\n${results.length - failed.length} passed · ${failed.length} failed`)
  if (failed.length) console.log('This is a mechanical check. It says nothing about whether the design is good.\n')
}
process.exit(failed.length ? 1 : 0)
