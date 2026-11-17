import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const run = (args, cwd) =>
  spawnSync(process.execPath, [path.join(root, 'probe', 'ask.mjs'), ...args], { encoding: 'utf8', cwd })

function project() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'probe-dir-'))
  mkdirSync(path.join(dir, 'docs/brand'), { recursive: true })
  mkdirSync(path.join(dir, 'docs/design/demo'), { recursive: true })
  writeFileSync(
    path.join(dir, 'docs/brand/brand.json'),
    JSON.stringify({
      product: 'Test',
      slots: {
        product: { value: 'Test', status: 'verified', source: 'test' },
        oneLine: { value: 'A test', status: 'verified', source: 'test' },
        b1: { value: 'A promise', status: 'verified', source: 'test' },
        a2: { value: 'Testers', status: 'verified', source: 'test' },
        'v2-accent': { value: 'emerald band carries the field', status: 'verified', source: 'test' },
        'v3-display': { value: 'Fraunces', status: 'verified', source: 'test' },
        'v3-body': { value: 'Newsreader', status: 'verified', source: 'test' },
        dials: { value: { density: { current: 2, target: 2 }, motion: { current: 2, target: 2 } }, status: 'assumption', source: 'test' },
      },
    }),
  )
  writeFileSync(
    path.join(dir, 'docs/design/demo/02-direction.md'),
    '# Direction\n\n## Decision + what it gives up\n\nCommitted: the test ledger.\n\n## Forbidden list\n\n- gradients\n- stock photography\n',
  )
  return dir
}

test('direction prefills decision, forbidden and dials, then gates the direction questions', () => {
  const dir = project()
  const first = run(['--project', dir, '--stage', 'direction', '--check'], dir)
  assert.equal(first.status, 1)
  assert.match(first.stdout, /referenceBasis/)
  assert.match(first.stdout, /refusal/)
  assert.match(first.stdout, /cost/)

  const list = run(['--project', dir, '--stage', 'direction', '--list'], dir)
  assert.match(list.stdout, /forbidden\s+contract\s+req\s+verified/)
  assert.match(list.stdout, /dials\s+calibration\s+req\s+assumption/)

  run(['--project', dir, '--stage', 'direction', '--answer', 'referenceBasis=no'], dir)
  const branch = run(['--project', dir, '--stage', 'direction', '--list'], dir)
  assert.doesNotMatch(branch.stdout, /distanceReference\s+hidden/)
  assert.match(branch.stdout, /borrowedDevice\s+hidden/)

  for (const answer of [
    'distanceReference=Museum label captioning',
    'opening=statement first',
    'spine=contents page',
    'colourField=field on evidence',
    'refusal=No card grid',
    'cost=Gives up the photograph',
  ]) {
    run(['--project', dir, '--stage', 'direction', '--answer', answer], dir)
  }
  const check = run(['--project', dir, '--stage', 'direction', '--check'], dir)
  assert.equal(check.status, 0, check.stdout)
  assert.match(check.stdout, /clear/)
})

test('a reference pack reveals the borrowed-device branch instead of the distance one', () => {
  const dir = project()
  run(['--project', dir, '--stage', 'direction', '--answer', 'referenceBasis=yes'], dir)
  const list = run(['--project', dir, '--stage', 'direction', '--list'], dir)
  assert.doesNotMatch(list.stdout, /borrowedDevice\s+hidden/)
  assert.match(list.stdout, /distanceReference\s+hidden/)
})
