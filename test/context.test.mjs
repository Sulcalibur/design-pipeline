import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const run = (script, args, cwd) =>
  spawnSync(process.execPath, [path.join(root, 'probe', script), ...args], { encoding: 'utf8', cwd })

function project() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'probe-ctx-'))
  mkdirSync(path.join(dir, 'docs/brand'), { recursive: true })
  mkdirSync(path.join(dir, 'docs/design/demo'), { recursive: true })
  writeFileSync(
    path.join(dir, 'docs/brand/brand.json'),
    JSON.stringify({
      product: 'Test product',
      slots: {
        product: { value: 'Test product', status: 'verified', source: 'test' },
        oneLine: { value: 'A test site', status: 'verified', source: 'test' },
        b1: { value: 'A visitor understands the test', status: 'verified', source: 'test' },
        a2: { value: 'Testers', status: 'verified', source: 'test' },
        'c1-banned': { value: ['seamless', 'revolutionary'], status: 'assumption', source: 'test' },
        'c1-rules': { value: ['First person, plain English'], status: 'assumption', source: 'test' },
        v8: { value: ['gradients', 'stock photography'], status: 'verified', source: 'test' },
        'v2-paper': { value: '#fbf9f5', status: 'verified', source: 'test' },
        'v2-ink': { value: '#122821', status: 'verified', source: 'test' },
        'v3-display': { value: 'Fraunces', status: 'verified', source: 'test' },
        'v3-body': { value: 'Newsreader', status: 'verified', source: 'test' },
        'v3-ui': { value: 'IBM Plex Mono', status: 'verified', source: 'test' },
      },
    }),
  )
  writeFileSync(
    path.join(dir, 'docs/design/demo/00-brief.md'),
    `# Brief\n\n## One line\n\nA test site.\n\n## Success criteria\n\n- [ ] First criterion that wraps\n  onto a second line.\n- [ ] Second criterion.\n`,
  )
  writeFileSync(
    path.join(dir, 'docs/design/demo/02-direction.md'),
    `# Direction\n\n## Decision + what it gives up\n\nCommitted: the test direction.\n\n## Direction contract (binds all builds)\n\n| Slot | Decision |\n|---|---|\n| Accent | #2F7A5F |\n\n## Forbidden list\n\n- gradients\n`,
  )
  mkdirSync(path.join(dir, 'app/assets/css'), { recursive: true })
  writeFileSync(path.join(dir, 'app/assets/css/tokens.css'), ':root{--accent:#5b21b6;--ink:#122821;--page:#fbf9f5;}\n')
  writeFileSync(path.join(dir, 'mock.md'), 'Lorem ipsum dolor sit amet.\n')
  mkdirSync(path.join(dir, 'mockdir'))
  writeFileSync(path.join(dir, 'mockdir/mock.html'), '<p>Lorem ipsum dolor sit amet</p><div data-mock>Mock headline</div>')
  return dir
}

test('context compiles a handoff and flags a stale contract hex', () => {
  const dir = project()
  const out = run('context.mjs', ['--project', dir, '--target', 'agent', '--scope', 'Test screen'], dir)
  assert.equal(out.status, 0, out.stderr)
  const context = readFileSync(path.join(dir, 'docs/design/demo/handoff/context.md'), 'utf8')
  assert.match(context, /A test site/)
  assert.match(context, /First criterion that wraps onto a second line/)
  assert.match(context, /seamless/)
  assert.match(context, /gradients/)
  assert.match(context, /Stale contract values:\*\* #2f7a5f/)
  assert.match(context, /Mock content/)
  assert.ok(existsSync(path.join(dir, 'docs/design/demo/handoff/tokens.json')))
  const manifest = JSON.parse(readFileSync(path.join(dir, 'docs/design/demo/handoff/handoff.json'), 'utf8'))
  assert.equal(manifest.target, 'agent')
  assert.equal(manifest.scope, 'Test screen')
})

test('mock copy is allowed at layout and reported at build', () => {
  const dir = project()
  const layout = run('copy.mjs', ['--project', dir, '--src', path.join(dir, 'mock.md'), '--stage', 'layout', '--no-write'], dir)
  assert.equal(layout.status, 0)
  assert.match(layout.stdout, /allowed at layout/)
  const build = run('copy.mjs', ['--project', dir, '--src', path.join(dir, 'mock.md'), '--stage', 'build', '--no-write'], dir)
  assert.equal(build.status, 0)
  assert.match(build.stdout, /placeholder/)
  assert.doesNotMatch(build.stdout, /allowed at layout/)
})

test('content allows marked mock at layout and blocks it at build', () => {
  const dir = project()
  const layout = run('content.mjs', ['--project', dir, '--src', path.join(dir, 'mockdir'), '--stage', 'layout', '--no-write'], dir)
  assert.equal(layout.status, 0)
  assert.match(layout.stdout, /allowed at layout/)
  const build = run('content.mjs', ['--project', dir, '--src', path.join(dir, 'mockdir'), '--stage', 'build', '--no-write'], dir)
  assert.equal(build.status, 1)
  assert.match(build.stdout, /mock-shipped-source/)
})
