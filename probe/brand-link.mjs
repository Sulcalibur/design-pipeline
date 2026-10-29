/**
 * probe/brand-link.mjs — find the project's brand record.
 *
 * The brand is project-scoped (`docs/brand/`), while the probe is slug-scoped
 * (`docs/design/<slug>/`). Walking up keeps them linked by convention rather
 * than by a path in a config.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

export function findBrandRecord(startDir) {
  // The config itself sits in docs/design/<slug>/; walk up to the project root
  // so a brand record is found by convention, not by a path in a config.
  let cursor = path.resolve(startDir)
  while (cursor !== path.dirname(cursor)) {
    const file = path.join(cursor, 'docs', 'brand', 'brand.json')
    if (existsSync(file)) {
      return { file }
    }
    cursor = path.dirname(cursor)
  }
  return null
}

export function loadBrandRecord(startDir, { readFile }) {
  const found = findBrandRecord(startDir)
  if (!found) return null
  try {
    const data = JSON.parse(readFile(found.file, 'utf8'))
    return { file: found.file, data }
  } catch {
    return null
  }
}

/** A slot's value as a clean list — multi-line strings become rows. */
function asLines(slot) {
  const v = slot?.value ?? null
  if (v == null) return []
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  return String(v)
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
}

/** The parts a page direction or spec can carry forward. */
export function brandBlock(data) {
  if (!data) return null
  const slots = data.slots ?? {}
  const value = (id) => slots[id]?.value ?? null
  const dials = data.direction?.dials ?? {}
  return {
    product: data.product ?? null,
    promise: value('b1'),
    enemy: value('b5'),
    bannedWords: asLines(slots['c1-banned']),
    voiceRules: asLines(slots['c1-rules']),
    forbidden: asLines(slots['v8']),
    palette: data.identity?.palette ?? null,
    type: data.identity?.type ?? null,
    dials,
    status: (data.gaps?.length ?? 0) > 0 ? `${data.gaps.length} gap(s)` : 'complete',
  }
}
