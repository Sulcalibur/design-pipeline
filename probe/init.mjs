#!/usr/bin/env node
/**
 * probe/init.mjs — start a design engagement in any project, at any stage.
 *
 * It never overwrites: an existing brief, direction or config is left alone and
 * reported. What it adds is only what is missing, plus a config that records
 * what it found about the project.
 *
 *   node probe.mjs init --project <root> --slug <slug>
 *   node probe.mjs init path/to/docs/design/<slug>       (explicit directory)
 *
 * Flags: --force (rewrite probe.config.json), --source eagle|folder
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs, fail } from './paths.mjs'

const here = import.meta.dirname
const toolRoot = path.resolve(here, '..')
const args = parseArgs(process.argv.slice(2))
const slug = args.get('slug', null)
const projectRoot = path.resolve(process.cwd(), args.get('project', '.'))
let target

if (args.positionals.length) {
  target = path.resolve(process.cwd(), args.positionals[0])
} else {
  if (!slug) fail('init needs a slug: node probe.mjs init --project . --slug <slug>')
  target = path.join(projectRoot, 'docs/design', slug)
}

const isProjectRoot = (dir) =>
  ['package.json', 'design.md', 'DESIGN.md', 'tokens.json', 'nuxt.config.ts', 'vite.config.ts', 'astro.config.mjs', 'next.config.js'].some(
    (f) => existsSync(path.join(dir, f)),
  )

/* --------------------------------------------------- what already exists -- */

const probeConfigPath = path.join(target, 'probe.config.json')
if (existsSync(probeConfigPath) && !args.has('force')) {
  fail(`probe.config.json already exists at ${probeConfigPath}\n  Pass --force to rewrite it, or run: node probe.mjs status --config ${probeConfigPath}`)
}

// Walk up from the target to the repo that owns it, so init works from any depth.
let owner = projectRoot
if (!isProjectRoot(owner)) {
  let cursor = target
  while (cursor !== path.dirname(cursor)) {
    if (isProjectRoot(cursor)) {
      owner = cursor
      break
    }
    cursor = path.dirname(cursor)
  }
}

const designRoot = path.join(owner, 'docs/design')
const siblings = existsSync(designRoot)
  ? readdirSync(designRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .map((d) => d.name)
  : []

const found = []
const add = (label, value) => found.push({ label, value })
add('project root', path.relative(process.cwd(), owner) || '.')
add('design system', existsSync(path.join(owner, 'design.md')) ? 'design.md' : existsSync(path.join(owner, 'DESIGN.md')) ? 'DESIGN.md' : 'none found')
add('tokens', existsSync(path.join(owner, 'tokens.json')) ? 'tokens.json' : 'none found')
add('framework', existsSync(path.join(owner, 'nuxt.config.ts')) ? 'Nuxt' : existsSync(path.join(owner, 'next.config.js')) ? 'Next' : existsSync(path.join(owner, 'astro.config.mjs')) ? 'Astro' : existsSync(path.join(owner, 'vite.config.ts')) ? 'Vite' : 'unknown')
add('other design slugs', siblings.length ? siblings.join(', ') : 'none')
add('hallmark state', existsSync(path.join(owner, '.hallmark')) ? '.hallmark/ present' : 'not used')
add('reference source', args.get('source', 'eagle'))

const existingDocs = ['00-brief.md', '01-references.md', '02-direction.md', '03-structure.md', '04-assets.md', 'review.md'].filter((f) =>
  existsSync(path.join(target, f)),
)

/* ----------------------------------------------------------- scaffold ---- */

mkdirSync(path.join(target, 'data'), { recursive: true })
mkdirSync(path.join(target, 'build'), { recursive: true })

const created = []
const templateDir = path.join(toolRoot, 'templates')
for (const file of ['00-brief.md', '01-references.md', '02-direction.md', '03-structure.md', '04-assets.md', 'review.md', 'reference-set.schema.json']) {
  const from = path.join(templateDir, file)
  const to = path.join(target, file)
  if (!existsSync(to) && existsSync(from)) {
    copyFileSync(from, to)
    created.push(file)
  }
}

if (!existsSync(path.join(target, '.gitignore'))) {
  writeFileSync(
    path.join(target, '.gitignore'),
    ['data/answers.json', 'data/candidates.json', 'data/eagle-writeback.json', 'data/live/', 'build/', '', '!data/fixtures/', ''].join('\n'),
  )
  created.push('.gitignore')
}

if (!existsSync(probeConfigPath) || args.has('force')) {
  const starter = JSON.parse(readFileSync(path.join(templateDir, 'probe.config.example.json'), 'utf8'))
  const id = slug ?? path.basename(target)
  Object.assign(starter, {
    $schema: path.join(here, 'probe.schema.json'),
    id,
    created: new Date().toISOString().slice(0, 10),
    sources:
      args.get('source') === 'folder'
        ? { kind: 'folder', path: 'references' }
        : { kind: 'eagle', library: args.get('library', 'Inspirations') },
    ui: { title: id, mark: '', storageKey: `probe:${id}`, note: '' },
  })
  writeFileSync(probeConfigPath, JSON.stringify(starter, null, 2) + '\n')
  created.push('probe.config.json')
}

/* ------------------------------------------------------------- report ---- */

console.log(`\n${path.relative(process.cwd(), target) || '.'}\n`)
console.log('found:')
for (const f of found) console.log(`  ${f.label.padEnd(18)} ${f.value}`)
console.log(`  ${'existing documents'.padEnd(18)} ${existingDocs.length ? existingDocs.join(', ') : 'none'}`)
console.log(`\ncreated: ${created.length ? created.join(', ') : 'nothing (already complete)'}`)

console.log(`
next:
  1. author intake, pairs and facts in ${path.relative(process.cwd(), probeConfigPath)}
     pairs are the judgement step: one axis per pair, two options, a source, alt, vocab, note
  2. node probe.mjs ingest --config ${path.relative(process.cwd(), probeConfigPath)}
  3. node probe.mjs sheet  --config ${path.relative(process.cwd(), probeConfigPath)}
  4. node probe.mjs build  --config ${path.relative(process.cwd(), probeConfigPath)}
  5. node probe.mjs serve  --config ${path.relative(process.cwd(), probeConfigPath)}

Starting mid-pipeline is expected. If 00-brief.md or 02-direction.md already
existed, they were left untouched; the probe writes only its own block into
02-direction.md and never edits the contract around it.
`)
