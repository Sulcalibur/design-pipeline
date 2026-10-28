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
node probe/probe.mjs ingest --config <project>/docs/design/<slug>/probe.config.json
node probe/probe.mjs sheet  --config …
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

**Eagle** (default). Indexes the library read-only, classifies specimens/assets/mood pins out, and
serves images from Eagle's item directories. The index is matched by item count, then read in one
pass. Eagle's API has no working search — page `/api/item/list` and filter client-side.

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
