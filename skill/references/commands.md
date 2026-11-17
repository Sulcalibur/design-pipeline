# Commands

All commands accept the same global flags.

| Flag | Default | Meaning |
|---|---|---|
| `--config <path>` | `./probe.config.json` | the project's config; its directory is the project root |
| `--out <dir>` | config directory (or `paths.out`) | `05-decision.md`, `build-spec.json`, direction block |
| `--data <dir>` | `<root>/data` | `answers.json`, `candidates.json`, `eagle-writeback.json` |
| `--build <dir>` | `<root>/build` | generated `probe.json`, `sheet.html` |
| `--port <n>` | `4210` | `serve` only |
| `--dry` | off | `emit`: print the first screen, write nothing |
| `--no-touch` | off | `emit`: do not annotate `02-direction.md` |
| `--run <id>` | latest | `emit`, `record`: choose a saved run |
| `--apply` | off | `record`: actually write tags into Eagle |

## init

```bash
node probe/probe.mjs init --project <root> --slug <slug>
node probe/probe.mjs init path/to/docs/design/<slug>
```

Creates `data/`, `build/`, `.gitignore`, the five document templates and `probe.config.json`.
Refuses to overwrite `probe.config.json` without `--force`. Reports what it found in the project
(`design.md`, tokens, framework, sibling slugs, `.hallmark/`) and leaves existing documents alone.

## ingest

```bash
node probe/probe.mjs ingest --config …                 # Eagle
node probe/probe.mjs ingest --config … --source folder # manifest.json
```

Writes `<data>/candidates.json` and `<data>/library.json`. Eagle mode reads the library Eagle has open
through Web API v2 (no file permission needed), classifies specimens, assets, mood pins and unreadable
captures out, then falls back to the index cache only if the API is unavailable. Folder mode keeps every
manifest entry.

Set `EAGLE_MEDIA_URL="http://127.0.0.1:41532/api/items/{id}/file"` (Media Preview Server plugin) to
serve and measure captures with no file access at all. Exits non-zero with a list of problems and writes
nothing if a manifest entry is missing its file.

## sheet

```bash
node probe/probe.mjs sheet --config …
```

Writes `<build>/sheet.html` — numbered contact sheet. The slice rules live in `sheet.slice`
(`tags`, `folders`, `hosts`, `excludeHosts`, `title`, `meta`). A folder source shows everything.

## analyze

```bash
node probe/probe.mjs analyze --config … [--ids a,b] [--all] [--limit 200] [--refresh] [--brief]
```

Measures the referenced images and writes `<data>/analysis.json`. Defaults to the ids in `pairs`.
Reuses a machine-wide cache keyed by library + id + mtime; `--refresh` re-measures. The `authored` block
in each entry is preserved across refreshes. See `analysis.md`.

## live

```bash
node probe/probe.mjs live --config … [--ids a,b] [--all] [--limit 20]
```

Fetches each reference's live page once, extracts fonts, colours, custom properties, sections, motion and
a11y facts, and writes a 1440×900 screenshot to `data/live/<id>.png`. Merges into `analysis.json` as the
`live` layer. Skips gallery URLs. Needs `puppeteer-core` and a Chrome for Testing binary (the same ones
`bin/sloplint` uses). See `analysis.md`.

## links

```bash
node probe/probe.mjs links --config … [--ids a,b] [--all] [--limit 50] [--refresh]
node probe/probe.mjs links --config … --set '<id>=<site-url>'
node probe/probe.mjs links --clean '<url>' [--strip tracking|all|none]
```

Resolves a gallery capture to the site it depicts and records `galleryUrl`, `linkedAs`, `siteUrl`,
`finalUrl`, `title`, `status` and `method` in `analysis.json`. Blocked galleries are marked
`needsManual` and are never cached. `--clean` needs no config and prints just the canonical URL.

## preview

```bash
node probe/probe.mjs preview --config … [--name preview.html] [--open]
```

Writes a static pair page beside the run: two designs side by side with their palette, measured density,
live fonts and section list, and the authored note where one exists. Images are copied into
`preview/` next to the HTML. Click a side to record a choice; export copies the JSON.

Sources are shown, so this page is for review and discussion — not for producing unbiased answers.

## capture

```bash
node probe/probe.mjs capture --url https://example.com/ [--slug acme]
     [--viewport desktop|mobile|WxH] [--full | --scroll <n>] [--wait <ms>]
     [--name <base>] [--note "…"] [--device "…"] [--avoid "…"] [--fits "…"]
     [--evidence "…"] [--tags a,b] [--to auto|eagle|folder]
     [--eagle-folder <name>] [--out <dir>] [--config <cfg>] [--hide-overlays] [--json]
```

The step before `ingest`: screenshot a live page and record its provenance in
`<references>/manifest.json` (the schema `ingest --source folder` reads).

- Default is a 1440×900 viewport shot; `--viewport mobile` is 390×844 at 2×.
- `--full` takes the whole page; `--scroll n` takes n viewport frames down the page, which is the honest
  option for scroll-driven or horizontal sites where a full-page capture becomes a long empty strip.
- `--hide-overlays` removes common cookie/consent banners before the shot. It is opt-in because a
  banner is sometimes part of what you are studying.
- `--device` names the one transferable device; `--avoid` names what must not be copied; `--fits` says
  which page/job it serves; `--evidence` records what was actually checked. A capture without a device
  is a picture: the command warns, and `refs` will block it.
- Writes `<date>-<slug>-<viewport>.png` and appends a manifest item with `id`, `file`, `url`,
  `capturedAt`, `kind` and any of the four judgement fields.

**Eagle.** `--to auto` (default) uses Eagle when its local API answers on `:41595`, otherwise folder
only. `--to eagle` fails if Eagle is not running; `--to folder` never talks to it. When Eagle is
available the capture is also added with `/api/item/addFromPath` to a folder named after the slug
(created if missing), tagged `design-probe`, `ref`, the slug and any `--tags`, with the source URL in
`website` and device / avoid / fits / evidence, the note and the capture date in `annotation`. The
project manifest stays the portable record; Eagle is a copy, not the source of truth.

Requires `puppeteer-core` and a Chrome for Testing binary (the same ones `audit` and `sloplint` use).

## refs

```bash
node probe/probe.mjs refs --project . [--dir references] [--html refs.html]
     [--md [file]] [--lenient] [--json]
```

Reviews the reference pack as a pack. Reads `manifest.json`, shows every capture beside its device,
avoid, fits, evidence and note, and adds the measured palette from `data/analysis.json` when present.
Writes `references/refs.html` (and `refs.md` with `--md`).

The gate: every item needs a **device** and an **avoid**. A missing either is blocking; missing `fits`
or `evidence` is a warning. `--lenient` turns the gate into a warning for exploratory packs. Exit 1
until every picture has earned its place.

## context

```bash
node probe/probe.mjs context --project . [--target generic|open-design|penpot|agent]
     [--scope "one screen"] [--examples a,b] [--with-audit] [--dest handoff] [--json]
```

Compiles the project into a self-contained handoff folder for another design tool or agent. Requires a
brand record; without constraints a handoff is a mood board.

Writes into `<slug>/handoff` by default:

| File | What it is |
|---|---|
| `context.md` | the one-page brief: job, acceptance criteria, brand constraints, direction, references, mock rule, do-not list, precedence |
| `prompt.md` | the opening prompt for the chosen target |
| `README.md` · `handoff.json` | what each file is; sources with SHA-256, missing pieces |
| `brand.json` · `brand.md` | the constraints and the story |
| `brief.md` · `direction.md` · `structure.md` · `assets.md` | copies of the authored record |
| `build-spec.json` · `decision.md` | when they exist |
| `tokens.css` · `tokens.json` | the copied token source, plus the custom properties extracted to JSON |
| `references/` | the manifest, images and `refs.html` when a capture pack exists |
| `examples/` | copies of any `--examples` files, with a README that asks for annotation |
| `audit.md` | the latest audit, only with `--with-audit` |

Precedence is stated in `context.md`: brand **>** direction **>** brief **>** references **>** prompt.
Targets change only the prompt: `open-design` frames and exports; `penpot` frames and components bound
to tokens; `agent` code and states; `generic` a neutral brief. Missing sources are listed rather than
invented, and the command exits 0 so a partial handoff is still usable.

## compare

```bash
node probe/probe.mjs compare A.html B.html [C.html] [--out compare.html]
     [--title "…"] [--notes notes.json] [--open]
```

Puts two to four artifacts side by side — HTML prototypes, screenshots, or a mix — with no config and no
probe run. HTML is inlined through `srcdoc` with a `<base>` pointing at its own folder, so self-contained
prototypes render without a server and relative assets still resolve. Images are copied beside the board.

`--notes` takes a JSON object keyed by file name or index; the note appears under each panel. The board
names its sources, so it is a review board, not the blind pair interview. At most four panels.

The output is a single self-contained page; `compare-assets/` sits beside it only when images were used.

## brand

```bash
node probe/probe.mjs brand scaffold --project .
node probe/probe.mjs brand serve    --project . [--port 4211]
node probe/probe.mjs brand status   --project .
node probe/probe.mjs brand emit     --project . [--dry]
```

The brand interview app. Writes `docs/brand/brand.md` and `brand.json`; answers in
`docs/brand/data/answers.json`. See `brand.md`.

## fonts

```bash
node probe/probe.mjs fonts --project . [--limit 80] [--library <path>]
node probe/probe.mjs fonts validate --project .
```

Indexes the type specimens in the Eagle library (URL-less, small, weight-tagged) and copies previews to
`docs/brand/fonts/`, so the brand interview can show them beside the curated pairings. When the files are
unreadable it falls back to indexing font files by name through the API — names only, no previews. `validate` checks
each named family against the Google Fonts catalogue and writes `data/font-check.json`. Needs a locally
readable library; on iCloud it fails with the permission message rather than an empty list.

## audit

```bash
node probe/probe.mjs audit --url <url> [--slug <slug>] [--out <path>] [--categories perf,accessibility]
```

Runs Lighthouse in the cached Chrome for Testing and writes `audit.json` + `audit.md` (a small summary,
not the 500 KB report). The accessibility category is axe-core, so one run covers performance, axe,
best practices and SEO. Every failing audit is fixed or waived in `review.md`.

## build

```bash
node probe/probe.mjs build --config …
```

Validates the whole config, then writes `<build>/probe.json` (with `ui` defaults filled in). Validation
covers: intake ids and types, recommendation targets, pair option ids, exactly two options per pair,
`source`/`alt`/`vocab`/`note` on every option, image ids resolving to a candidate or `src`, confirm
pairs pointing at a base pair, follow-up `when` keys existing as constraints, duplicate ids, and facts
with `text` + `source`.

An empty `pairs` array is a warning, not an error: it is a valid starter state.

## serve

```bash
node probe/probe.mjs serve --config … [--port 4210] [--no-emit]
```

Serves the shared app, `/probe.json`, `/sheet.html`, images, and `/api/answers`. Binds loopback only.
Saving POSTs the run, appends to `answers.json` (one record per `runId`), then spawns `emit` with the
same paths. `--no-emit` saves without emitting.

Image resolution order: option `src` (absolute file, else http URL) → candidate `file` → Eagle item dir.
Remote URLs are served as a 302 redirect.

## emit

```bash
node probe/probe.mjs emit --config … [--run <id>] [--dry] [--no-touch]
```

Writes `05-decision.md` and `build-spec.json`. When a project has `docs/brand/brand.json`, emit carries a
**Brand constraints** section into both: promise, against, banned words, forbidden territory and the brand
dials. With no record the section is absent and the spec says so. If `02-direction.md` exists it replaces the marked
`<!-- probe:start -->…<!-- probe:end -->` block; if it does not exist it says so and writes nothing else.
The direction file path is `output.directionFile` (relative to the project root) or `<out>/02-direction.md`.

Token checks run only when `system.tokensFile` exists. Missing refs are fatal *then* — a stale token
name is a real fault once a token source has been declared. No token file means no check.

## record

```bash
node probe/probe.mjs record --config … [--run <id>] [--apply]
```

Plans three tags plus an annotation line per shown item. Dry run by default. `--apply` needs Eagle's
local API on `:41595`. Skips options that carry `src` (no Eagle item exists).

## status

```bash
node probe/probe.mjs status --config …
```

Config validation, candidate count, latest run and its decision count, last spec status and rule count.

## doctor

```bash
node probe/probe.mjs doctor [--json] [--strict]
```

Reports what this machine can run before a stage fails halfway: Node, a Chrome/Chromium binary,
`puppeteer-core`, Eagle and its media server, Lighthouse, Hallmark's sloplint, the Impeccable detector,
git and the brand registry. Nothing is installed. `--strict` exits 1 when a required item is missing;
the default exits 0 because most stages run without Eagle or Lighthouse.

## Common failures

| Symptom | Cause |
|---|---|
| `config not found` | `--config` path wrong; defaults to `./probe.config.json` |
| `no Eagle index file matches N items` | Eagle's cache is ahead/behind the library; open Eagle once |
| `library images not found` | `sources.kind` is `eagle` but the library is absent; switch to `folder` |
| `pair … needs exactly two options` | a pair gained or lost an option |
| `no Eagle candidate and no src` | option id is not in `candidates.json` and carries no `src` |
| `no answers at …` | nothing saved yet, or `--data` points elsewhere |
| `runtime config missing` | run `build` before `emit`/`record` |

## ask

```bash
node probe/probe.mjs ask --stage brand [--project .]
node probe/probe.mjs ask --stage brief [--project .]
node probe/probe.mjs ask --stage direction [--project .]
     [--next] [--answer id=value] [--tbc id] [--check] [--list] [--write]
     [--status verified|assumption|tbc] [--source "…"] [--state <file>] [--reset] [--json]
```

A one-question-at-a-time interview with a constant spine, conditional branches and a gate. Packs live in
`probe/packs/<stage>.json`; the brand pack includes `brand.config.json` and adds four context questions
(`kind`, `sector`, `identity`, `cms`) plus conditions such as `owner` and `c2` only for companies/public
bodies. The brief pack prefills from `00-brief.md`; `mockPolicy` appears only when content is missing, and
`stakeholders` only when the brand is a company or public body (`"brand.kind"` conditions).

- `--next` prints the next visible unanswered question with its `why`, options and a recommendation
  derived from the brand record and project (`kind`, `sector`, `identity`, `cms`).
- `--answer id=value` records it, defaulting to `assumption`; pass `--status verified` and `--source` for
  a fact. List answers take comma-separated values.
- `--tbc id` records that not knowing is the honest answer.
- `--check` blocks while a required question is unanswered, or a `gate: "blocking"` question is TBC.
  Required assumptions and optional TBCs are listed as warnings, not blockers. `--write` also writes
  `interview.md` beside the design documents.
- `--list` shows the whole tree, including which questions a branch hid.

State is `<docDir>/interview.json`. It is a working record, **not** the brand record: `probe brand emit`
still writes `brand.json` from `answers.json`. The interview seeds itself from `brand.json`, so an
existing record appears prefilled rather than being asked again.

## brand review

```bash
node probe/probe.mjs brand review --project . [--json] [--no-write]
     [--max-tbc 1] [--max-assumption N] [--max-age <days>] [--id <registry-id>]
     [--tokens <path>] [--no-registry]
```

Reads `docs/brand/brand.json` and checks the record can be trusted: every required slot present, every
slot carrying a status and a source, the TBC and assumption budgets, contrast for ink/paper,
ink/surface, accent/paper and paper/accent, the rules a copy gate needs, type roles, dials, staleness
against the token file, and the brand registry when one exists (delegates to `bin/brandlint`).

Writes `docs/brand/review.md`. Exit 1 on a blocking finding.

## copy

```bash
node probe/probe.mjs copy --project . [--src <file-or-dir>] [--url <url>[,<url>]]
     [--max-words N] [--stage layout|build|launch] [--json] [--no-write]
```

Reads copy from the files a project keeps it in (`.md .txt .html .vue .svelte .json .ts .tsx .js`) or
from rendered URLs, then checks the brand record's own rules: banned words, forbidden territory,
first-person voice, UK spelling, exclamation budget, placeholders, emoji and sentence length. Conceptual
bans (longer than four words) are listed as notes, not grepped.

`--stage layout` allows mock copy and lorem as info, so a layout can be reviewed before the real copy
exists. `--stage build` (default) and `launch` treat them as findings. Fabricated numbers, quotes,
testimonials and logos are never allowed at any stage.

Writes `copy.md` beside the design documents. Exit 1 on a blocking finding.

## content

```bash
node probe/probe.mjs content --project . [--url <url>[,<url>]] [--sitemap <url>]
     [--model <content-model.json>] [--src <dir>] [--limit 20]
     [--stage layout|build|launch] [--json] [--no-write]
```

Validates a content model (`collections`, `singleton`, `fields`, `slugField`, `seo`, `blocks`) and
checks rendered pages: one `h1`, heading order, title and description, lang, viewport, canonical,
noindex, alt text, empty links, placeholders and thin content. `--sitemap` reads every `<loc>` up to
`--limit`.

`--stage layout` allows placeholders and explicit `data-mock` markers as info; `build` (default) and
`launch` require them removed. Missing alt text and heading structure are checked at every stage.

Writes `content.md`. Exit 1 on a blocking finding.

## launch

```bash
node probe/probe.mjs launch --project . --url https://example.com/ [--www <url>]
     [--previous <commit-or-deploy>] [--json] [--no-write]
```

The invisible pre-flight: HTTPS and the http→https redirect, TLS chain and expiry, HSTS, CSP,
nosniff, Referrer-Policy, Permissions-Policy, frame options, robots (including a `Disallow: /`),
sitemap presence and shape, a real 404, noindex, canonical, lang, viewport, favicon, Open Graph and
Twitter card. Records the previous deploy as the rollback target.

Writes `launch.md`. Exit 1 on a blocking finding. A missing `--previous` is a minor finding, not a
blocker, but the rollback row is then empty.

## review

```bash
node probe/probe.mjs review --project . --url https://example.com/
     [--previous <ref>] [--responsive 0-4] [--no-render] [--no-detector] [--json]
```

The composite audit. Runs brand review, copy, content and launch, then Lighthouse (axe included),
Hallmark's `sloplint --render` and the Impeccable detector. Stable findings merge into one severity
list; the five dimensions are scored 0–4 and totalled out of 20.

Writes `docs/design/<slug>/10-audit-<date>.md` and an `audit-<date>/` evidence folder (Lighthouse
summary, `sloplint.txt`, `detector.json`). `--responsive` records a hand-measured responsive score;
without it the dimension is a documented placeholder. Exit 1 on a blocking finding.

Hallmark's Floor binds Hallmark builds. On a surface Hallmark did not build, sloplint findings are
advisory and each one is dispositioned in the audit.

## maintain

```bash
node probe/probe.mjs maintain --project . --url https://example.com/
     [--previous <ref>] [--responsive 0-4] [--no-render] [--json]
```

Runs `review`, diffs the findings against `maintain.json`, and reports only what changed: new
findings, resolved findings and score deltas. The first run records a baseline.

Writes `check-<date>.md` and `maintain.json`. Exit 1 when anything blocks or a new blocking finding
appears against the baseline.
