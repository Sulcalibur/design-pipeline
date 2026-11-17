import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const templates = path.join(root, 'templates')
const run = (args, cwd) =>
  spawnSync(process.execPath, [path.join(root, 'probe', 'start.mjs'), ...args], { encoding: 'utf8', cwd })

function scaffold() {
  const project = mkdtempSync(path.join(os.tmpdir(), 'probe-start-'))
  const slugDir = path.join(project, 'docs/design/demo')
  mkdirSync(slugDir, { recursive: true })
  writeFileSync(path.join(slugDir, 'probe.config.json'), JSON.stringify({ id: 'demo', intake: [], pairs: [], followups: [] }))
  for (const file of ['00-brief.md', '01-references.md', '02-direction.md', '03-structure.md', '04-assets.md', 'review.md']) {
    copyFileSync(path.join(templates, file), path.join(slugDir, file))
  }
  return { project, slugDir }
}

function detect(project) {
  const out = run(['--project', project, '--slug', 'demo', '--json'], project)
  assert.equal(out.status, 0, out.stderr)
  return JSON.parse(out.stdout)
}

test('an empty project recommends setup', () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'probe-start-empty-'))
  const result = detect(project)
  assert.equal(result.recommended.id, '0')
  assert.equal(result.stages.find((stage) => stage.id === '0').status, 'missing')
})

test('a scaffolded project advances brand -> brand review -> intake', () => {
  const { project, slugDir } = scaffold()
  assert.equal(detect(project).recommended.id, '0b')

  mkdirSync(path.join(project, 'docs/brand'), { recursive: true })
  writeFileSync(path.join(project, 'docs/brand/brand.json'), JSON.stringify({ slots: { a1: { value: 'x' } } }))
  assert.equal(detect(project).recommended.id, '0c')

  writeFileSync(path.join(project, 'docs/brand/review.md'), '# Review\n\nNo blocking findings.\n')
  assert.equal(detect(project).recommended.id, '1')

  writeFileSync(path.join(slugDir, '00-brief.md'), '# Brief\n\nA real brief with a checkable success criterion.\n')
  assert.equal(detect(project).recommended.id, '2')
})

test('captures without an authored references doc mark collect partial', () => {
  const { project, slugDir } = scaffold()
  mkdirSync(path.join(slugDir, 'references'), { recursive: true })
  writeFileSync(
    path.join(slugDir, 'references/manifest.json'),
    JSON.stringify({ items: [{ id: 'one-1440', file: 'one.png', device: 'x', avoid: 'y' }] }),
  )
  const result = detect(project)
  const collect = result.stages.find((stage) => stage.id === '2')
  assert.equal(collect.status, 'partial')
  assert.equal(result.recommended.id, '2')
})

test('an authored references doc advances to direction', () => {
  const { project, slugDir } = scaffold()
  mkdirSync(path.join(slugDir, 'references'), { recursive: true })
  writeFileSync(path.join(slugDir, 'references/manifest.json'), JSON.stringify({ items: [{ id: 'one-1440' }] }))
  writeFileSync(path.join(slugDir, '01-references.md'), '# References\n\n| # | Reference | Device |\n|---|---|---|\n| 1 | One | name-as-poster |\n')
  assert.equal(detect(project).recommended.id, '3')
})

test('build-spec advances past direction', () => {
  const { project, slugDir } = scaffold()
  writeFileSync(path.join(slugDir, '02-direction.md'), '# Direction\n\nOne direction, three decisions.\n')
  writeFileSync(path.join(slugDir, 'build-spec.json'), JSON.stringify({ status: 'ready' }))
  assert.equal(detect(project).recommended.id, '4')
})

test('an existing surface starts at audit, then maintain', () => {
  const { project, slugDir } = scaffold()
  const before = run(['--project', project, '--slug', 'demo', '--existing', '--json'], project)
  assert.equal(JSON.parse(before.stdout).recommended.id, '7b')

  writeFileSync(path.join(slugDir, '10-audit-2026-11-17.md'), '# Audit\n\nScored.\n')
  const after = run(['--project', project, '--slug', 'demo', '--existing', '--json'], project)
  assert.equal(JSON.parse(after.stdout).recommended.id, '9')
})

test('a named stage prints its gate and command', () => {
  const { project } = scaffold()
  const out = run(['--project', project, '--slug', 'demo', '--stage', 'direction'], project)
  assert.equal(out.status, 0)
  assert.match(out.stdout, /3 · Direct/)
  assert.match(out.stdout, /ask --stage direction/)
})

test('the full path lists every stage, including maintain', () => {
  const { project } = scaffold()
  const out = run(['--project', project, '--slug', 'demo', '--all'], project)
  assert.equal(out.status, 0)
  assert.match(out.stdout, /full path/)
  assert.match(out.stdout, /9 Maintain/)
  assert.match(out.stdout, /7b Audit/)
})

test('an unknown stage fails with the known ids', () => {
  const { project } = scaffold()
  const out = run(['--project', project, '--slug', 'demo', '--stage', 'paint'], project)
  assert.equal(out.status, 1)
  assert.match(out.stderr, /unknown stage/)
})

test('a blocked brand review is not marked done', () => {
  const { project } = scaffold()
  mkdirSync(path.join(project, 'docs/brand'), { recursive: true })
  writeFileSync(path.join(project, 'docs/brand/brand.json'), JSON.stringify({ slots: { a1: { value: 'x' } } }))
  writeFileSync(
    path.join(project, 'docs/brand/review.md'),
    '# Brand review\n\n**Blocked.** 1 blocking finding(s) must be fixed or waived with a reason.\n',
  )
  const result = detect(project)
  const review = result.stages.find((stage) => stage.id === '0c')
  assert.equal(review.status, 'partial')
  assert.match(review.detail, /gate blocked/)
  assert.equal(result.recommended.id, '0c')
})

test('commands name the engine wrapper so they run from the project', () => {
  const { project } = scaffold()
  const brand = detect(project).stages.find((stage) => stage.name === 'brand')
  assert.match(brand.commands[0], /\/bin\/probe brand scaffold/)
  assert.doesNotMatch(brand.commands[0], /^bin\/probe /)
})
