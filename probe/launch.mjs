#!/usr/bin/env node
/**
 * probe/launch.mjs — the pre-flight for a live surface.
 *
 * Checks the things that are invisible in a screenshot and expensive after a
 * launch: transport, redirects, security headers, robots, sitemap, a real 404,
 * indexing directives, social metadata, and certificate expiry. Records the
 * previous deploy so a rollback has a target.
 *
 *   node launch.mjs --config docs/design/launch/probe.config.json --url https://acme.test/
 *   node launch.mjs --project . --url https://acme.test/ --previous <commit-or-deploy-id>
 *
 * Writes docs/design/<slug>/launch.md (or docs/launch.md). Exits 1 on a
 * blocking find.
 */
import path from 'node:path'
import { parseArgs, fail, rel } from './paths.mjs'
import {
  Report,
  fetchText,
  parseHtml,
  resolveContext,
  writeDoc,
  tlsExpiry,
  daysUntil,
  nowDate,
} from './checks.mjs'

const SECURITY = {
  'strict-transport-security': { sev: 'major', label: 'HSTS' },
  'content-security-policy': { sev: 'major', label: 'CSP' },
  'x-content-type-options': { sev: 'major', label: 'nosniff' },
  'referrer-policy': { sev: 'minor', label: 'Referrer-Policy' },
  'permissions-policy': { sev: 'minor', label: 'Permissions-Policy' },
}

export async function reviewLaunch({ url, www = null, previous = null }) {
  const report = new Report('Launch pre-flight')
  let target
  try {
    target = new URL(url)
  } catch {
    report.add('blocking', 'url-invalid', `not a URL: ${url}`)
    return report
  }
  if (target.protocol !== 'https:') report.add('blocking', 'https-missing', 'the launch URL is not HTTPS')

  const page = await fetchText(url, { redirect: 'follow' })
  report.row('url', url)
  report.row('final URL', page.url)
  report.row('response', `${page.status} in ${page.ms}ms`)
  if (!page.ok) {
    report.add('blocking', 'page-unreachable', `${url} → ${page.status || page.error}`)
    return report
  }

  const facts = parseHtml(page.body, page.url)

  /* --------------------------------------------------------- transport ---- */
  const httpProbe = await fetchText(`http://${target.host}/`, { redirect: 'manual' })
  if (httpProbe.status >= 300 && httpProbe.status < 400) {
    const loc = httpProbe.headers.location ?? ''
    if (!/^https:/i.test(loc)) report.add('major', 'http-redirect', `http redirects to ${loc || 'nowhere'} rather than https`)
  } else if (httpProbe.status === 200) {
    report.add('major', 'http-served', 'http:// serves a 200 instead of redirecting to https')
  }

  if (www) {
    const alt = await fetchText(www, { redirect: 'manual' })
    const loc = alt.headers.location ?? ''
    if (alt.status >= 300 && alt.status < 400) report.row('www redirect', `${alt.status} → ${loc}`)
    else report.add('minor', 'www-no-redirect', `${www} answers ${alt.status} rather than redirecting`)
  }

  const tls = await tlsExpiry(target.hostname)
  if (tls.error) report.add('major', 'tls-read', `certificate could not be read: ${tls.error}`)
  else {
    const days = daysUntil(tls.validTo)
    report.row('certificate', `${tls.issuer ?? 'issuer unknown'} · expires ${new Date(tls.validTo).toISOString().slice(0, 10)} (${days}d)`)
    if (days != null && days < 0) report.add('blocking', 'tls-expired', 'the certificate has expired')
    else if (days != null && days < 14) report.add('major', 'tls-expiring', `certificate expires in ${days} day(s)`)
  }

  /* ------------------------------------------------------------ headers ---- */
  for (const [header, rule] of Object.entries(SECURITY)) {
    const value = page.headers[header]
    if (!value) report.add(rule.sev, `header-${header}`, `${rule.label} header is absent`)
    else {
      report.row(rule.label, value.slice(0, 90))
      if (header === 'content-security-policy' && /unsafe-(inline|eval)/i.test(value)) {
        report.add('minor', 'csp-unsafe', `CSP allows ${/unsafe-eval/i.test(value) ? 'unsafe-eval' : 'unsafe-inline'}`)
      }
    }
  }
  if (!page.headers['x-frame-options'] && !/frame-ancestors/i.test(page.headers['content-security-policy'] ?? '')) {
    report.add('minor', 'frame-options', 'no X-Frame-Options and no frame-ancestors in the CSP')
  }
  for (const leak of ['server', 'x-powered-by']) {
    if (page.headers[leak] && /\d/.test(page.headers[leak])) report.add('info', 'header-leak', `${leak}: ${page.headers[leak]}`)
  }

  /* --------------------------------------------------------- robots/sitemap -- */
  const robots = await fetchText(new URL('/robots.txt', target.origin).toString())
  let sitemapHint = null
  if (!robots.ok) report.add('major', 'robots-missing', `robots.txt → ${robots.status || robots.error}`)
  else {
    report.row('robots.txt', `${robots.status}`)
    if (/^\s*Disallow:\s*\/\s*$/im.test(robots.body)) report.add('blocking', 'robots-blocked', 'robots.txt disallows the whole site')
    sitemapHint = /^\s*Sitemap:\s*(\S+)/im.exec(robots.body)?.[1] ?? null
    if (!sitemapHint) report.add('minor', 'robots-sitemap', 'robots.txt names no Sitemap')
  }

  const sitemapUrl = sitemapHint ?? new URL('/sitemap.xml', target.origin).toString()
  const sitemap = await fetchText(sitemapUrl)
  if (!sitemap.ok) report.add('major', 'sitemap-missing', `${sitemapUrl} → ${sitemap.status || sitemap.error}`)
  else {
    const locs = [...sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].length
    report.row('sitemap', `${sitemapUrl} · ${locs} URL(s)`)
    if (!/<(urlset|sitemapindex)\b/i.test(sitemap.body)) report.add('major', 'sitemap-shape', 'sitemap is not a urlset or sitemapindex')
    if (!locs) report.add('major', 'sitemap-empty', 'sitemap contains no <loc> entries')
  }

  /* ----------------------------------------------------------------- 404 ---- */
  const missing = `${target.origin}/__probe-404-${Math.random().toString(36).slice(2, 8)}`
  // A browser sends Accept: text/html; a bare fetch gets the JSON error body,
  // which is not the 404 a reader sees. Ask the way a browser asks.
  const notFound = await fetchText(missing, { headers: { accept: 'text/html' } })
  if (notFound.status !== 404) report.add('major', '404-status', `${missing} answers ${notFound.status || notFound.error}, not 404`)
  else {
    report.row('404', '404 returned')
    if (notFound.body.length < 250 || !/<a\b[^>]*href=/i.test(notFound.body)) {
      report.add('minor', '404-bare', 'the 404 body is short or offers no link back')
    }
  }

  /* ---------------------------------------------------------------- page ---- */
  if (/noindex/i.test(facts.robots ?? '')) report.add('blocking', 'noindex', 'the page is noindex')
  if (!facts.lang) report.add('major', 'lang-missing', '<html lang> is absent')
  if (!facts.viewport) report.add('major', 'viewport-missing', 'no viewport meta')
  if (!facts.canonical) report.add('minor', 'canonical-missing', 'no canonical link')
  if (!facts.icon) report.add('minor', 'favicon-missing', 'no favicon link')
  if (!facts.og['og:title']) report.add('minor', 'og-title', 'og:title is absent')
  if (!facts.og['og:image']) report.add('minor', 'og-image', 'og:image is absent')
  if (!facts.twitter['twitter:card']) report.add('minor', 'twitter-card', 'twitter:card is absent')

  report.row('title', facts.title ?? '—')
  report.row('description', facts.description ? `${facts.description.length} chars` : 'absent')
  report.row('previous deploy', previous ?? 'not recorded')
  report.note('A launch is not a one-way door: record the previous deploy and the rollback command before promoting.')
  if (!previous) report.add('minor', 'rollback-missing', 'no previous deploy recorded — pass --previous <ref> so a rollback has a target')
  report.row('checked', nowDate())
  return report
}

/* -------------------------------------------------------------------- CLI -- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const url = args.get('url')
  if (!url) fail('launch needs a URL: node launch.mjs --url https://example.com/')
  const ctx = resolveContext(args)
  const report = await reviewLaunch({ url, www: args.get('www', null), previous: args.get('previous', null) })

  if (args.has('json')) console.log(JSON.stringify(report.json(), null, 2))
  else {
    process.stdout.write(report.render({ intro: `Target: ${url}` }))
    if (!args.has('no-write')) {
      const file = writeDoc(ctx.docDir, 'launch.md', report.render({ intro: `Target: ${url}` }))
      console.log(`\n→ ${rel(file)}`)
    }
  }
  process.exit(report.blocking ? 1 : 0)
}
