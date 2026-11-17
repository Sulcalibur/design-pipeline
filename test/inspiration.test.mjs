import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { connectMcp } from '../probe/mcp.mjs'
import {
  candidatesFromAwwwards,
  candidatesFromPinterest,
  eagleTarget,
  enabledSourceNames,
  inspirationSettings,
  nextSlug,
  pickMixed,
  readFeed,
  urlKey,
  usedSlugsFromManifest,
} from '../probe/inspiration.mjs'

test('defaults keep Awwwards on and everything else off', () => {
  const settings = inspirationSettings({})
  assert.equal(settings.sources.awwwards.enabled, true)
  assert.equal(settings.sources.pinterest.enabled, false)
  assert.equal(settings.sources.feed.enabled, false)
  assert.equal(settings.count, 4)
  assert.deepEqual(enabledSourceNames(settings), ['awwwards'])
})

test('a written sources block is authoritative', () => {
  const settings = inspirationSettings({
    inspiration: { sources: { pinterest: { enabled: true, query: 'editorial' } } },
  })
  assert.equal(settings.sources.awwwards.enabled, false)
  assert.equal(settings.sources.pinterest.enabled, true)
  assert.equal(settings.sources.pinterest.query, 'editorial')
  assert.equal(settings.sources.pinterest.limit, 30)
})

test('unknown source names are reported instead of silently run', () => {
  const settings = inspirationSettings({ inspiration: { sources: { mobbin: { enabled: true } } } })
  assert.deepEqual(settings.unknownSources, ['mobbin'])
  assert.deepEqual(enabledSourceNames(settings), [])
})

test('Awwwards compact lines become candidates and the +N tag count is stripped', () => {
  const result = {
    content: [
      {
        type: 'text',
        text: [
          '307 site(s) matched; showing 1-2:',
          '',
          '1. SANTAL (slug: santal) | live: https://santalarch.com | awards: Site of the Day | tags: Architecture, Infinite Scroll, Scrolling +8',
          '2. Preymaker (slug: preymaker) | live: https://preymaker.com/ | tags: Design Agencies, Film & TV',
          'Preview #1: santal',
        ].join('\n'),
      },
      { type: 'image', data: 'ignored' },
    ],
  }
  const candidates = candidatesFromAwwwards(result)
  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].url, 'https://santalarch.com')
  assert.equal(candidates[0].slug, 'santal')
  assert.deepEqual(candidates[0].tags, ['Architecture', 'Infinite Scroll', 'Scrolling'])
  assert.equal(candidates[1].title, 'Preymaker')
})

test('Awwwards structured output wins over text', () => {
  const candidates = candidatesFromAwwwards({
    structuredContent: { sites: [{ title: 'Structured', slug: 'structured', liveUrl: 'https://structured.example/' }] },
    content: [{ type: 'text', text: '1. Text (slug: text) | live: https://text.example' }],
  })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].url, 'https://structured.example/')
})

test('Pinterest pins without a source page are counted, not silently dropped', () => {
  const payload = {
    pins: [
      { title: 'Has a page', source_link: 'https://example.com/landing', image_url: 'https://i.pinimg.com/a.jpg' },
      { title: 'Image only', image_url: 'https://i.pinimg.com/b.jpg' },
    ],
  }
  const parsed = candidatesFromPinterest({ content: [{ type: 'text', text: JSON.stringify(payload) }] })
  assert.equal(parsed.candidates.length, 1)
  assert.equal(parsed.candidates[0].url, 'https://example.com/landing')
  assert.equal(parsed.skipped, 1)
})

test('a feed accepts strings and objects, and rejects a missing URL loudly', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'probe-feed-'))
  const file = path.join(dir, 'feed.json')
  writeFileSync(file, JSON.stringify([{ url: 'https://one.example/', title: 'One' }, 'https://two.example/']))
  const candidates = readFeed(file)
  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].title, 'One')
  assert.equal(candidates[1].source, 'feed')

  writeFileSync(file, JSON.stringify([{ title: 'No URL' }]))
  assert.throws(() => readFeed(file), /no http\(s\) url/)
})

test('picking is deterministic per seed, balanced across sources and deduplicated', () => {
  const pools = [
    {
      source: 'awwwards',
      candidates: [
        { url: 'https://a.example/1' },
        { url: 'https://a.example/2' },
        { url: 'https://a.example/3' },
      ],
    },
    {
      source: 'pinterest',
      candidates: [{ url: 'https://b.example/1' }, { url: 'https://a.example/1#hash' }],
    },
  ]
  const first = pickMixed(pools, 4, 'seed-1')
  const second = pickMixed(pools, 4, 'seed-1')
  assert.deepEqual(first.map((c) => c.url), second.map((c) => c.url))
  assert.equal(first.length, 4)
  assert.deepEqual(new Set(first.map((c) => urlKey(c.url))).size, 4)
  assert.deepEqual(new Set(first.map((c) => c.source)), new Set(['awwwards', 'pinterest']))

  const different = pickMixed(pools, 4, 'seed-2')
  assert.notDeepEqual(first.map((c) => c.url), different.map((c) => c.url))
})

test('Eagle mode is a promise: on fails when the app is closed', () => {
  assert.equal(eagleTarget('auto', true), 'eagle')
  assert.equal(eagleTarget('auto', false), 'folder')
  assert.equal(eagleTarget('off', true), 'folder')
  assert.equal(eagleTarget('eagle', true), 'eagle')
  assert.throws(() => eagleTarget('on', false), /Eagle is not running/)
})

test('slugs stay unique across a manifest and a second run', () => {
  const used = usedSlugsFromManifest({ items: [{ id: 'santal-1440' }, { id: 'preymaker-1440' }] })
  assert.equal(nextSlug('santal', used), 'santal-2')
  assert.equal(nextSlug('new-site.example', used), 'new-site-example')
  assert.equal(nextSlug('santal', used), 'santal-3')
})

test('the MCP client initialises, calls a tool and closes', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'probe-mcp-'))
  const server = path.join(dir, 'server.mjs')
  writeFileSync(
    server,
    `import { createInterface } from 'node:readline'
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } } }))
  } else if (message.method === 'tools/call') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, name: message.params.name }) }] } }))
  }
})
`,
  )
  const client = await connectMcp({ command: process.execPath, args: [server], label: 'fake', timeoutMs: 5000 })
  try {
    const result = await client.callTool('search_sites', { query: 'x' })
    const text = result.content[0].text
    assert.deepEqual(JSON.parse(text), { ok: true, name: 'search_sites' })
  } finally {
    client.close()
  }
})
