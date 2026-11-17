/**
 * probe/library.mjs — which Eagle library is this run talking about?
 *
 * Order: an explicit path (config or --library) → $EAGLE_LIBRARY → the library
 * Eagle currently has open (Web API v2) → the old iCloud default.
 *
 * Asking the app is the only honest answer once there is more than one library,
 * or after a merge renames it.
 */
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'

const API = 'http://localhost:41595/api/v2'

export async function activeLibrary(timeoutMs = 2500) {
  try {
    const res = await fetch(`${API}/library/info`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const json = await res.json()
    const data = json?.data
    if (!data?.path) return null
    return { path: data.path, name: data.name ?? path.basename(data.path, '.library'), info: data, source: 'eagle' }
  } catch {
    return null
  }
}

export async function resolveLibrary(explicit) {
  if (explicit) return { path: path.resolve(explicit), name: path.basename(path.resolve(explicit), '.library'), source: 'config' }
  if (process.env.EAGLE_LIBRARY) {
    const p = path.resolve(process.env.EAGLE_LIBRARY)
    return { path: p, name: path.basename(p, '.library'), source: 'env' }
  }
  const active = await activeLibrary()
  if (active) return active
  // Legacy default from the machine this engine grew up on. Only use it when it
  // actually exists; otherwise report that no library was found rather than
  // handing callers an invented path.
  const legacy = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Eagle/Inspirations.library')
  if (existsSync(legacy)) return { path: legacy, name: 'Inspirations', source: 'legacy-default' }
  return { path: null, name: 'not found', source: 'none' }
}

/** Flatten the folder tree from library/info into id -> name. */
export function folderNames(info) {
  const map = {}
  const walk = (folders) => {
    for (const f of folders ?? []) {
      map[f.id] = f.name
      walk(f.children)
    }
  }
  walk(info?.folders)
  return map
}

export async function apiAvailable(timeoutMs = 2000) {
  try {
    const res = await fetch(`${API}/app/info`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * The media server can be configured as a full template
 * (`http://host:41532/api/items/{id}/file`) or as a bare base
 * (`http://host:41532`). `EAGLE_MEDIA_BASE` is the shorthand for the base form.
 */
export function mediaSource(sources) {
  return process.env.EAGLE_MEDIA_URL || process.env.EAGLE_MEDIA_BASE || sources?.mediaServer || null
}

export function mediaUrl(source, id) {
  if (!source) return null
  const s = String(source).trim()
  if (s.includes('{id}')) return s.replaceAll('{id}', encodeURIComponent(id))
  return `${s.replace(/\/+$/, '')}/api/items/${encodeURIComponent(id)}/file`
}
