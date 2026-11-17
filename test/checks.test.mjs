import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHtml, contrast, listFrom, stripHtml } from '../probe/checks.mjs'
import { mediaUrl } from '../probe/library.mjs'

test('contrast returns the WCAG ratio', () => {
  assert.equal(contrast('#122821', '#fbf9f5'), 14.78)
  assert.equal(contrast('#ffffff', '#ffffff'), 1)
})

test('parseHtml reads the facts a page gate needs', () => {
  const html = `<!doctype html><html lang="en-GB"><head>
    <title>Test page</title>
    <meta name="description" content="A description">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="https://example.com/">
  </head><body>
    <h1>One</h1><h3>Skip</h3>
    <img src="a.png" alt="A picture">
    <img src="b.png">
    <a href="/x">A link</a>
    <a href="/y"><img src="c.png" alt="Nested"></a>
    <a href="/z" aria-label="Labelled"></a>
  </body></html>`
  const f = parseHtml(html, 'https://example.com/')
  assert.equal(f.title, 'Test page')
  assert.equal(f.description, 'A description')
  assert.equal(f.lang, 'en-GB')
  assert.equal(f.canonical, 'https://example.com/')
  assert.deepEqual(f.headings.map((h) => h.level), [1, 3])
  assert.equal(f.images.filter((i) => !i.hasAlt).length, 1)
  assert.equal(f.anchors.find((a) => a.href === '/y').imgAlt, 'Nested')
  assert.equal(f.anchors.find((a) => a.href === '/z').label, 'Labelled')
})

test('stripHtml removes scripts and keeps text', () => {
  assert.equal(stripHtml('<script>alert(1)</script><p>Hello &amp; bye</p>'), 'Hello & bye')
})

test('listFrom accepts arrays and bullet strings', () => {
  assert.deepEqual(listFrom(['a', 'b']), ['a', 'b'])
  assert.deepEqual(listFrom('- a\n- b'), ['a', 'b'])
  assert.deepEqual(listFrom(null), [])
})

test('mediaUrl accepts a template or a bare base', () => {
  assert.equal(mediaUrl('http://host:41532/api/items/{id}/file', 'ABC'), 'http://host:41532/api/items/ABC/file')
  assert.equal(mediaUrl('http://host:41532/', 'ABC'), 'http://host:41532/api/items/ABC/file')
  assert.equal(mediaUrl(null, 'ABC'), null)
})
