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
  let cursor = path.resolve(startDir, '..', '..')
  if (!path.basename(path.dirname(startDir)) === 'design') cursor = startDir
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

/** The parts a page direction or spec can carry forward. */
export function brandBlock(data) {
  if (!data) return null
  const slots = data.slots ?? {}
  const value = (id) => {
    const slot = slots[id]
    return slot?.value ?? null
  }
  const list = (id) => (Array.isArray(value(id)) ? value(id) : value(id) ? [value(id)] : [])
  const dials = data.direction?.dials ?? {}
  return {
    product: data.product ?? null,
    promise: value('b1'),
    enemy: value('b5'),
    bannedWords: list('c1-banned'),
    voiceRules: list('c1-rules'),
    forbidden: list('v8'),
    palette: data.identity?.palette ?? null,
    type: data.identity?.type ?? null,
    dials,
    status: (data.gaps?.length ?? 0) > 0
      ? `${data.gaps.length} gap(s)`
      : 'complete',
  }
}
