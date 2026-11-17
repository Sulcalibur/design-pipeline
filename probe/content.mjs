#!/usr/bin/env node
/**
 * probe/content.mjs — the completeness gate for pages and the content model.
 *
 * Two jobs:
 *   1. a content model (`content-model.json`) is valid, navigable and has the
 *      fields a page needs to be published;
 *   2. rendered pages carry the content they claim: one h1, real titles and
 *      descriptions, alt text, no empty links, no placeholders, no noindex.
 *
 *   node content.mjs --config docs/design/home/probe.config.json --url https://acme.test/
 *   node content.mjs --project . --sitemap https://acme.test/sitemap.xml
 *   node content.mjs --project . --model content-model.json
 *
 * Writes docs/design/<slug>/content.md (or docs/content.md). Exits 1 on a
 * blocking find.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import {
  Report,
  fetchText,
  parseHtml,
  walkFiles,
  resolveContext,
  writeDoc,
} from './checks.mjs'

const FIELD_TYPES = new Set(['string', 'text', 'richtext', 'number', 'boolean', 'date', 'datetime', 'image', 'file', 'relation', 'json', 'select'])
const PLACEHOLDERS = [/lorem ipsum/i, /dolor sit amet/i, /\bTBD\b/, /\bTODO\b/, /\bXXX\b/, /coming soon/i, /your title here/i]

/* --------------------------------------------------------------- the model -- */

export function reviewModel(report, model, file) {
  const collections = model.collections
  const blocks = model.blocks ?? []
  if (!Array.isArray(collections)) {
    report.add('blocking', 'model-shape', `${file}: "collections" must be an array`)
    return
  }
  const names = new Set()
  const allNames = new Set(collections.map((c) => c?.name).filter(Boolean))
  for (const c of collections) {
    const where = `collection ${c?.name ?? '(unnamed)'}`
    if (!c?.name) {
      report.add('blocking', 'model-name', `${file}: a collection has no name`)
      continue
    }
    if (names.has(c.name)) report.add('blocking', 'model-duplicate', `${where}: duplicate name`)
    names.add(c.name)
    if (!['collection', 'singleton'].includes(c.kind)) report.add('major', 'model-kind', `${where}: kind must be collection or singleton`)
    if (!Array.isArray(c.fields) || !c.fields.length) {
      report.add('blocking', 'model-fields', `${where}: no fields`)
      continue
    }
    const fieldNames = new Set()
    for (const f of c.fields) {
      if (!f?.name) {
        report.add('major', 'field-name', `${where}: a field has no name`)
        continue
      }
      if (fieldNames.has(f.name)) report.add('major', 'field-duplicate', `${where}: duplicate field "${f.name}"`)
      fieldNames.add(f.name)
      if (!FIELD_TYPES.has(f.type)) report.add('major', 'field-type', `${where}.${f.name}: type "${f.type}" is not in the contract`)
      if (f.type === 'relation' && f.to && !allNames.has(f.to)) {
        report.add('major', 'relation-target', `${where}.${f.name}: relation points at unknown collection "${f.to}"`)
      }
    }
    if (c.kind === 'collection') {
      if (!c.slugField) report.add('major', 'slug-missing', `${where}: collections need a slugField`)
      else if (!fieldNames.has(c.slugField)) report.add('blocking', 'slug-field', `${where}: slugField "${c.slugField}" is not a field`)
      else {
        const f = c.fields.find((x) => x.name === c.slugField)
        if (f.type !== 'string') report.add('major', 'slug-type', `${where}: slugField must be a string`)
      }
    }
    if (c.kind === 'singleton' && c.slugField) report.add('minor', 'singleton-slug', `${where}: a singleton does not need a slug`)
    if (c.seo) {
      for (const need of ['title', 'description']) {
        if (!fieldNames.has(need)) report.add('major', 'seo-field', `${where}: seo is on but there is no "${need}" field`)
      }
    }
    report.row(`model · ${c.name}`, `${c.kind} · ${c.fields.length} fields${c.seo ? ' · seo' : ''}`)
  }

  for (const b of blocks) {
    const where = `block ${b?.name ?? '(unnamed)'}`
    if (!b?.name) report.add('major', 'block-name', `${file}: a block has no name`)
    else if (names.has(b.name)) report.add('major', 'block-duplicate', `${where}: name collides with a collection`)
    if (!Array.isArray(b.fields) || !b.fields.length) report.add('major', 'block-fields', `${where}: no fields`)
    else {
      for (const f of b.fields) {
        if (!FIELD_TYPES.has(f?.type)) report.add('minor', 'block-type', `${where}.${f?.name ?? '?'}: unknown type "${f?.type}"`)
      }
      report.row(`model · ${b.name}`, `block · ${b.fields.length} fields`)
    }
  }
}

/* ------------------------------------------------------------------- pages -- */

function checkPage(report, page, seenTitles, stage) {
  const label = new URL(page.url).pathname || '/'
  const f = parseHtml(page.body, page.url)

  if (!f.title) report.add('major', 'title-missing', `${label}: no <title>`)
  else {
    if (f.title.length > 60) report.add('minor', 'title-long', `${label}: title is ${f.title.length} chars (aim ≤60)`)
    if (f.title.length < 15) report.add('minor', 'title-short', `${label}: title is only ${f.title.length} chars`)
    if (seenTitles.has(f.title)) report.add('major', 'title-duplicate', `${label}: same title as ${seenTitles.get(f.title)}`)
    else seenTitles.set(f.title, label)
  }

  if (!f.description) report.add('major', 'description-missing', `${label}: no meta description`)
  else if (f.description.length < 50 || f.description.length > 160) {
    report.add('minor', 'description-length', `${label}: description is ${f.description.length} chars (aim 50–160)`)
  }

  const h1 = f.headings.filter((h) => h.level === 1)
  if (h1.length !== 1) report.add('major', 'h1-count', `${label}: ${h1.length} h1 element(s) (exactly one)`)
  let previous = 0
  for (const h of f.headings) {
    if (previous && h.level > previous + 1) report.add('minor', 'heading-jump', `${label}: h${previous} → h${h.level} ("${h.text.slice(0, 40)}")`)
    previous = h.level
  }

  if (!f.lang) report.add('major', 'lang-missing', `${label}: <html lang> is absent`)
  if (!f.viewport) report.add('major', 'viewport-missing', `${label}: no viewport meta`)
  if (!f.canonical) report.add('minor', 'canonical-missing', `${label}: no canonical link`)
  else if (!/^https?:\/\//i.test(f.canonical)) report.add('minor', 'canonical-relative', `${label}: canonical is not absolute (${f.canonical})`)
  if (/noindex/i.test(f.robots ?? '')) report.add('blocking', 'noindex', `${label}: robots meta says noindex`)

  const missingAlt = f.images.filter((i) => !i.hasAlt && !i.ariaHidden && i.role !== 'presentation')
  if (missingAlt.length) {
    report.add('major', 'alt-missing', `${label}: ${missingAlt.length} image(s) without an alt attribute (${missingAlt.slice(0, 3).map((i) => i.src).join(', ')})`)
  }

  const emptyLinks = f.anchors.filter(
    (a) =>
      !a.text &&
      !a.label &&
      !a.title &&
      !a.imgAlt &&
      !a.ariaHidden &&
      a.tabindex !== '-1' &&
      a.href &&
      a.href !== '#' &&
      !/^javascript:/i.test(a.href),
  )
  if (emptyLinks.length) report.add('major', 'link-empty', `${label}: ${emptyLinks.length} link(s) with no accessible text`)

  for (const re of PLACEHOLDERS) {
    if (re.test(f.text)) {
      const mock = stage === 'layout'
      report.add(mock ? 'info' : 'blocking', mock ? 'mock-copy' : 'placeholder', `${label}: matches ${re}${mock ? ' (allowed at layout)' : ''}`)
    }
  }
  if (/data-mock\b|\bmock:/i.test(page.body)) {
    const mock = stage === 'layout'
    report.add(mock ? 'info' : 'blocking', mock ? 'mock-marked' : 'mock-shipped', `${label}: carries an explicit mock marker${mock ? ' (allowed at layout)' : ' — mock content must not reach build or launch'}`)
  }

  const words = f.text.split(/\s+/).filter(Boolean).length
  report.row(label, `${words} words · ${f.headings.length} headings · ${f.images.length} images`)
  if (words < 150) report.add('minor', 'thin-content', `${label}: ${words} words — thin for an indexable page`)

  if (!Object.keys(f.og).length) report.add('minor', 'og-missing', `${label}: no Open Graph tags`)
}

/* --------------------------------------------------------------------- run -- */

export function reviewContent({ project, urls = [], sitemap = null, modelPath = null, srcDir = null, limit = 20, stage = 'build' }) {
  const report = new Report('Content review')
  const seenTitles = new Map()
  if (stage === 'layout') {
    report.note('Layout stage: mock copy and lorem are allowed, but they must be marked and must not reach build or launch. Never mock a number, quote, testimonial or logo.')
  }

  if (modelPath) {
    const file = path.resolve(project, modelPath)
    if (!existsSync(file)) report.add('blocking', 'model-missing', `${modelPath} does not exist`)
    else {
      try {
        reviewModel(report, JSON.parse(readFileSync(file, 'utf8')), rel(file))
      } catch (e) {
        report.add('blocking', 'model-json', `${modelPath}: ${e.message}`)
      }
    }
  }

  return (async () => {
    let targets = [...urls]
    if (sitemap) {
      const sm = await fetchText(sitemap)
      if (!sm.ok) report.add('blocking', 'sitemap-unreachable', `${sitemap} — ${sm.error ?? sm.status}`)
      else {
        const locs = [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
        targets.push(...locs)
        report.row('sitemap', `${locs.length} URL(s)`)
      }
    }
    targets = [...new Set(targets)].slice(0, limit)

    for (const url of targets) {
      const page = await fetchText(url)
      if (!page.ok) {
        report.add('blocking', 'url-unreachable', `${url} — ${page.error ?? page.status}`)
        continue
      }
      checkPage(report, page, seenTitles, stage)
    }

    if (srcDir) {
      const files = walkFiles(path.resolve(project, srcDir), ['.md', '.html', '.vue', '.svelte', '.tsx', '.jsx', '.json'])
      for (const file of files) {
        const raw = readFileSync(file, 'utf8')
        for (const re of PLACEHOLDERS) {
          if (re.test(raw)) {
            const mock = stage === 'layout'
            report.add(mock ? 'info' : 'major', mock ? 'mock-copy-source' : 'placeholder-source', `${rel(file)}: matches ${re}${mock ? ' (allowed at layout)' : ''}`)
          }
        }
        if (/data-mock\b|\bmock:/i.test(raw)) {
          const mock = stage === 'layout'
          report.add(mock ? 'info' : 'blocking', mock ? 'mock-marked-source' : 'mock-shipped-source', `${rel(file)}: carries an explicit mock marker${mock ? ' (allowed at layout)' : ' — remove before build'}`)
        }
        const imgs = [...raw.matchAll(/<img\b[^>]*>/gi)].filter((m) => !/\balt\s*=/i.test(m[0]))
        if (imgs.length) report.add('major', 'alt-source', `${rel(file)}: ${imgs.length} <img> without alt`)
        const empties = [...raw.matchAll(/<a\b[^>]*>\s*<\/a>/gi)]
        if (empties.length) report.add('major', 'link-source', `${rel(file)}: ${empties.length} empty link(s)`)
      }
      report.row('source files', String(files.length))
    }

    if (!targets.length && !modelPath && !srcDir) {
      report.add('blocking', 'no-target', 'nothing to check: pass --url, --sitemap, --model or --src')
    }

    return report
  })()
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
  const stage = args.get('stage', 'build')
  if (!['layout', 'build', 'launch'].includes(stage)) fail('--stage must be layout, build or launch')
  const report = await reviewContent({
    project: ctx.project,
    urls,
    sitemap: args.get('sitemap', null),
    modelPath: args.get('model', null),
    srcDir: args.get('src', null),
    limit: Number(args.get('limit', 20)),
    stage,
  })

  if (args.has('json')) console.log(JSON.stringify(report.json(), null, 2))
  else {
    process.stdout.write(report.render({ intro: `Project: ${ctx.project}` }))
    if (!args.has('no-write')) {
      const file = writeDoc(ctx.docDir, 'content.md', report.render({ intro: `Project: ${ctx.project}` }))
      console.log(`\n→ ${rel(file)}`)
    }
  }
  process.exit(report.blocking ? 1 : 0)
}
