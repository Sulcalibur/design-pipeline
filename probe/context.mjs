#!/usr/bin/env node
/**
 * probe/context.mjs — compile the project into a handoff for another tool.
 *
 * A design tool or agent should not have to read twelve files and infer which
 * one wins. This writes one self-contained folder: a short context.md, a
 * target-specific prompt.md, the source documents, tokens, references,
 * exemplars and acceptance criteria, with a stated precedence order.
 *
 *   node context.mjs --project . --target open-design --scope "Work index, first screen"
 *   node context.mjs --config … --target agent --examples previews/final,shots/status
 *   node context.mjs --project . --target penpot --with-audit --dest handoff
 *
 * Flags: --target generic|open-design|penpot|agent · --scope "…" · --examples a,b
 *        --with-audit · --dest <dir> · --json
 *
 * Requires a brand record: a handoff without constraints is a mood board.
 * Writes into <slug>/handoff by default. Generated — re-run, do not hand-edit.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import { resolveContext, loadBrand, slotValue, listFrom, readJson, nowDate } from './checks.mjs'

const TARGETS = new Set(['generic', 'open-design', 'penpot', 'agent'])
const args = parseArgs(process.argv.slice(2))
const target = args.get('target', 'generic')
if (!TARGETS.has(target)) fail(`--target must be generic, open-design, penpot or agent`)

const ctx = resolveContext(args)
const brandRecord = loadBrand(ctx.project)
if (!brandRecord?.data) fail(`no brand record under ${ctx.project}. Run the brand interview first — a handoff without constraints is a mood board.`)

const brand = brandRecord.data
const docDir = ctx.docDir
const dest = args.get('dest') ? path.resolve(process.cwd(), args.get('dest')) : path.join(docDir, 'handoff')
const scope = args.get('scope', '[one screen — name it]')
const rawName = String(brand.product ?? path.basename(ctx.project))
const projectName = rawName.split(/[—–.]/)[0].trim().slice(0, 60) || path.basename(ctx.project)

mkdirSync(dest, { recursive: true })

const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null)
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12)
const copied = []
const sources = []
const missing = []

function copyIf(from, to) {
  if (!from || !existsSync(from)) return null
  const out = path.join(dest, to)
  mkdirSync(path.dirname(out), { recursive: true })
  copyFileSync(from, out)
  copied.push(to)
  sources.push({ role: to, from: rel(from), sha256: sha(from) })
  return out
}

function section(md, title) {
  if (!md) return null
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const lines = md.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${esc}\\s*$`, 'i').test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim() || null
}

function sectionBy(md, re) {
  if (!md) return null
  const lines = md.split('\n')
  const start = lines.findIndex((l) => re.test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim() || null
}

/** Checkbox items, including wrapped continuation lines. */
function checkboxes(md) {
  if (!md) return []
  const out = []
  let current = null
  for (const line of md.split('\n')) {
    const m = /^- \[[ x]\]\s+(.*)$/.exec(line)
    if (m) {
      if (current) out.push(current)
      current = m[1].trim()
      continue
    }
    if (current && /^\s{2,}\S/.test(line)) current += ' ' + line.trim()
    else if (current && line.trim() === '') {
      // a blank line ends the item unless the next line is indented
      continue
    } else if (current) {
      out.push(current)
      current = null
    }
  }
  if (current) out.push(current)
  return out
}

/* ------------------------------------------------------------- the sources -- */

const briefPath = path.join(docDir, '00-brief.md')
const directionPath = path.join(docDir, '02-direction.md')
const structurePath = path.join(docDir, '03-structure.md')
const assetsPath = path.join(docDir, '04-assets.md')
const decisionPath = path.join(docDir, '05-decision.md')
const specPath = ['build-spec.json', 'design-spec.json'].map((f) => path.join(docDir, f)).find((f) => existsSync(f))

const brief = readIf(briefPath)
const direction = readIf(directionPath)
const spec = specPath ? readJson(specPath, null) : null

copyIf(brandRecord.file, 'brand.json')
copyIf(path.join(path.dirname(brandRecord.file), 'brand.md'), 'brand.md')
copyIf(briefPath, 'brief.md')
copyIf(directionPath, 'direction.md')
copyIf(structurePath, 'structure.md')
copyIf(assetsPath, 'assets.md')
copyIf(decisionPath, 'decision.md')
copyIf(specPath, 'build-spec.json')

if (!brief) missing.push('00-brief.md (no job or acceptance criteria)')
if (!direction) missing.push('02-direction.md (no committed direction)')
if (!spec) missing.push('build-spec.json (no executable rules; direction.md is the fallback)')

/* ----------------------------------------------------------------- tokens -- */

const tokenCandidates = [
  'app/assets/css/tokens.css',
  'src/styles/tokens.css',
  'styles/tokens.css',
  'tokens.css',
  'tokens.json',
  'app/globals.css',
  'src/app/globals.css',
]
const tokenPath = tokenCandidates.map((f) => path.join(ctx.project, f)).find((f) => existsSync(f))
let tokenProps = null
if (tokenPath) {
  const ext = path.extname(tokenPath)
  if (ext === '.json') {
    copyIf(tokenPath, 'tokens.json')
    tokenProps = readJson(tokenPath, null)?.properties ?? null
  } else {
    copyIf(tokenPath, 'tokens.css')
    const css = readFileSync(tokenPath, 'utf8')
    tokenProps = {}
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
      if (!(m[1] in tokenProps)) tokenProps[m[1]] = m[2].trim()
    }
    writeFileSync(path.join(dest, 'tokens.json'), JSON.stringify({ source: rel(tokenPath), extractedAt: nowDate(), properties: tokenProps }, null, 2) + '\n')
    copied.push('tokens.json')
  }
} else {
  missing.push('tokens.css / tokens.json (no values to build with)')
}

/* ------------------------------------------------------------- references -- */

const refsDir = [path.join(docDir, 'references'), path.join(ctx.project, 'references')].find((d) =>
  existsSync(path.join(d, 'manifest.json')),
)
let refItems = []
if (refsDir) {
  const manifest = readJson(path.join(refsDir, 'manifest.json'), { items: [] })
  refItems = Array.isArray(manifest) ? manifest : manifest.items ?? []
  mkdirSync(path.join(dest, 'references'), { recursive: true })
  copyIf(path.join(refsDir, 'manifest.json'), 'references/manifest.json')
  copyIf(path.join(refsDir, 'refs.html'), 'references/refs.html')
  for (const item of refItems) {
    if (!item.file) continue
    const file = path.isAbsolute(item.file) ? item.file : path.join(refsDir, item.file)
    if (existsSync(file)) copyIf(file, path.join('references', path.basename(file)))
  }
} else {
  missing.push('references/manifest.json (no captured reference pack)')
}

/* --------------------------------------------------------------- exemplars -- */

const exArgs = String(args.get('examples', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const exFiles = []
for (const raw of exArgs) {
  const p = path.resolve(ctx.project, raw)
  if (!existsSync(p)) continue
  if (statSync(p).isDirectory()) {
    for (const name of readdirSync(p)) {
      if (/\.(png|jpe?g|webp|gif|svg|html|pdf)$/i.test(name)) exFiles.push(path.join(p, name))
    }
  } else {
    exFiles.push(p)
  }
}
mkdirSync(path.join(dest, 'examples'), { recursive: true })
for (const [i, file] of exFiles.slice(0, 8).entries()) {
  copyIf(file, path.join('examples', `${String(i + 1).padStart(2, '0')}-${path.basename(file)}`))
}
writeFileSync(
  path.join(dest, 'examples', 'README.md'),
  [
    '# Exemplars',
    '',
    exFiles.length
      ? 'The files here are examples supplied for this handoff. Annotate why each is approved (or rejected) before a tool is expected to learn from it; a folder of screenshots is a mood board, not a standard.'
      : 'No exemplars were supplied. Add two approved sections and one rejected section, each with a one-line reason. This is the highest-leverage input in the handoff.',
    '',
    exFiles.length ? exFiles.slice(0, 8).map((f) => `- ${path.basename(f)}`).join('\n') : '',
    '',
  ].join('\n'),
)

/* ------------------------------------------------------------------ audit -- */

if (args.has('with-audit')) {
  const audits = readdirSync(docDir)
    .filter((f) => /^10-audit-.*\.md$/.test(f) || f === 'audit.md')
    .sort()
    .reverse()
  if (audits[0]) copyIf(path.join(docDir, audits[0]), 'audit.md')
}

/* ---------------------------------------------------------------- context -- */

const b = (id) => slotValue(brand, id)
const list = (id) => listFrom(b(id))

const briefOneLine = section(brief, 'One line')
const briefReader = section(brief, 'Reader')
const briefJob = section(brief, 'The one job')
const briefAction = section(brief, 'Primary action')
const briefSuccess = section(brief, 'Success criteria')
const acceptance = checkboxes(briefSuccess)

const decision = section(direction, 'Decision + what it gives up') ?? sectionBy(direction, /^##\s+Decision/i)
const contract = section(direction, 'Direction contract (binds all builds)') ?? sectionBy(direction, /^##\s+Direction contract/i)
const forbiddenSection = section(direction, 'Forbidden list') ?? sectionBy(direction, /^##\s+Forbidden/i)

// The contract table records the original commitment and is amended over time.
// Flag any hex it names that no longer exists in the tokens, rather than letting
// a tool build from a superseded value.
const contractHexes = [...new Set((contract ?? '').match(/#[0-9a-f]{6}\b/gi) ?? [])].map((h) => h.toLowerCase())
const tokenHexes = new Set(
  Object.values(tokenProps ?? {}).flatMap((v) => [...String(v).matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase())),
)
const staleHexes = contractHexes.filter((h) => !tokenHexes.has(h))

const brandTable = (ids) =>
  ids
    .map((id) => {
      const v = b(id)
      return v ? `| ${id.replace(/^v\d-/, '')} | ${String(v).replace(/\n/g, ' ')} |` : null
    })
    .filter(Boolean)

const refRows = refItems.length
  ? [
      '| ID | Device | Not to copy | Fits |',
      '|---|---|---|---|',
      ...refItems.map((r) => `| ${r.id ?? '—'} | ${r.device ?? '—'} | ${r.avoid ?? '—'} | ${r.fits ?? '—'} |`),
    ].join('\n')
  : '_No captured reference pack. Capture with `probe capture --device … --avoid …`, then run `probe refs`._'

const specRules = spec?.buildRules?.length
  ? spec.buildRules.map((r) => `- **${r.key ?? 'rule'}**: ${r.value ?? r.rule ?? ''}`).join('\n')
  : null

const jobBlocks = [briefOneLine, briefJob, briefReader, briefAction].filter(Boolean)

const contextMd = `# Design context — ${projectName}

> Generated ${nowDate()} · target **${target}** · scope **${scope}**
> Precedence: brand constraints **>** the direction contract **>** the brief **>** references **>** this prompt.
> If two constraints conflict, stop and ask. Never average them.

## How to use this

1. Read this page first. It is the whole brief.
2. \`brand.json\` and \`brand.md\` are the constraints; they are not suggestions.
3. \`direction.md\` is the committed direction. \`build-spec.json\` (when present) is the executable subset.
4. \`tokens.css\` / \`tokens.json\` hold the only allowed values.
5. \`references/\` teaches devices. Borrow the device, never the surface.
6. \`examples/\` is what "right" looks like — when they are annotated.

## The job

${jobBlocks.length ? jobBlocks.join('\n\n') : '_No brief recorded. Add `00-brief.md` before handing this to a tool._'}

${acceptance.length ? `### Acceptance criteria\n\n${acceptance.map((a) => `- [ ] ${a}`).join('\n')}\n` : '### Acceptance criteria\n\n_None recorded. Add testable criteria to 00-brief.md._\n'}

## Brand constraints

- **Product:** ${b('product') ?? projectName}
- **One line:** ${b('oneLine') ?? '—'}
- **Promise:** ${b('b1') ?? '—'}
- **Who it is for:** ${b('a2') ?? '—'}
- **Voice rules:** ${list('c1-rules').join(' · ') || '—'}
- **Banned words:** ${list('c1-banned').join(' · ') || '—'}
- **Forbidden territory:** ${list('v8').join(' · ') || '—'}

### Colour roles

| Role | Value |
|---|---|
${brandTable(['v2-paper', 'v2-ink', 'v2-accent', 'v2-surface']).join('\n') || '| — | — |'}

### Type roles

| Role | Value |
|---|---|
${brandTable(['v3-display', 'v3-body', 'v3-ui']).join('\n') || '| — | — |'}

### Dials

${b('dials') ? '```json\n' + JSON.stringify(b('dials'), null, 2) + '\n```' : '—'}

## Direction

${decision ?? '_No committed direction recorded. Read `direction.md`; if it is absent, stop and run the direction stage._'}

${contract ? `### Contract\n\n${staleHexes.length ? `> **Stale contract values:** ${staleHexes.join(', ')} appear in the contract table but not in the tokens. Treat that table as historical and the brand record / tokens as current; confirm before building.\n\n` : ''}${contract}\n` : ''}
${forbiddenSection ? `### Forbidden list\n\n${forbiddenSection}\n` : ''}
${spec?.direction ? `**Committed direction:** ${spec.direction}\n` : ''}

${specRules ? `## Build rules\n\n${specRules}\n` : ''}
${spec?.avoided?.length ? `### Avoid\n\n${spec.avoided.map((a) => `- ${a}`).join('\n')}\n` : ''}
${spec?.unanswered?.pairs?.length || spec?.unanswered?.followups?.length ? `### Unprobed — do not invent\n\n${[...(spec.unanswered.pairs ?? []), ...(spec.unanswered.followups ?? [])].map((u) => `- ${u}`).join('\n')}\n` : ''}

## References

${refRows}

## Exemplars

${exFiles.length ? `${Math.min(exFiles.length, 8)} file(s) in \`examples/\`. Annotate why each is approved or rejected before a tool is expected to learn from it.` : '_None supplied. Two approved sections and one rejected, each with a one-line reason, is the highest-leverage input in this handoff._'}

## Mock content

- Mock copy is allowed **at layout stage only**, when the real copy does not exist.
- Mark it explicitly: \`data-mock\` on the element, or a \`MOCK:\` prefix in the copy source.
- Keep it plausible in length and register; lorem hides layout problems.
- Remove every mock before build or launch. \`probe content --stage build\` and \`probe copy --stage build\` fail on it.
- **Never mock a number, quote, testimonial, client logo or outcome.** Those are not placeholders; they are false claims.

## Do not

${[
  ...list('c1-banned').map((w) => `- never write “${w}”`),
  ...list('v8').map((w) => `- never use ${w}`),
  '- never invent a metric, quote, testimonial, logo or case-study count',
  '- never introduce a colour, font, radius or shadow that is not in the tokens',
  '- never copy a reference’s palette, wordmark or illustration style',
].join('\n')}

## Files in this handoff

| File | What it is |
|---|---|
| \`context.md\` | this page — read first |
| \`prompt.md\` | the opening prompt for ${target} |
| \`brand.json\` · \`brand.md\` | the constraints and the story |
| \`brief.md\` · \`direction.md\` | the job and the signed direction |
| \`build-spec.json\` | executable rules, when the probe produced them |
| \`tokens.css\` · \`tokens.json\` | the only allowed values |
| \`references/\` | the captured pack, with device and avoid notes |
| \`examples/\` | approved and rejected exemplars, when supplied |
| \`audit.md\` | the latest audit, when \`--with-audit\` was used |
`

writeFileSync(path.join(dest, 'context.md'), contextMd)

/* ----------------------------------------------------------------- prompt -- */

const targetLine = {
  generic: 'You are designing a web surface from a recorded design system.',
  'open-design': 'You are working on an Open Design canvas from a recorded design system. Design in frames; export or screenshot when done.',
  penpot: 'You are working in Penpot from a recorded design system. Build frames and components bound to the tokens; do not detach them.',
  agent: 'You are implementing a web surface from a recorded design system. Write code, not pictures of code.',
}[target]

const promptMd = `# Opening prompt — ${target}

${targetLine}

Design **${scope}** for **${projectName}**.

Read \`context.md\` first. Then \`brand.json\`, \`direction.md\` and \`tokens.css\` / \`tokens.json\`.
Use only the values in the token file. Do not introduce a colour, font, radius or shadow that is not there.

## Rules

- One screen at a time. Produce **two structurally different** options, then stop and name which constraint each one stresses.
- Real content only. If the copy does not exist, use plausible **marked** mock copy at layout stage; never invent a number, quote, testimonial or logo.
- Borrow the **device** from \`references/\`; never copy the palette, wordmark or illustration style.
- Respect \`examples/\`: the approved ones are the standard, the rejected one is the anti-reference.
- Keep the committed direction. Do not reopen a signed decision; if a constraint genuinely conflicts, stop and ask.
- Accessibility is not a later pass: one \`h1\`, landmarks, focus-visible, 4.5:1 text contrast, 24px targets, reduced-motion honoured.

## Deliver

${target === 'agent'
  ? '- The implementation, in the project system, with tokens only.\n- A short note naming any constraint that was hard to satisfy.\n- The states you built: hover, focus, active, disabled, loading, empty, error (where they apply).'
  : '- Two options as frames/screens, at 1440 and 390.\n- A one-line rationale for each, using the direction’s vocabulary.\n- A list of anything the brief does not answer, rather than a guess.'}

## Stop conditions

- A constraint conflicts with another constraint.
- The copy or assets do not exist and cannot be marked as mock.
- The request needs a new token or a new decision.

Ask; do not invent.
`

writeFileSync(path.join(dest, 'prompt.md'), promptMd)

/* ------------------------------------------------------------------ readme -- */

const readme = `# Handoff — ${projectName}

Generated ${nowDate()} · target **${target}** · scope **${scope}**
Source: \`${rel(docDir)}\`

This folder is a **generated snapshot**. Re-run \`probe context\` rather than editing it.

| File | Read it for |
|---|---|
| \`context.md\` | the whole brief, precedence and constraints — start here |
| \`prompt.md\` | the opening prompt for ${target} |
| \`brand.json\` / \`brand.md\` | constraints and voice |
| \`brief.md\` | audience, job, acceptance criteria |
| \`direction.md\` | the committed direction, contract and forbidden list |
| \`build-spec.json\` | executable rules, when present |
| \`tokens.*\` | the only allowed values |
| \`references/\` | devices to borrow, surfaces not to copy |
| \`examples/\` | approved and rejected exemplars |
| \`audit.md\` | the latest audit, when included |

${missing.length ? `## Missing\n\n${missing.map((m) => `- ${m}`).join('\n')}\n` : ''}
## Regenerate

\`\`\`bash
probe context --project ${rel(ctx.project)} --target ${target} --scope "${scope}"${args.get('examples') ? ` --examples ${args.get('examples')}` : ''}${args.has('with-audit') ? ' --with-audit' : ''}
\`\`\`
`

writeFileSync(path.join(dest, 'README.md'), readme)

/* ------------------------------------------------------------------- json -- */

const manifest = {
  generatedAt: new Date().toISOString(),
  target,
  scope,
  project: ctx.project,
  docDir,
  dest,
  sources,
  files: copied,
  missing,
  references: refItems.length,
  examples: exFiles.length,
  tokens: tokenPath ? rel(tokenPath) : null,
}
writeFileSync(path.join(dest, 'handoff.json'), JSON.stringify(manifest, null, 2) + '\n')

/* ----------------------------------------------------------------- report -- */

console.log(`context ${projectName} · ${target} · ${scope}`)
for (const f of copied) console.log(`  · ${f}`)
console.log(`  · context.md\n  · prompt.md\n  · README.md\n  · handoff.json`)
if (missing.length) {
  console.log('\nmissing:')
  for (const m of missing) console.log(`  ! ${m}`)
}
console.log(`\n→ ${rel(dest)}`)

if (args.has('json')) console.log(JSON.stringify(manifest, null, 2))
