# Design pipeline

One shared engine, one skill, one agent. Projects hold only their own content.

The engine is an **adaptive reference probe**: an intake interview, then image pairs chosen by the
answers, then a consistency check and conditional follow-ups. It emits a portable spec — a direction
someone can build from, with the tensions you resolved recorded as evidence.

No model calls at runtime. No dependencies. Everything the probe needs is a config and some images.

## What lives where

```
~/Developer/tools/design-pipeline/     this repo — code only, no project content
  probe/                                the engine (probe.mjs is the entry point)
  templates/                            the five design documents + a starter config
  presets/                              one worked example (Sulcalibur), for reference
~/.agents/skills/design-pipeline/       the runbook every agent loads
```

A project gets exactly one folder:

```
<project>/docs/design/<slug>/
  probe.config.json      the source of truth (you or the agent author this)
  00-brief.md            the loop templates, created if absent
  01-references.md
  02-direction.md        gets a generated "Probe result" block; never overwritten
  03-structure.md
  04-assets.md
  05-probe.md            generated readback
  design-spec.json       generated machine spec
  data/                  answers.json, candidates.json (gitignored)
  build/                 probe.json, sheet.html (generated, gitignored)
  references/manifest.json   only when sources.kind is "folder"
```

## Start, at any stage

```bash
node probe/probe.mjs init --project ~/Developer/projects/SomeProject --slug home-refresh
```

`init` inspects the project and reports what it found — `design.md`, `tokens.json`, framework, other
design slugs, `.hallmark/` — then creates only what is missing. Existing briefs and directions are
left untouched. Starting mid-pipeline is expected: a project may already have a brief, or a built
page, or nothing.

## Wrappers

```bash
bin/probe    status|init|ingest|sheet|build|serve|emit|record    # from any project
bin/sloplint <files|--url …> [--render]                          # Hallmark's sweep
```

`bin/sloplint` sets `HALLMARK_PUPPETEER` to this repo and `CHROME_PATH` to an isolated automation
browser, so `--render` works from a project directory with no environment variables. Add `bin/` to
`PATH` to call them as `probe` and `sloplint`.

## The loop

```bash
node probe/probe.mjs ingest  --config <project>/docs/design/<slug>/probe.config.json
node probe/probe.mjs analyze --config …   # measure palette, density, bands, columns
node probe/probe.mjs sheet   --config …
node probe/probe.mjs build  --config …
node probe/probe.mjs serve  --config …
# answer in the browser; saving runs emit
node probe/probe.mjs emit   --config …
node probe/probe.mjs record --config … [--apply]
```

`build` validates before writing: every image id resolves, every pair has two options, every `when`
key exists as a constraint, every confirm pair points at a real base pair. A broken config is refused,
not half-written.

`record` writes verdicts back into Eagle (`probe:<id>`, `axis:<axis>`, `verdict:picked|rejected|neither`).
Dry run unless `--apply`; needs Eagle running on `:41595`.

## Reference profiles

`analyze` writes a two-layer profile per image:

- **measured** — palette with shares, background, whitespace, luminance, contrast, colour temperature,
  edge density, section bands, a column hint, alignment, aspect. Deterministic, cached machine-wide in
  `~/Library/Caches/design-pipeline/`, keyed by library + id + mtime.
- **authored** — `style`, `typeVoice`, `layout`, `devices[]`, `avoid[]`, `rating`, `notes`. Written by the
  agent or a person, and preserved when a refresh re-measures.

The project keeps both in `data/analysis.json`, which is tracked: the measured half is regenerable, the
authored half is knowledge. The contact sheet shows palette chips and density per card, and `emit`
carries each chosen source's profile into `design-spec.json`.

No OCR, no font identification, no style classification. A screenshot has no box model and no font
metadata; guessing either would be worse than leaving it empty.

## The live layer

`live` reads the reference's page, not its pixels: real font stacks, computed colours, declared
`--custom-properties`, section sizes and grid columns, motion counts, basic a11y facts, plus a 1440×900
screenshot. Gallery captures are refused — a `land-book` URL is the gallery, not the site.

```bash
node probe/probe.mjs live --config …
```

This is the truth for fonts and tokens; the saved capture remains the truth for what you actually saw.
Where they disagree, record the drift rather than replacing one with the other.

## Brand interview

```bash
node probe/probe.mjs brand scaffold --project .
node probe/probe.mjs brand serve    --project .
```

A local app asking 39 brand questions one at a time — positioning (the twelve from `brand-breakdown`),
visual identity (logo, colour roles, type roles, imagery, motion, forbidden territory) and direction (three
decisions, one refusal, six dials). The type question offers six curated pairings rendered live in Google
Fonts; `probe fonts --project .` indexes the specimens in your Eagle library so they appear beside them.
Every answer carries a status and a source. It emits `docs/brand/brand.md` with a computed contrast table
and a gap table, plus `brand.json` for agents.

## Verify a built page

```bash
node probe/probe.mjs audit --url http://localhost:3000/ --slug home-refresh
```

Lighthouse in the cached Chrome for Testing — performance, accessibility (axe-core), best practices and
SEO — written as `audit.json` plus a short `audit.md` for `review.md`. Every failing audit is fixed or
waived with a reason; a score is not a pass. `templates/review.md` carries the table.

## Preview a run

```bash
node probe/probe.mjs preview --config …
```

Writes `preview.html` beside the run: six pairs (or however many the config holds), each showing the
screenshot, palette chips, measured density, live fonts and section list, and the authored note where a
person or model has looked. Images are copied next to the page, so it opens offline. Clicking a side
records a choice; export copies the JSON.

It names its sources, so it is a review surface, not the blind interview.

## URL canonicalisation

`links` records three forms of every reference URL: the raw `linkedAs` href, the canonical `siteUrl`
(`ref`, `utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_*`, `_hs*`, `igshid`, `trk`, `campaign`, `affiliate`
removed; fragment, default port, trailing slash and param order normalised) and the verified `finalUrl`
after redirects.

```bash
probe links --clean 'https://frontapp.com/?ref=lapaninja'   # → https://frontapp.com/
```

Per project: `"links": { "stripQuery": "tracking", "keepParams": ["page", "id"] }`.
`--strip all` keeps no params; `--strip none` keeps everything for debugging.

## Paths

Every path is resolved from `--config`; each can be overridden with `--out`, `--data`, `--build`, or
declared in the config itself:

```jsonc
{
  "paths": { "out": "../home-refresh", "data": "data", "build": "build" },
  "sources": { "kind": "folder", "path": "references" }
}
```

This is how a project keeps its outputs beside its config without a wrapper script.

## Reference sources

**Eagle** (default). Reads the library Eagle has open through Web API v2 — metadata needs no file
permission — classifies specimens/assets/mood pins out, and serves images from Eagle's item
directories when the process can read them. The library path resolves as `sources.path` → `$EAGLE_LIBRARY`
→ the iCloud default, so one shell export covers every project. Keep the library on a local path: iCloud
Drive can offload files and macOS denies a non-GUI process access to `~/Library/Mobile Documents`. The index is matched by item count, then read in one
pass. Eagle's API has no working search — page `/api/item/list` and filter client-side.

**Preview server.** Eagle plugins run inside the app, where file access is not a problem. Media Preview
Server (default port 41532) serves item bytes at `/api/items/{id}/file`; set
`EAGLE_MEDIA_URL="http://127.0.0.1:41532/api/items/{id}/file"` (or `"sources": { "mediaServer": "…" }`)
and the serve path redirects to it, while analyze fetches to a temp file and measures. No file access from
this process is needed.

**Folder.** `sources.kind: "folder"` reads `references/manifest.json`:

```json
{
  "items": [
    { "id": "ref-01", "name": "Homepage", "file": "ref-01.png", "width": 1440, "height": 900,
      "url": "https://example.com/", "kind": "page" }
  ]
}
```

Every entry is kept — the manifest is the judgement. `file` resolves relative to the manifest; `url`
alone is served by redirect.

An option may also carry its own `src`, which wins over any index — an absolute file path or an
http(s) URL.

## Config surface

| Block | Purpose |
|---|---|
| `intake`, `pairs`, `followups` | the interview |
| `facts`, `intakeClose`, `baseline` | looked-up facts, the closing screen, the committed direction to check against |
| `ui` | `title`, `mark`, `storageKey`, `note` — the app is generic, these make it yours |
| `system` | `tokensFile`, `tokensNamespace`, `tokenRefs` — all optional; a missing file is a warning, not a failure |
| `output` | `readbackTitle`, `systemNote`, `assetsNote`, `directionFile`, `agentBrief`, `doNot` |
| `semantics` | `vocabulary`, `implications`, `details`, `crossMedia`, `conflictNotes`, `assets`, `pendingTokens`, `openQuestions` |
| `sources`, `paths` | where images and files come from/go |

With no `semantics`, the emitter falls back to each chosen option's `vocab` as its build rule, and
generic defaults elsewhere. With `semantics`, the authored prose wins.

`probe.schema.json` describes the whole shape.

## Rules the probe enforces

- **Blind:** source names and links stay hidden until the run is saved.
- **One axis per pair:** the hint names the axis; everything else is noise for that decision.
- **Sides are randomised** per run and recorded, so a left-side habit is visible in the data.
- **Neither is allowed**, with an optional reason. A rejection is evidence.
- **Tensions are resolved, not averaged.** The conflict screen blocks the path until one wins.
- **Stopping is legitimate.** "I've seen enough" ends the run; unprobed axes are reported, never filled.

## Verified

- Sulcalibur parity: the ported engine reproduces `05-probe.md` and `design-spec.json` byte-identically
  except the generator attribution line and `generatedAt`.
- Fresh project, no Eagle: `init` → folder manifest → `ingest` → `sheet` → `build` → `serve` → save →
  `emit` completes, with generic fallbacks and no token file.
- Render tier: `sloplint --render` with `puppeteer-core@24.43.1` + Playwright's Chrome for Testing 156
  wrote five frames and ran the gates.

`npm audit` shows high-severity advisories inside puppeteer-core's tree. They are on paths this tool does
not use (archive extraction, FTP) and `npm audit fix --force` breaks the pin. Leave them until puppeteer
ships a fix.
