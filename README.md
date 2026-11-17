# Design pipeline

A portable process for brand interviews, design direction, build gates and audits. One engine, one
runbook, one folder of project content.

**New here:** [`docs/quickstart.md`](docs/quickstart.md) — install, `probe doctor`, and the first run end
to end. The stage map is in [`skill/references/stages.md`](skill/references/stages.md).

The engine is an **adaptive reference probe** and a set of **gated stages**: brand, brief, direction,
copy, content, build routing, audit, launch and maintenance. It emits a portable spec — a direction
someone can build from, with the tensions you resolved recorded as evidence.

No model calls at runtime. Node 22.12+; `puppeteer-core` is optional for capture and the render tier; Eagle
is optional. Nothing here needs a particular agent.

## Install

```bash
git clone https://github.com/Sulcalibur/design-pipeline.git
cd design-pipeline
./install.sh
export DESIGN_PIPELINE_HOME="$PWD"
bin/probe doctor
```

`install.sh` symlinks `skill/` into `~/.agents/skills/design-pipeline` and prints the export line. It
does not edit your shell profile.

## What lives where

```
<repo>/
  probe/                 the engine (probe.mjs is the entry point)
  probe/packs/           question packs for `probe ask`
  skill/                 the runbook every agent loads + the stage map
  evals/                 mechanical context checks for a generated artifact
  examples/minimal/      a neutral project that compiles a handoff
  templates/             the design documents + a starter config
  bin/                   probe and sloplint wrappers
  docs/                  quickstart
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
  05-decision.md (legacy: 05-decision.md)            generated readback
  build-spec.json       generated machine spec
  copy.md               voice gate (copy)
  content.md            completeness gate (content)
  launch.md             pre-flight + rollback target (launch)
  10-audit-<date>.md    scored audit (review)
  audit-<date>/         its evidence: Lighthouse, sloplint, detector
  check-<date>.md       recurring check (maintain)
  maintain.json         the baseline the next check diffs against
  handoff/              compiled context + prompt for a design tool or agent
  data/                  answers.json, candidates.json (gitignored)
  build/                 probe.json, sheet.html (generated, gitignored)
  references/manifest.json   only when sources.kind is "folder"
```

## Start, at any stage

```bash
node probe/probe.mjs start --project .            # where this project is, and the next step
node probe/probe.mjs start --all                  # the full path from setup to maintain
node probe/probe.mjs start --stage 3              # start at Direct
node probe/probe.mjs start --existing             # an already-built surface: audit first
node probe/probe.mjs init --project ~/Developer/projects/SomeProject --slug home-refresh
```

`start` is a read-only read-out: it detects which artifacts exist, marks a document that still matches
its template as a stub, and recommends the stage the project is actually in. It does not run a stage —
the gates need judgement, and stage 6 is a build on the surface the project already uses.

`init` inspects the project and reports what it found — `design.md`, `tokens.json`, framework, other
design slugs, `.hallmark/` — then creates only what is missing. Existing briefs and directions are
left untouched. Starting mid-pipeline is expected: a project may already have a brief, or a built
page, or nothing.

## The stages

| # | Stage | Ends in | Run |
|---|---|---|---|
| 0 | Setup | `probe.config.json` | `probe init` |
| 0b | Brand | `docs/brand/brand.md` + `brand.json` | `probe brand scaffold` · `probe ask --stage brand` |
| 0c | Brand review | `docs/brand/review.md` | `probe brand review` |
| 1 | Intake | `00-brief.md` | `probe ask --stage brief` |
| 2 | Collect | `01-references.md` | `probe inspire` → `capture` → `refs` → `ingest` → `analyze` → `sheet` |
| 3 | Direct | `05-decision.md` + `build-spec.json` | `probe ask --stage direction` → `emit` → `compare` |
| 4 | Structure | `03-structure.md` | authored |
| 5 | Assets | `04-assets.md` | authored |
| 5b | Copy | `copy.md` | `probe copy` |
| 5c | Content | `content.md` | `probe content` |
| 5d | Handoff | `handoff/` | `probe context` |
| 6 | Build | the build | routed to the project's surface |
| 7 | Verify | `review.md` | `probe audit` + `bin/sloplint` |
| 7b | Audit an existing surface | `10-audit-<date>.md` + evidence | `probe review` |
| 8 | Launch | `launch.md` | `probe launch` |
| 9 | Maintain | `check-<date>.md` + `maintain.json` | `probe maintain` |

Every stage ends in a document and a gate; no stage starts before the previous one has one. Run
`probe start` between stages to see where the project actually is. The gates and surface adapters are
in [`skill/references/stages.md`](skill/references/stages.md).

## Wrappers

```bash
bin/probe    start|status|init|inspire|ingest|sheet|build|serve|emit|record   # from any project
bin/sloplint <files|--url …> [--render]                                       # Hallmark's sweep
```

`bin/sloplint` sets `HALLMARK_PUPPETEER` to this repo and `CHROME_PATH` to an isolated automation
browser, so `--render` works from a project directory with no environment variables. Add `bin/` to
`PATH` to call them as `probe` and `sloplint`.

## The loop

`probe start` says which stage of this loop comes next. The probe itself is these commands:

```bash
node probe/probe.mjs ingest  --config <project>/docs/design/<slug>/probe.config.json
node probe/probe.mjs analyze --config …   # measure palette, density, bands, columns
node probe/probe.mjs sheet   --config …
node probe/probe.mjs build  --config …
node probe/probe.mjs serve  --config …
# answer in the browser; saving runs emit
node probe/probe.mjs emit   --config …   # carries the brand record's constraints when one exists
node probe/probe.mjs record --config … [--apply]
```

`build` validates before writing: every image id resolves, every pair has two options, every `when`
key exists as a constraint, every confirm pair points at a real base pair. A broken config is refused,
not half-written.

`record` writes verdicts back into Eagle (`probe:<id>`, `axis:<axis>`, `verdict:picked|rejected|neither`).
Dry run unless `--apply`; needs Eagle running on `:41595`.

## After the build

The gates that do not need a model, in the order a project meets them:

```bash
bin/probe brand     review --project .                     # the brand record can be trusted
bin/probe copy      --project . --url https://acme.test/   # the voice gate
bin/probe content   --project . --url https://acme.test/   # headings, alt, titles, noindex
bin/probe review    --project . --url https://acme.test/    # scored audit + evidence
bin/probe launch    --project . --url https://acme.test/ --previous <ref>
bin/probe maintain  --project . --url https://acme.test/    # diff against the last run
bin/probe context   --project . --target open-design --scope "Work index, first screen"
```

`review` composes brand review, copy, content, launch, Lighthouse, Hallmark's `sloplint --render` and
the Impeccable detector into one 0–20 audit with a disposition for every finding. `launch` checks the
invisible failures: TLS, redirects, security headers, robots, sitemap, a real 404, noindex. `maintain`
records a baseline and reports only what changed.

The complete stage map, entry points and surface adapters live in
`skill/references/stages.md`.

## Reference profiles

`analyze` writes a two-layer profile per image:

- **measured** — palette with shares, background, whitespace, luminance, contrast, colour temperature,
  edge density, section bands, a column hint, alignment, aspect. Deterministic, cached machine-wide in
  `~/Library/Caches/design-pipeline/`, keyed by library + id + mtime.
- **authored** — `style`, `typeVoice`, `layout`, `devices[]`, `avoid[]`, `rating`, `notes`. Written by the
  agent or a person, and preserved when a refresh re-measures.

The project keeps both in `data/analysis.json`, which is tracked: the measured half is regenerable, the
authored half is knowledge. The contact sheet shows palette chips and density per card, and `emit`
carries each chosen source's profile into `build-spec.json`.

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
node probe/probe.mjs brand serve    --project .   # probe emits read the record automatically
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

**Discovery.** `bin/probe inspire` pulls candidates from an MCP source and runs each one through
`capture`, so a pulled reference lands in the same manifest as a manual one. Sources are opt-in in
`inspiration.sources`: `awwwards` (Site of the Day, tags, technology, colour), `pinterest` (search and
boards) and `feed` (any JSON list of URLs). `inspiration.eagle` is `auto` (write back when Eagle is
running), `on` (fail if it is not) or `off`. Pulled captures are marked `unsorted`, and `refs` blocks
them until someone names the device and what not to copy.

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
| `inspiration` | discovery source toggles, pick count, seed and Eagle write-back mode |

With no `semantics`, the emitter falls back to each chosen option's `vocab` as its build rule, and
generic defaults elsewhere. With `semantics`, the authored prose wins.

`probe.schema.json` describes the whole shape.

## Evals

`evals/` answers the part of “the AI understood the context” that can be checked mechanically: one
`h1`, lang, title, banned words, token-only colours, case expectations, and mock copy that should not
have shipped.

```bash
npm run evals -- --file path/to/artifact.html --case work-index \
  --brand path/to/handoff/brand.json --tokens path/to/handoff/tokens.json
```

It is not a design critique. `review` and a person still do that.

## Example

`examples/minimal` is a neutral project — brand, brief, direction and tokens only — that compiles a
handoff with no Eagle, no probe run and no network:

```bash
cd examples/minimal
node ../../probe/context.mjs --project . --target generic --scope "Work index — first screen"
```

## Rules the probe enforces

- **Blind:** source names and links stay hidden until the run is saved.
- **One axis per pair:** the hint names the axis; everything else is noise for that decision.
- **Sides are randomised** per run and recorded, so a left-side habit is visible in the data.
- **Neither is allowed**, with an optional reason. A rejection is evidence.
- **Tensions are resolved, not averaged.** The conflict screen blocks the path until one wins.
- **Stopping is legitimate.** "I've seen enough" ends the run; unprobed axes are reported, never filled.

## Verified

- `npm test`: 36 tests across the shared checks, the refs gate, the context compiler, the mock-copy
  stages, the brand/brief/direction ask packs, the inspiration adapters and the stage detector.
- `probe start`: an empty project recommends 0 setup; a scaffolded project advances through brand,
  brand review and intake; captures without an authored references document mark collect `partial`;
  `--existing` starts at 7b audit; a named stage prints its gate and commands.
- `probe inspire --check`: hand-shakes with the Awwwards (39 tools) and Pinterest (6 tools) MCP servers.
  Live dry-runs from both sources returned usable candidates; one capture was filed into a folder
  manifest and correctly blocked by `refs` as `unsorted`.
- `examples/minimal`: a handoff compiles from brand, brief, direction and tokens with no Eagle, no probe
  run and no network.
- Fresh project, no Eagle: `init` → folder manifest → `ingest` → `sheet` → `build` → `serve` → save →
  `emit` completes, with generic fallbacks and no token file.
- Render tier: `sloplint --render` with `puppeteer-core@25.18.1` + Playwright's Chrome for Testing 156
  wrote five frames and ran the gates.

`npm audit`: 0 vulnerabilities. The Node-side tree moved to `puppeteer-core@25.18.1`, which requires
Node ≥ 22.12; the project floor is the same.
