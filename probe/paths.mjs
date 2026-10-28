/**
 * probe/paths.mjs — one place that decides where a project's files live.
 *
 * The engine is shared; the content is per project. Everything is resolved
 * from `--config`, whose directory is the project folder:
 *
 *   <project>/probe.config.json     the source of truth (edited by a human/agent)
 *   <project>/data/                 answers.json, candidates.json (generated, ignored)
 *   <project>/build/                probe.json, sheet.html (generated runtime)
 *   <project>/05-probe.md           readback (generated)
 *   <project>/design-spec.json      machine spec (generated)
 *
 * Every path can be overridden, which is what makes the engine usable from a
 * shared tool directory against a project that lives anywhere.
 */
import path from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set()
  const values = {}
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const name = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      values[name] = next
      i += 1
    } else {
      flags.add(name)
    }
  }
  return {
    flags,
    values,
    positionals,
    has: (name) => flags.has(name),
    get: (name, fallback) => (values[name] !== undefined ? values[name] : fallback),
  }
}

export function resolvePaths(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv)
  const config = path.resolve(cwd, args.get('config', 'probe.config.json'))
  const root = path.dirname(config)

  // A project can describe its own layout, so no wrapper script is needed:
  // { "paths": { "out": "../home-refresh", "data": "data", "build": "build" } }
  let declared = {}
  try {
    if (existsSync(config)) declared = JSON.parse(readFileSync(config, 'utf8')).paths ?? {}
  } catch {
    declared = {}
  }
  const pick = (flag, key, fallback) => {
    const fromFlag = args.get(flag)
    if (fromFlag) return path.resolve(cwd, fromFlag)
    if (declared[key]) return path.resolve(root, declared[key])
    return fallback
  }

  const out = pick('out', 'out', root)
  const data = pick('data', 'data', path.join(root, 'data'))
  const build = pick('build', 'build', path.join(root, 'build'))
  return {
    args,
    config,
    root,
    out,
    data,
    build,
    answers: path.join(data, 'answers.json'),
    candidates: path.join(data, 'candidates.json'),
    writeback: path.join(data, 'eagle-writeback.json'),
    runtime: path.join(build, 'probe.json'),
    sheet: path.join(build, 'sheet.html'),
    readback: path.join(out, '05-probe.md'),
    spec: path.join(out, 'design-spec.json'),
  }
}

export function loadConfig(configPath) {
  if (!existsSync(configPath)) fail(`config not found: ${configPath}`)
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    fail(`config is not valid JSON: ${error.message}`)
  }
}

export function loadCandidates(candidatesPath) {
  if (!existsSync(candidatesPath)) return null
  return JSON.parse(readFileSync(candidatesPath, 'utf8'))
}

export function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** Relative path for human-facing logs; absolute when it leaves the cwd. */
export const rel = (p) => {
  const r = path.relative(process.cwd(), p)
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p
}
