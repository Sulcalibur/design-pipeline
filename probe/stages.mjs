/**
 * probe/stages.mjs — where is this project in the map, and what is next?
 *
 * Detection is from artifacts, not from a stored "current stage" (which would
 * drift the moment someone edits a document). A stage with a generated artifact
 * is done; an authored document that still matches its template is a stub.
 * Those are honest labels about what exists, not a claim that a gate passed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { probeCommand, sloplintCommand } from './paths.mjs'

export const STAGES = [
  {
    id: '0',
    name: 'setup',
    label: 'Setup',
    target: 'probe.config.json',
    root: 'design',
    gate: 'the config resolves a real reference source',
  },
  {
    id: '0b',
    name: 'brand',
    label: 'Brand',
    target: 'docs/brand/brand.json',
    root: 'project',
    gate: '39 slots, each with a status and a source; required interview questions answered',
  },
  {
    id: '0c',
    name: 'brand-review',
    label: 'Brand review',
    target: 'docs/brand/review.md',
    root: 'project',
    gate: '0 blocking; TBC within budget; contrast pairs pass',
  },
  {
    id: '1',
    name: 'intake',
    aliases: ['brief'],
    label: 'Intake',
    target: '00-brief.md',
    root: 'design',
    template: '00-brief.md',
    gate: 'a stranger could build from it; success criteria are checkable',
  },
  {
    id: '2',
    name: 'collect',
    aliases: ['references', 'inspire'],
    label: 'Collect',
    target: '01-references.md',
    root: 'design',
    template: '01-references.md',
    evidence: 'references/manifest.json',
    gate: 'every reference names a device and a thing not to copy; at least one distance reference',
  },
  {
    id: '3',
    name: 'direction',
    aliases: ['direct'],
    label: 'Direct',
    target: '02-direction.md',
    root: 'design',
    template: '02-direction.md',
    evidence: 'build-spec.json',
    gate: 'one direction, three decisions, one refusal, a named cost; status is not needs-decision',
  },
  {
    id: '4',
    name: 'structure',
    label: 'Structure',
    target: '03-structure.md',
    root: 'design',
    template: '03-structure.md',
    gate: 'every section has a job; every control has states; a content model exists',
  },
  {
    id: '5',
    name: 'assets',
    label: 'Assets',
    target: '04-assets.md',
    root: 'design',
    template: '04-assets.md',
    gate: 'every slot has a ratio, a prompt and alt text before layout',
  },
  {
    id: '5b',
    name: 'copy',
    label: 'Copy',
    target: 'copy.md',
    root: 'design',
    gate: '0 blocking: banned words, placeholders, voice',
  },
  {
    id: '5c',
    name: 'content',
    label: 'Content',
    target: 'content.md',
    root: 'design',
    gate: '0 blocking: h1, alt, titles, noindex, model',
  },
  {
    id: '5d',
    name: 'handoff',
    label: 'Handoff',
    target: 'handoff/context.md',
    root: 'design',
    optional: true,
    gate: 'context.md + prompt.md exist; missing sources are listed, not invented',
  },
  {
    id: '6',
    name: 'build',
    label: 'Build',
    routed: true,
    gate: 'the build runs; every colour and font comes from a token',
  },
  {
    id: '7',
    name: 'verify',
    label: 'Verify',
    target: 'review.md',
    root: 'design',
    template: 'review.md',
    gate: 'axe 0 serious; 375/390/768/1440; keyboard; states; reduced motion',
  },
  {
    id: '7b',
    name: 'audit',
    label: 'Audit',
    root: 'design',
    generated: /^10-audit-.*\.md$/,
    gate: 'scored 0–20; every finding fixed, waived or dismissed with a reason',
  },
  {
    id: '8',
    name: 'launch',
    label: 'Launch',
    target: 'launch.md',
    root: 'design',
    gate: '0 blocking: HTTPS, redirects, headers, robots, sitemap, real 404, rollback recorded',
  },
  {
    id: '9',
    name: 'maintain',
    label: 'Maintain',
    root: 'design',
    generated: /^check-.*\.md$/,
    extra: 'maintain.json',
    gate: 'no new blocking finding against the last run; score deltas explained',
  },
]

export const STATUS = {
  done: { icon: '✓', label: 'done' },
  partial: { icon: '~', label: 'partial' },
  stub: { icon: '·', label: 'stub' },
  missing: { icon: '✗', label: 'missing' },
  optional: { icon: '·', label: 'optional' },
  routed: { icon: '→', label: 'routed' },
}

export function stageById(value) {
  const wanted = String(value ?? '').toLowerCase()
  return (
    STAGES.find((stage) => stage.id === wanted) ??
    STAGES.find((stage) => stage.name === wanted) ??
    STAGES.find((stage) => (stage.aliases ?? []).includes(wanted)) ??
    null
  )
}

function targetFile(stage, ctx) {
  return stage.root === 'project' ? path.join(ctx.project, stage.target) : path.join(ctx.slugDir, stage.target)
}

function sameAsTemplate(file, templateName, templatesDir) {
  const template = path.join(templatesDir, templateName)
  if (!existsSync(template)) return false
  const normalize = (text) => text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()
  try {
    return normalize(readFileSync(file, 'utf8')) === normalize(readFileSync(template, 'utf8'))
  } catch {
    return false
  }
}

function listGenerated(dir, pattern) {
  try {
    return readdirSync(dir).filter((name) => pattern.test(name))
  } catch {
    return []
  }
}

function manifestCount(slugDir) {
  try {
    const data = JSON.parse(readFileSync(path.join(slugDir, 'references', 'manifest.json'), 'utf8'))
    return (Array.isArray(data) ? data : data?.items ?? []).length
  } catch {
    return 0
  }
}

function baseStatus(stage, ctx) {
  if (stage.routed) return { status: 'routed', detail: 'build is routed to the surface' }
  if (stage.generated) {
    const files = listGenerated(ctx.slugDir, stage.generated)
    if (files.length) return { status: 'done', detail: files.sort().at(-1) }
    if (stage.extra && existsSync(path.join(ctx.slugDir, stage.extra))) {
      return { status: 'done', detail: stage.extra }
    }
    return {
      status: 'missing',
      detail: stage.name === 'audit' ? '10-audit-<date>.md' : stage.extra ? `check-<date>.md + ${stage.extra}` : 'not generated yet',
    }
  }
  if (!stage.target) return { status: 'missing', detail: stage.gate }

  const file = targetFile(stage, ctx)
  if (!existsSync(file)) {
    return { status: stage.optional ? 'optional' : 'missing', detail: path.relative(ctx.project, file) }
  }
  if (stage.template && sameAsTemplate(file, stage.template, ctx.templatesDir)) {
    return { status: stage.optional ? 'optional' : 'stub', detail: `${path.relative(ctx.project, file)} (template)` }
  }
  return { status: 'done', detail: path.relative(ctx.project, file) }
}

export function detectStages({ project, slugDir, templatesDir }) {
  const ctx = { project, slugDir, templatesDir }
  const stages = STAGES.map((stage) => {
    const base = baseStatus(stage, ctx)
    let { status, detail } = base

    if (stage.name === 'collect' && status !== 'done') {
      const count = manifestCount(slugDir)
      if (count) {
        status = 'partial'
        detail = `${count} capture(s) in references/manifest.json · 01-references.md is not authored`
      } else if (status === 'stub') {
        detail = '01-references.md (template) · no captures yet'
      }
    }

    if (stage.name === 'direction') {
      const evidence = path.join(slugDir, 'build-spec.json')
      if (existsSync(evidence)) {
        status = 'done'
        detail = 'build-spec.json + 05-decision.md'
      } else if (status === 'done') {
        status = 'partial'
        detail = '02-direction.md is authored; emit has not produced build-spec.json'
      } else if (status === 'stub') {
        detail = '02-direction.md (template) · no probe result'
      }
    }

    if (stage.name === 'brand' && status === 'done') {
      try {
        const brand = JSON.parse(readFileSync(path.join(project, 'docs', 'brand', 'brand.json'), 'utf8'))
        const slots = Object.keys(brand.slots ?? {}).length
        detail = `brand.json · ${slots} slot(s)`
      } catch {
        detail = 'brand.json is not valid JSON'
      }
    }

    return { ...stage, status, detail, commands: commandsFor(stage, ctx) }
  })

  return { project, slugDir, slug: path.basename(slugDir), stages, recommended: recommendStage(stages) }
}

export function recommendStage(stages, { mode = 'new' } = {}) {
  const byName = new Map(stages.map((stage) => [stage.name, stage]))
  if (mode === 'existing') {
    if (byName.get('audit')?.status === 'done') return byName.get('maintain')
    return byName.get('audit')
  }
  const setup = byName.get('setup')
  if (setup && setup.status !== 'done') return setup

  // Advance from the furthest evidence, not from the beginning. A project that
  // already has a brief and captures is not sent back to the brand interview
  // just because docs/brand is absent; it is sent to the stage it is in.
  const ordered = stages.filter((stage) => !stage.optional && !stage.routed)
  const lastProgress = [...ordered].reverse().find((stage) => stage.status === 'done' || stage.status === 'partial')
  if (lastProgress?.status === 'partial') return lastProgress
  const index = lastProgress ? ordered.findIndex((stage) => stage.id === lastProgress.id) : -1
  return (
    ordered.slice(index + 1).find((stage) => ['missing', 'stub', 'partial'].includes(stage.status)) ??
    lastProgress ??
    setup
  )
}

/** The commands a stage actually runs. Authored stages have none. */
export function commandsFor(stage, ctx) {
  const probe = probeCommand()
  const sloplint = sloplintCommand()
  const cfg = path.relative(process.cwd(), path.join(ctx.slugDir, 'probe.config.json')) || 'probe.config.json'
  const project = path.relative(process.cwd(), ctx.project) || '.'
  const slug = ctx.slug ?? path.basename(ctx.slugDir)
  const url = '<url>'
  const prev = '<previous-deploy>'
  switch (stage.name) {
    case 'setup':
      return [`${probe} init --project ${project} --slug ${slug}`]
    case 'brand':
      return [`${probe} brand scaffold --project ${project}`, `${probe} ask --stage brand --next`]
    case 'brand-review':
      return [`${probe} brand review --project ${project}`]
    case 'intake':
      return [`${probe} ask --stage brief --next`]
    case 'collect':
      return [
        `${probe} inspire --config ${cfg} --dry-run`,
        `${probe} capture --url ${url} --slug ${slug}`,
        `${probe} refs --config ${cfg}`,
        `${probe} ingest --config ${cfg} --source folder`,
        `${probe} analyze --config ${cfg}`,
        `${probe} sheet --config ${cfg}`,
      ]
    case 'direction':
      return [
        `${probe} ask --stage direction --next`,
        `${probe} emit --config ${cfg}`,
        `${probe} compare a.html b.html --out previews/compare.html`,
      ]
    case 'structure':
      return [`edit ${path.relative(process.cwd(), path.join(ctx.slugDir, '03-structure.md'))}`]
    case 'assets':
      return [`edit ${path.relative(process.cwd(), path.join(ctx.slugDir, '04-assets.md'))}`]
    case 'copy':
      return [`${probe} copy --config ${cfg} --url ${url}`]
    case 'content':
      return [`${probe} content --config ${cfg} --url ${url} --model content-model.json`]
    case 'handoff':
      return [`${probe} context --config ${cfg}`]
    case 'build':
      return ['build with the surface the project already uses — the pipeline does not build']
    case 'verify':
      return [`${probe} audit --url ${url} --slug ${slug}`, `${sloplint} <files|--url ${url}>`]
    case 'audit':
      return [`${probe} review --config ${cfg} --url ${url}`]
    case 'launch':
      return [`${probe} launch --config ${cfg} --url ${url} --previous ${prev}`]
    case 'maintain':
      return [`${probe} maintain --config ${cfg} --url ${url} --previous ${prev}`]
    default:
      return []
  }
}

/** Stages that should exist before this one can honestly start. */
export function prerequisitesFor(stage, stages) {
  const index = stages.findIndex((item) => item.id === stage.id)
  return stages
    .slice(0, index)
    .filter((item) => !item.optional && !item.routed && ['missing', 'stub', 'partial'].includes(item.status))
}
