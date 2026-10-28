/**
 * probe/image.mjs — read a reference image and measure what pixels can prove.
 *
 * No dependencies. macOS `sips` decodes any format it knows (PNG, JPEG, WebP)
 * and writes a small uncompressed BMP, which is cheap to parse here.
 *
 * What this measures: palette and its proportions, background, whitespace,
 * luminance + contrast, colour temperature, edge density, section bands and a
 * rough column count.
 *
 * What it deliberately does NOT measure: font families, style names or intent.
 * Those are judgement and belong to the authored layer; a heuristic guess at a
 * typeface is worse than an empty field.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, unlinkSync, mkdirSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

export const METHOD = 'pixel-heuristics@1'
export const LIMITS = [
  'Palette is quantised from a downscaled image; anti-aliasing shifts edge colours.',
  'Section bands and columns are inferred from edge energy, not read from the DOM.',
  'No font identification: a screenshot does not carry the face, only its shapes.',
  'Style, devices and intent are authored, not measured.',
]

const SAMPLE_WIDTH = 128
const MAX_ROWS = 6000

/** Decode a 24/32-bit uncompressed BMP into RGB triples. */
export function decodeBmp(buf) {
  if (buf.toString('ascii', 0, 2) !== 'BM') throw new Error('not a BMP')
  const offset = buf.readUInt32LE(10)
  const width = buf.readInt32LE(18)
  const rawHeight = buf.readInt32LE(22)
  const bpp = buf.readUInt16LE(28)
  const compression = buf.readUInt32LE(30)
  if (compression !== 0) throw new Error('compressed BMP is not supported')
  if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported BMP depth: ${bpp}`)

  const topDown = rawHeight < 0
  const height = Math.abs(rawHeight)
  const bytesPerPixel = bpp / 8
  const rowSize = Math.ceil((width * bpp) / 8 / 4) * 4
  const data = new Uint8Array(width * height * 3)

  for (let y = 0; y < height; y += 1) {
    const srcRow = topDown ? y : height - 1 - y
    const rowStart = offset + srcRow * rowSize
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + x * bytesPerPixel
      const out = (y * width + x) * 3
      data[out] = buf[p + 2] // BGR -> RGB
      data[out + 1] = buf[p + 1]
      data[out + 2] = buf[p]
    }
  }
  return { width, height, data }
}

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

/** Downscale with sips, then decode. Returns null when the file cannot be read. */
export function loadPixels(file) {
  const tmp = path.join(os.tmpdir(), `probe-img-${process.pid}-${Date.now()}.bmp`)
  try {
    execFileSync(
      'sips',
      ['-s', 'format', 'bmp', '--resampleWidth', String(SAMPLE_WIDTH), file, '--out', tmp],
      { stdio: 'ignore' },
    )
    const img = decodeBmp(readFileSync(tmp))
    if (img.height > MAX_ROWS) {
      // Keep the top and a tail sample so a 20k-pixel page still yields bands.
      const keep = Math.floor(MAX_ROWS / 2)
      const head = img.data.slice(0, keep * img.width * 3)
      const tail = img.data.slice((img.height - keep) * img.width * 3)
      const data = new Uint8Array(head.length + tail.length)
      data.set(head, 0)
      data.set(tail, head.length)
      return { width: img.width, height: keep * 2, data, truncated: true, fullHeight: img.height }
    }
    return img
  } catch {
    return null
  } finally {
    try {
      unlinkSync(tmp)
    } catch {}
  }
}

function quantise(img) {
  const buckets = new Map()
  for (let i = 0; i < img.data.length; i += 3) {
    const r = img.data[i]
    const g = img.data[i + 1]
    const b = img.data[i + 2]
    // 5 bits per channel keeps distinct accents apart without fragmenting a gradient.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const entry = buckets.get(key)
    if (entry) {
      entry.r += r
      entry.g += g
      entry.b += b
      entry.n += 1
    } else {
      buckets.set(key, { r, g, b, n: 1 })
    }
  }

  const sorted = [...buckets.values()]
    .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n }))
    .sort((a, b) => b.n - a.n)

  const merged = []
  for (const entry of sorted) {
    const near = merged.find((m) => dist([m.r, m.g, m.b], [entry.r, entry.g, entry.b]) < 42)
    if (near) {
      const total = near.n + entry.n
      near.r = (near.r * near.n + entry.r * entry.n) / total
      near.g = (near.g * near.n + entry.g * entry.n) / total
      near.b = (near.b * near.n + entry.b * entry.n) / total
      near.n = total
    } else {
      merged.push({ ...entry })
      if (merged.length >= 24) break
    }
  }
  return merged
}

export function measure(img) {
  const pixels = img.width * img.height
  const merged = quantise(img)
  const total = merged.reduce((sum, c) => sum + c.n, 0)

  const palette = merged.slice(0, 6).map((c) => ({
    hex: hex(c.r, c.g, c.b),
    share: Number((c.n / total).toFixed(3)),
    neutral: Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 18,
  }))
  const background = palette[0] ?? { hex: '#000000', share: 1 }

  let neutral = 0
  let lumSum = 0
  let lumSq = 0
  let warm = 0
  let bg = 0
  const bgRgb = merged[0] ?? { r: 0, g: 0, b: 0 }
  for (let i = 0; i < img.data.length; i += 3) {
    const r = img.data[i]
    const g = img.data[i + 1]
    const b = img.data[i + 2]
    if (Math.max(r, g, b) - Math.min(r, g, b) < 18) neutral += 1
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lumSum += lum
    lumSq += lum * lum
    warm += r - b
    if (dist([r, g, b], [bgRgb.r, bgRgb.g, bgRgb.b]) < 42) bg += 1
  }
  const meanLum = lumSum / pixels
  const variance = Math.max(0, lumSq / pixels - meanLum * meanLum)

  // Edge energy: one pass, used for density, row bands and column guess.
  const rowEnergy = new Float64Array(img.height)
  const colEnergy = new Float64Array(img.width)
  let edges = 0
  const lumAt = (x, y) => {
    const i = (y * img.width + x) * 3
    return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]
  }
  for (let y = 0; y < img.height - 1; y += 1) {
    for (let x = 0; x < img.width - 1; x += 1) {
      const here = lumAt(x, y)
      const dx = Math.abs(lumAt(x + 1, y) - here)
      const dy = Math.abs(lumAt(x, y + 1) - here)
      const energy = dx + dy
      rowEnergy[y] += energy
      colEnergy[x] += energy
      if (energy > 60) edges += 1
    }
  }

  const edgeDensity = Number((edges / pixels).toFixed(4))
  const whitespace = Number((bg / pixels).toFixed(3))
  // Whitespace is the stable signal at this scale; edge density is reported raw
  // because at 128px wide, body text is below the resolution that creates edges.
  const visualDensity = whitespace > 0.58 ? 'airy' : whitespace < 0.32 ? 'dense' : 'balanced'

  // Bands: rows carrying content, separated by calm gaps.
  const rowMean = rowEnergy.reduce((a, b) => a + b, 0) / img.height
  const gap = Math.max(2, Math.round(img.height * 0.012))
  let bands = 0
  let inContent = false
  let calm = 0
  for (let y = 0; y < img.height; y += 1) {
    const content = rowEnergy[y] > rowMean * 0.7
    if (content) {
      if (!inContent) bands += 1
      inContent = true
      calm = 0
    } else {
      calm += 1
      if (calm >= gap) inContent = false
    }
  }

  // Columns: interior gutters in the hero region, not edge peaks. A single text
  // column has no interior gutter; a three-up grid has two.
  const heroRows = Math.max(1, Math.round(img.height * 0.25))
  const heroCol = new Float64Array(img.width)
  for (let y = 0; y < heroRows; y += 1) {
    for (let x = 0; x < img.width - 1; x += 1) {
      heroCol[x] += Math.abs(lumAt(x + 1, y) - lumAt(x, y))
    }
  }
  const smooth = new Float64Array(img.width)
  const radius = Math.max(1, Math.round(img.width * 0.03))
  for (let x = 0; x < img.width; x += 1) {
    let sum = 0
    let n = 0
    for (let k = -radius; k <= radius; k += 1) {
      const xi = x + k
      if (xi < 0 || xi >= img.width) continue
      sum += heroCol[xi]
      n += 1
    }
    smooth[x] = sum / (n || 1)
  }
  const colMax = Math.max(...smooth) || 1
  const minGutter = Math.max(2, Math.round(img.width * 0.05))
  let gutters = 0
  let run = 0
  for (let x = 0; x < img.width; x += 1) {
    if (smooth[x] < colMax * 0.12) {
      run += 1
    } else {
      if (run >= minGutter && x - run > 1 && x < img.width - 1) gutters += 1
      run = 0
    }
  }
  const columns = Math.max(1, Math.min(3, gutters + 1))

  // Alignment: where the edge mass sits across the width.
  const third = img.width / 3
  let left = 0
  let middle = 0
  let right = 0
  for (let x = 0; x < img.width; x += 1) {
    if (x < third) left += colEnergy[x]
    else if (x < third * 2) middle += colEnergy[x]
    else right += colEnergy[x]
  }
  const mass = left + middle + right || 1
  const alignment = middle / mass > 0.45 ? 'centred' : left / mass > 0.45 ? 'left-led' : 'balanced'

  return {
    palette,
    background,
    whitespace,
    neutralShare: Number((neutral / pixels).toFixed(3)),
    accentShare: Number((1 - neutral / pixels).toFixed(3)),
    luminance: Number((meanLum / 255).toFixed(3)),
    contrast: Number((Math.sqrt(variance) / 128).toFixed(3)),
    temperature: Number((warm / pixels / 255).toFixed(3)),
    edgeDensity,
    visualDensity,
    bands: Math.max(1, Math.min(12, bands)),
    columns: Math.max(1, Math.min(4, columns)),
    alignment,
    aspect: Number((img.fullHeight ?? img.height) / img.width),
  }
}

/** Find a displayable image for an indexed candidate. */
export function imageFileFor(candidate) {
  if (!candidate?.file) return null
  const stat = (() => {
    try {
      return statSync(candidate.file)
    } catch {
      return null
    }
  })()
  if (!stat) return null
  if (stat.isFile()) return candidate.file
  try {
    const files = readdirSync(candidate.file).filter((n) => /\.(png|jpe?g|webp|gif|tiff?)$/i.test(n))
    const originals = files.filter((n) => !/_thumbnail\./i.test(n))
    const pick = originals[0] ?? files[0]
    return pick ? path.join(candidate.file, pick) : null
  } catch {
    return null
  }
}

export function cacheKey(libraryPath, id) {
  return createHash('sha1').update(`${libraryPath}::${id}`).digest('hex').slice(0, 12)
}

export function cacheDir() {
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), 'Library/Caches')
  const dir = path.join(base, 'design-pipeline', 'images')
  mkdirSync(dir, { recursive: true })
  return dir
}
