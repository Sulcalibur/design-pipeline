#!/usr/bin/env node
/**
 * probe/start.mjs — where is this project, and what is the next honest step?
 *
 * Reads artifacts, never writes. There is no stored "current stage": a stage is
 * done because its document or generated artifact exists, and an authored file
 * that still matches its template is a stub. Gates are still gates; this command
 * does not run them.
 *
 *   node probe.mjs start --project . --slug home
 *   node probe.mjs start --all
 *   node probe.mjs start --stage 3
 *   node probe.mjs start --existing
 *   node probe.mjs start --ask
 *
 * Flags: --project . · --slug <slug> · --config <path> · --stage <id|name>
 *        --all · --existing · --ask · --next · --json
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs, fail, rel } from './paths.mjs'
import { findProjectRoot } from './checks.mjs'
import { STAGES, STATUS, detectStages, prerequisitesFor, stageById } from './stages.mjs'

const here = import.meta.dirname
const toolRoot = path.resolve(here, '..')
const args = parseArgs(process.argv.slice(2))
const cwd = process.cwd()
const json = args.has('json')
const mode = args.has('existing') ? 'existing' : 'new'

/* --------------------------------------------------------------- locate -- */

function locate() {
  if (args.get('config')) {
    const configPath = path.resolve(cwd, args.get('config'))
    const slugDir = path.dirname(configPath)
    const parent = path.dirname(slugDir)
    const guessed =
      path.basename(parent) === 'design' && path.basename(path.dirname(parent)) === 'docs'
        ? path.dirname(path.dirname(parent))
        : null
    return { project: guessed ?? findProjectRoot(slugDir), slug: path.basename(slugDir), slugDir }
  }

  const project = path.resolve(cwd, args.get('project', '.'))
  const designRoot = path.join(project, 'docs', 'design')
  const slug = args.get('slug')
  if (slug) return { project, slug, slugDir: path.join(designRoot, slug) }

  let dirs = []
  try {
    dirs = readdirSync(designRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('audit-'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    dirs = []
  }

  if (dirs.length === 1) return { project, slug: dirs[0], slugDir: path.join(designRoot, dirs[0]) }
  if (dirs.length === 0) return { project, slug: slug ?? '<slug>', slugDir: path.join(designRoot, slug ?? '<slug>') }
  fail(`several design folders under ${rel(designRoot)}:\n  ${dirs.join('\n  ')}\n  Pass --slug <slug> or --config <path>.`)
}

const target = locate()
const detection = detectStages({ project: target.project, slugDir: target.slugDir, templatesDir: path.join(toolRoot, 'templates') })
const { stages, recommended } = detection

/* ---------------------------------------------------------------- output -- */

function stageLine(stage) {
  const state = STATUS[stage.status] ?? STATUS.missing
  return `  ${stage.id.padEnd(3)} ${stage.label.padEnd(14)} ${`${state.icon} ${state.label}`.padEnd(11)} ${stage.detail ?? ''}`
}

function table() {
  console.log(`\ndesign pipeline · ${rel(target.project)} · ${target.slug}\n`)
  if (!existsSync(path.join(target.slugDir, 'probe.config.json'))) {
    console.log('  no probe.config.json yet — stage 0 has not run')
    console.log('')
  }
  for (const stage of stages) console.log(stageLine(stage))
  console.log('\n  ✓ artifact present   · template/optional   ~ needs finishing   ✗ missing   → routed')
  console.log('  "done" means the artifact exists and is not the template; it is not a claim that the gate passed.')
}

function earlierGaps(stage) {
  if (mode === 'existing') return []
  return prerequisitesFor(stage, stages)
}

function printEarlier(stage, label = 'before') {
  const earlier = earlierGaps(stage)
  if (!earlier.length) {
    if (mode === 'existing') console.log(`  ${label}    audit the existing surface before editing it`)
    return
  }
  const shown = earlier.slice(-4)
  const hidden = earlier.length - shown.length
  const text = shown.map((item) => `${item.id} ${item.label} (${item.status})`).join(' · ')
  console.log(`  ${label}    ${hidden ? `+${hidden} earlier · ` : ''}${text}`)
}

function commandBlock(stage, indent = '  ') {
  if (!stage.commands?.length) return
  for (const command of stage.commands) console.log(`${indent}${command}`)
}

function nextBlock(stage) {
  console.log(`\nrecommended ${stage.id} ${stage.label}`)
  printEarlier(stage)
  console.log(`  gate: ${stage.gate}`)
  console.log('  run:')
  commandBlock(stage, '    ')
}

function stageCard(stage) {
  const state = STATUS[stage.status] ?? STATUS.missing
  console.log(`\n${stage.id} · ${stage.label} — ${state.icon} ${state.label}`)
  if (stage.detail) console.log(`  artifact  ${stage.detail}`)
  console.log(`  gate      ${stage.gate}`)
  const earlier = earlierGaps(stage)
  if (earlier.length) printEarlier(stage, 'before')
  else if (mode !== 'existing') console.log('  before    nothing missing above this stage')
  else console.log('  before    audit the existing surface before editing it')
  if (stage.commands?.length) {
    console.log('  run')
    commandBlock(stage, '    ')
  } else {
    console.log('  run       this stage is authored or routed; no engine command')
  }
}

function fullPath() {
  console.log(`\nfull path · ${target.slug}\n`)
  for (const stage of stages) {
    const state = STATUS[stage.status] ?? STATUS.missing
    console.log(`${stage.id} ${stage.label} — ${state.icon} ${state.label}${stage.optional ? ' (optional)' : ''}`)
    if (stage.commands?.length) commandBlock(stage, '  ')
    console.log('')
  }
}

/* ------------------------------------------------------------------ main -- */

if (args.get('stage')) {
  const stage = stageById(args.get('stage'))
  if (!stage) fail(`unknown stage "${args.get('stage')}"\n  Known: ${STAGES.map((item) => item.id).join(', ')}`)
  const detected = stages.find((item) => item.id === stage.id)
  if (json) {
    console.log(JSON.stringify({ project: target.project, slug: target.slug, stage: detected }, null, 2))
  } else {
    stageCard(detected)
  }
  process.exit(0)
}

if (json) {
  console.log(
    JSON.stringify(
      {
        project: target.project,
        slug: target.slug,
        mode,
        stages,
        recommended: recommendFor(mode),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

function recommendFor(selectedMode) {
  if (selectedMode !== 'existing') return recommended
  const audit = stages.find((stage) => stage.name === 'audit')
  const maintain = stages.find((stage) => stage.name === 'maintain')
  return audit?.status === 'done' ? maintain : audit
}

if (args.has('ask')) {
  if (!process.stdin.isTTY) fail('--ask needs a terminal. Pass --stage <id> instead.')
  table()
  const chosenDefault = recommendFor(mode)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`\nStart at which stage? [${chosenDefault.id} ${chosenDefault.label}] `)).trim()
  rl.close()
  const stage = stageById(answer || chosenDefault.id)
  if (!stage) fail(`unknown stage "${answer}"\n  Known: ${STAGES.map((item) => item.id).join(', ')}`)
  stageCard(stages.find((item) => item.id === stage.id))
  process.exit(0)
}

if (args.has('all')) {
  table()
  fullPath()
  process.exit(0)
}

const chosen = recommendFor(mode)
if (args.has('next')) {
  nextBlock(chosen)
  process.exit(0)
}

table()
nextBlock(chosen)
