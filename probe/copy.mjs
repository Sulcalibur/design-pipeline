#!/usr/bin/env node
/**
 * probe/copy.mjs — the voice gate.
 *
 * Reads copy from a URL or from the files a project keeps it in, then checks it
 * against the brand record's own rules: banned words, forbidden territory,
 * first-person voice, UK spelling, exclamation budget, placeholders and
 * sentence length. It does not rewrite; the owner does.
 *
 *   node copy.mjs --config docs/design/home/probe.config.json --url https://acme.test/
 *   node copy.mjs --project . --src app/pages,content --write
 *   node copy.mjs --project . --url https://acme.test/about --json
 *
 * Writes docs/design/<slug>/copy.md (or docs/copy.md). Exits 1 on a blocking find.
 */
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import {
  Report,
  brandList,
  fetchText,
  parseHtml,
  textFromFile,
  walkFiles,
  resolveContext,
  writeDoc,
} from './checks.mjs'

const US_TO_UK = [
  ['organize', 'organise'], ['organized', 'organised'], ['organizing', 'organising'],
  ['color', 'colour'], ['colors', 'colours'], ['behavior', 'behaviour'], ['behaviors', 'behaviours'],
  ['center', 'centre'], ['centers', 'centres'], ['license', 'licence'], ['analyze', 'analyse'],
  ['optimize', 'optimise'], ['prioritize', 'prioritise'], ['customize', 'customise'],
  ['favorite', 'favourite'], ['favor', 'favour'], ['honor', 'honour'], ['program', 'programme'],
  ['traveling', 'travelling'], ['canceled', 'cancelled'], ['catalog', 'catalogue'],
]

const PLACEHOLDERS = [
  [/lorem ipsum/i, 'lorem ipsum'],
  [/dolor sit amet/i, 'lorem ipsum'],
  [/consectetur adipiscing/i, 'lorem ipsum'],
  [/\bTBD\b/, 'TBD'],
  [/\bTODO\b/, 'TODO'],
  [/\bXXX\b/, 'XXX'],
  [/coming soon/i, 'coming soon'],
  [/your title here/i, 'your title here'],
]

const EMOJI = /\p{Extended_Pictographic}/gu

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "we / our (agency voice)" → ["we", "our"]; a phrase stays whole. */
function bannedTerms(list) {
  const out = []
  for (const raw of list) {
    const withoutNote = String(raw).replace(/\([^)]*\)/g, '').trim()
    for (const piece of withoutNote.split(/\s*\/\s*/)) {
      const term = piece.trim()
      if (term.length > 1) out.push(term)
    }
  }
  return [...new Set(out)]
}

function collectSources(srcArg) {
  if (!srcArg) return []
  const out = []
  for (const raw of String(srcArg).split(',')) {
    const p = path.resolve(process.cwd(), raw.trim())
    if (!existsSync(p)) continue
    if (statSync(p).isDirectory()) {
      out.push(...walkFiles(p, ['.md', '.txt', '.html', '.vue', '.svelte', '.json', '.ts', '.tsx', '.js', '.jsx']))
    } else {
      out.push(p)
    }
  }
  return out
}

export function reviewCopy({ project, brand, src, urls = [], maxWords = null, stage = 'build' }) {
  const report = new Report('Copy review')
  const corpora = []
  if (stage === 'layout') {
    report.note('Layout stage: mock copy is allowed when the real copy does not exist. Mark it, keep it plausible in length and register, and replace it before build. Never mock a number, quote, testimonial or logo.')
  }

  for (const file of collectSources(src)) {
    try {
      corpora.push({ label: rel(file, project), text: textFromFile(file) })
    } catch (e) {
      report.add('minor', 'source-unreadable', `${rel(file, project)}: ${e.message}`)
    }
  }

  return (async () => {
    for (const url of urls) {
      const page = await fetchText(url)
      if (!page.ok) {
        report.add('blocking', 'url-unreachable', `${url} — ${page.error ?? page.status}`)
        continue
      }
      const facts = parseHtml(page.body, page.url)
      corpora.push({ label: page.url, text: facts.text })
    }

    if (!corpora.length) {
      report.add('blocking', 'no-source', 'no copy source: pass --src <path> or --url <url>')
      return report
    }

    const allBanned = bannedTerms(brandList(brand, 'c1-banned'))
    // A ban longer than four words is a concept, not a string a grep can prove.
    const banned = allBanned.filter((t) => t.split(/\s+/).length <= 4)
    const conceptual = allBanned.filter((t) => t.split(/\s+/).length > 4)
    if (conceptual.length) report.note(`Conceptual bans, checked by reading: ${conceptual.join(' · ')}`)
    const forbidden = brandList(brand, 'v8')
    const voice = brandList(brand, 'c1-rules').join(' ')
    const firstPersonRule = /first person|first-person|no agency|agency “we”|agency "we"/i.test(
      `${voice} ${forbidden.join(' ')}`,
    )

    let totalWords = 0
    for (const corpus of corpora) {
      const words = corpus.text.split(/\s+/).filter(Boolean).length
      totalWords += words
      report.row(corpus.label, `${words} words`)
      if (maxWords && words > maxWords) {
        report.add('major', 'word-budget', `${corpus.label}: ${words} words (budget ${maxWords})`)
      }

      for (const term of banned) {
        const re = new RegExp(`\\b${escapeRe(term)}\\b`, 'gi')
        const hits = [...corpus.text.matchAll(re)]
        if (!hits.length) continue
        const at = hits[0].index ?? 0
        const context = corpus.text.slice(Math.max(0, at - 45), at + term.length + 45).replace(/\s+/g, ' ').trim()
        report.add('blocking', 'banned-word', `"${term}" ×${hits.length} — …${context}…`)
      }

      for (const [re, label] of PLACEHOLDERS) {
        const hits = [...corpus.text.matchAll(new RegExp(re.source, 'gi'))]
        if (hits.length) {
          const mock = stage === 'layout'
          report.add(mock ? 'info' : 'major', mock ? 'mock-copy' : 'placeholder', `${label} ×${hits.length}${mock ? ' (allowed at layout)' : ''}`)
        }
      }

      if (firstPersonRule) {
        const hits = [...corpus.text.matchAll(/\b(we|our|us)\b/gi)].filter(
          (m) => !/let us/i.test(corpus.text.slice(Math.max(0, (m.index ?? 0) - 5), (m.index ?? 0) + 10)),
        )
        if (hits.length) {
          const at = hits[0].index ?? 0
          const context = corpus.text.slice(Math.max(0, at - 40), at + 50).replace(/\s+/g, ' ').trim()
          report.add('major', 'first-person', `"${hits[0][0]}" ×${hits.length} — the record asks for first person singular; …${context}…`)
        }
      }

      const lower = corpus.text.toLowerCase()
      for (const [us, uk] of US_TO_UK) {
        const n = (lower.match(new RegExp(`\\b${us}\\b`, 'g')) ?? []).length
        if (n) report.add('minor', 'us-spelling', `"${us}" ×${n} — UK spelling is "${uk}"`)
      }

      const bangs = (corpus.text.match(/!/g) ?? []).length
      const per1000 = words ? (bangs / words) * 1000 : 0
      if (bangs > 2 && per1000 > 2) report.add('minor', 'exclamation', `${bangs} exclamation marks in ${words} words (${per1000.toFixed(1)} per 1000)`)

      const emoji = (corpus.text.match(EMOJI) ?? []).length
      if (emoji) report.add('minor', 'emoji', `${emoji} emoji in body copy — decorative only, and never the sole signal`)

      const sentences = corpus.text.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).length > 0)
      const long = sentences.filter((s) => s.split(/\s+/).length > 35)
      if (long.length) {
        report.add('minor', 'long-sentence', `${long.length} sentence(s) over 35 words; longest ${Math.max(...long.map((s) => s.split(/\s+/).length))}`)
      }
    }

    report.row('total', `${totalWords} words across ${corpora.length} source(s)`)
    report.row('banned terms checked', banned.length ? banned.join(', ') : 'none in the record')
    if (totalWords < 150) report.note('Fewer than 150 words read — a source-mode pass may miss copy held in a CMS.')

    return report
  })()
}

/* ------------------------------------------------------------------- CLI -- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const ctx = resolveContext(args)
  if (!ctx.brand?.data) fail(`no brand record under ${ctx.project}. Run the brand interview first.`)
  const urls = String(args.get('url', '') || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  const report = await reviewCopy({
    project: ctx.project,
    brand: ctx.brand.data,
    src: args.get('src', null),
    urls,
    maxWords: args.get('max-words') ? Number(args.get('max-words')) : null,
    stage: (() => {
      const s = args.get('stage', 'build')
      if (!['layout', 'build', 'launch'].includes(s)) fail('--stage must be layout, build or launch')
      return s
    })(),
  })

  if (args.has('json')) console.log(JSON.stringify(report.json(), null, 2))
  else {
    process.stdout.write(report.render({ intro: `Project: ${ctx.project}` }))
    if (!args.has('no-write')) {
      const file = writeDoc(ctx.docDir, 'copy.md', report.render({ intro: `Project: ${ctx.project}` }))
      console.log(`\n→ ${rel(file)}`)
    }
  }
  process.exit(report.blocking ? 1 : 0)
}
