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
  const p = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Eagle/Inspirations.library')
  return { path: p, name: 'Inspirations', source: 'default' }
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
