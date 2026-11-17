import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const run = (args, cwd) =>
  spawnSync(process.execPath, [path.join(root, 'probe', 'ask.mjs'), ...args], { encoding: 'utf8', cwd })

function project() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'probe-ask-'))
  mkdirSync(path.join(dir, 'docs/brand'), { recursive: true })
  mkdirSync(path.join(dir, 'docs/design/demo'), { recursive: true })
  writeFileSync(
    path.join(dir, 'docs/brand/brand.json'),
    JSON.stringify({
      product: 'Test',
      slots: {
        product: { value: 'Test', status: 'verified', source: 'test' },
        oneLine: { value: 'A test', status: 'verified', source: 'test' },
        b1: { value: 'A visitor understands the test', status: 'verified', source: 'test' },
        a2: { value: 'Testers', status: 'verified', source: 'test' },
      },
    }),
  )
  writeFileSync(
    path.join(dir, 'docs/design/demo/00-brief.md'),
    '# Brief\n\n## The one job\n\nTest job.\n\n## Reader\n\nTesters.\n\n## Primary action\n\nContact.\n\n## Success criteria\n\n- [ ] One\n- [ ] Two\n\n## Scope\n\n- Home\n',
  )
  return dir
}

test('brief prefills from 00-brief and gates the missing required answer', () => {
  const dir = project()
  const first = run(['--project', dir, '--stage', 'brief', '--check'], dir)
  assert.equal(first.status, 1)
  assert.match(first.stdout, /content/)
  assert.match(first.stdout, /required, unanswered/)

  const answered = run(['--project', dir, '--stage', 'brief', '--answer', 'content=exists', '--status', 'verified'], dir)
  assert.equal(answered.status, 0)
  const check = run(['--project', dir, '--stage', 'brief', '--check'], dir)
  assert.equal(check.status, 0)
  assert.match(check.stdout, /clear/)
})

test('content=none reveals the mock-policy question and it becomes required', () => {
  const dir = project()
  run(['--project', dir, '--stage', 'brief', '--answer', 'content=none'], dir)
  const list = run(['--project', dir, '--stage', 'brief', '--list'], dir)
  assert.doesNotMatch(list.stdout, /mockPolicy\s+hidden/)
  const check = run(['--project', dir, '--stage', 'brief', '--check'], dir)
  assert.equal(check.status, 1)
  assert.match(check.stdout, /mockPolicy/)
  const answered = run(['--project', dir, '--stage', 'brief', '--answer', 'mockPolicy=yes'], dir)
  assert.equal(answered.status, 0)
})

test('a company reveals a branch that a person hides', () => {
  const person = project()
  run(['--project', person, '--stage', 'brand', '--answer', 'kind=person'], person)
  const personList = run(['--project', person, '--stage', 'brand', '--list'], person)
  assert.match(personList.stdout, /owner\s+hidden/)
  assert.match(personList.stdout, /c2\s+hidden/)

  const company = project()
  run(['--project', company, '--stage', 'brand', '--answer', 'kind=company'], company)
  const companyList = run(['--project', company, '--stage', 'brand', '--list'], company)
  assert.doesNotMatch(companyList.stdout, /owner\s+hidden/)
  assert.doesNotMatch(companyList.stdout, /c2\s+hidden/)
})

test('brief ask refuses to guess between several design folders', () => {
  const dir = project()
  mkdirSync(path.join(dir, 'docs/design/other'), { recursive: true })
  const out = run(['--project', dir, '--stage', 'brief', '--next'], dir)
  assert.equal(out.status, 1)
  assert.match(out.stderr, /several design folders/)
  assert.match(out.stderr, /--config/)
})

test('list answers accept commas and semicolons', () => {
  const dir = project()
  const out = run(['--project', dir, '--stage', 'brief', '--answer', 'out=One; Two, Three'], dir)
  assert.equal(out.status, 0)
  const state = JSON.parse(readFileSync(path.join(dir, 'docs/design/demo/interview.json'), 'utf8'))
  assert.deepEqual(state.stages.brief.answers.out.value, ['One', 'Two', 'Three'])
})
