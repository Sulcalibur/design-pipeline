import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const run = (script, args, cwd) =>
  spawnSync(process.execPath, [path.join(root, 'probe', script), ...args], { encoding: 'utf8', cwd })

function project() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'probe-refs-'))
  writeFileSync(path.join(dir, 'shot.png'), 'not really a png')
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      items: [
        { id: 'good', name: 'Good', file: 'shot.png', url: 'https://example.com/', device: 'name-as-poster', avoid: 'cream palette', fits: 'hero', evidence: '1440' },
        { id: 'picture', name: 'Picture', file: 'shot.png', url: 'https://example.com/' },
      ],
    }),
  )
  return dir
}

test('refs blocks a capture with no device', () => {
  const dir = project()
  const out = run('refs.mjs', ['--project', dir, '--dir', '.', '--html', 'refs.html'], dir)
  assert.equal(out.status, 1)
  assert.match(out.stdout, /1 blocked/)
  assert.ok(existsSync(path.join(dir, 'refs.html')))
  assert.match(readFileSync(path.join(dir, 'refs.html'), 'utf8'), /no device/)
})

test('refs passes once every capture has a device and an avoid', () => {
  const dir = project()
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  manifest.items[1].device = 'index-as-gallery'
  manifest.items[1].avoid = 'illustration style'
  manifest.items[1].fits = 'a work index'
  manifest.items[1].evidence = '1440 viewport'
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  const out = run('refs.mjs', ['--project', dir, '--dir', '.', '--html', 'refs.html'], dir)
  assert.equal(out.status, 0)
  assert.match(out.stdout, /2 complete/)
})

test('refs treats an unsorted placeholder as unsorted, not as a device', () => {
  const dir = project()
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  for (const item of manifest.items) {
    item.device = 'unsorted — classify before borrowing'
    item.avoid = 'unsorted — name what not to copy'
    item.fits = 'candidate'
    item.evidence = 'inspire'
  }
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  const out = run('refs.mjs', ['--project', dir, '--dir', '.', '--html', 'refs.html'], dir)
  assert.equal(out.status, 1)
  assert.match(out.stdout, /2 blocked/)
  assert.match(readFileSync(path.join(dir, 'refs.html'), 'utf8'), /device not named/)
})
