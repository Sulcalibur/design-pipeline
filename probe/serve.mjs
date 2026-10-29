#!/usr/bin/env node
/**
 * probe/serve.mjs — the local probe host.
 *
 * Serves the shared app, the project's runtime config, its images and the
 * answers file. No dependencies, no model calls, loopback only.
 *
 *   node serve.mjs --config <project>/probe.config.json [--port 4210]
 *
 * Images resolve in this order:
 *   1. the option's own `src` — an absolute file path, or an http(s) URL
 *   2. an indexed candidate file (Eagle item dir, or a folder manifest entry)
 *   3. Eagle's item directory, when the source is Eagle
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolvePaths, loadConfig, loadCandidates } from './paths.mjs'
import { resolveLibrary } from './library.mjs'

const here = import.meta.dirname
const paths = resolvePaths(process.argv.slice(2))
const args = paths.args

const port = Number(args.get('port', 4210))
const noEmit = args.has('no-emit')
const appDir = path.join(here, 'app')

const config = loadConfig(paths.config)
const source = config.sources ?? {}
const sourceKind = source.kind ?? 'eagle'
const lib = await resolveLibrary(source.path ? path.resolve(paths.root, source.path) : args.get('library-path'))
const libraryName = lib.name
const libraryPath = lib.path
const itemsDir = path.join(libraryPath, 'images')

const candidates = loadCandidates(paths.candidates) ?? []
const candidateById = new Map(candidates.map((c) => [c.id, c]))

/** Options can carry their own image, which wins over any index. */
function optionById() {
  if (!existsSync(paths.runtime)) return new Map()
  const runtime = JSON.parse(readFileSync(paths.runtime, 'utf8'))
  const map = new Map()
  for (const pair of runtime.pairs ?? []) {
    for (const option of pair.options ?? []) map.set(option.id, option)
  }
  return map
}
const options = optionById()

if (sourceKind === 'eagle' && !(process.env.EAGLE_MEDIA_URL || source.mediaServer)) {
  try {
    readdirSync(itemsDir)
  } catch (error) {
    console.error(`✗ cannot read Eagle library images: ${itemsDir} (${error.code ?? error.message})`)
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      console.error('  macOS denied file access to this process. Run serve from a terminal with iCloud Drive')
      console.error('  access, or grant Full Disk Access to the app hosting the agent. A folder source needs none.')
    }
    console.error('  Alternatively set sources.kind to "folder" (with sources.path).')
    process.exit(1)
  }
}

mkdirSync(paths.data, { recursive: true })
mkdirSync(paths.build, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
}

/** Find the display file for an Eagle item, preferring the original. */
function eagleImage(id, preferThumb) {
  if (!/^[A-Z0-9]+$/.test(id)) return null
  const dir = path.join(itemsDir, `${id}.info`)
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((n) => /\.(png|jpe?g|webp|gif)$/i.test(n))
  if (!files.length) return null
  const thumbs = files.filter((n) => /_thumbnail\.(png|jpe?g|webp)$/i.test(n))
  const originals = files.filter((n) => !thumbs.includes(n))
  const pick = preferThumb ? thumbs[0] ?? originals[0] : originals[0] ?? thumbs[0]
  return pick ? path.join(dir, pick) : null
}

/** Resolve one id to a file path, a remote URL, or null. */
function resolveImage(id, preferThumb) {
  // A preview server that runs inside Eagle has file access we lack. If one is
  // configured we hand the browser straight to it; it serves what we cannot read.
  const mediaTemplate = process.env.EAGLE_MEDIA_URL || source.mediaServer
  if (mediaTemplate && !/^(?:success|error)/i.test(mediaTemplate)) {
    return { url: mediaTemplate.replace('{id}', id) }
  }
  const option = options.get(id)
  const src = option?.src
  if (src && /^https?:\/\//i.test(src)) return { url: src }
  if (src) {
    const file = path.isAbsolute(src) ? src : path.resolve(paths.root, src)
    if (existsSync(file)) return { file }
  }
  const candidate = candidateById.get(id)
  if (candidate?.src && /^https?:\/\//i.test(candidate.src)) return { url: candidate.src }
  if (candidate?.file && existsSync(candidate.file)) return { file: candidate.file }
  if (sourceKind === 'eagle') {
    const file = eagleImage(id, preferThumb)
    if (file) return { file }
  }
  return null
}

/** Sniff the real format: Eagle writes WebP bytes into files named .png. */
function sniff(buf, fallback) {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.length > 3 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  return fallback
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}

async function readBody(req, limit = 1_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function serveFile(res, file, extra = {}) {
  const buf = readFileSync(file)
  return send(res, 200, buf, {
    'Content-Type': sniff(buf, MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'),
    ...extra,
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, await readFile(path.join(appDir, 'index.html')), { 'Content-Type': MIME['.html'] })
    }

    // Generated files live with the project, not in the shared app directory.
    if (req.method === 'GET' && url.pathname === '/probe.json') {
      if (!existsSync(paths.runtime)) return send(res, 404, 'probe.json not built: run probe.mjs build')
      return send(res, 200, await readFile(paths.runtime), { 'Content-Type': MIME['.json'] })
    }
    if (req.method === 'GET' && (url.pathname === '/sheet.html' || url.pathname === '/sheet')) {
      const file = existsSync(paths.sheet) ? paths.sheet : path.join(appDir, 'sheet.html')
      if (!existsSync(file)) return send(res, 404, 'sheet not built: run probe.mjs sheet')
      return send(res, 200, await readFile(file), { 'Content-Type': MIME['.html'] })
    }

    if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
      const id = decodeURIComponent(url.pathname.slice(5))
      const found = resolveImage(id, url.searchParams.get('thumb') === '1')
      if (!found) return send(res, 404, 'not found')
      if (found.url) return send(res, 302, '', { Location: found.url })
      return serveFile(res, found.file, { 'Cache-Control': 'public, max-age=3600' })
    }

    if (req.method === 'GET' && url.pathname === '/api/answers') {
      if (!existsSync(paths.answers)) return send(res, 200, '[]', { 'Content-Type': MIME['.json'] })
      return send(res, 200, await readFile(paths.answers), { 'Content-Type': MIME['.json'] })
    }

    if (req.method === 'POST' && url.pathname === '/api/answers') {
      const raw = await readBody(req)
      const payload = JSON.parse(raw)
      const existing = existsSync(paths.answers) ? JSON.parse(readFileSync(paths.answers, 'utf8')) : []
      const history = Array.isArray(existing) ? existing : []
      const record = { receivedAt: new Date().toISOString(), ...payload }
      // One record per session view: replace an earlier save from the same run.
      const next = history.filter((r) => r.runId !== record.runId)
      next.push(record)
      writeFileSync(paths.answers, JSON.stringify(next, null, 2))

      // Saving a complete run emits the spec. Partial saves still land on disk.
      let emitted = false
      let emitError = null
      if (!noEmit) {
        const forwarded = forwardArgs()
        const result = spawnSync(process.execPath, [path.join(here, 'emit.mjs'), ...forwarded], {
          encoding: 'utf8',
          timeout: 20_000,
        })
        emitted = result.status === 0
        if (!emitted) emitError = (result.stderr || result.stdout || 'emit failed').trim().slice(0, 300)
      }

      return send(
        res,
        200,
        JSON.stringify({ ok: true, saved: record.runId ?? null, emitted, emitError }),
        { 'Content-Type': MIME['.json'] },
      )
    }

    if (req.method === 'GET') {
      const rel = url.pathname.replace(/^\/+/, '')
      const file = path.resolve(appDir, rel)
      if (!file.startsWith(appDir + path.sep)) return send(res, 403, 'forbidden')
      if (!existsSync(file)) return send(res, 404, 'not found')
      const buf = await readFile(file)
      return send(res, 200, buf, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      })
    }

    send(res, 404, 'not found')
  } catch (error) {
    console.error(error)
    send(res, 500, error.message)
  }
})

/** Emit must resolve the same project this server is serving. */
function forwardArgs() {
  const out = ['--config', paths.config]
  if (paths.out !== path.dirname(paths.config)) out.push('--out', paths.out)
  if (paths.data !== path.join(path.dirname(paths.config), 'data')) out.push('--data', paths.data)
  if (paths.build !== path.join(path.dirname(paths.config), 'build')) out.push('--build', paths.build)
  return out
}

server.listen(port, '127.0.0.1', () => {
  console.log(`probe → http://127.0.0.1:${port}`)
  const where = sourceKind === 'eagle' ? `eagle · ${libraryName} (${lib.source})` : `folder · ${path.relative(process.cwd(), libraryPath)}`
  console.log(`source → ${where}`)
  console.log(`answers → ${path.relative(process.cwd(), paths.answers)}`)
  console.log(`images → ${options.size} options · ${candidates.length} indexed candidates`)
})
