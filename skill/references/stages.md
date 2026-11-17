# Stages and gates

The full process, from a blank folder or an existing surface to a maintained one. Every stage ends in
a document; no stage starts before the previous one has one. The stage map is universal; the checks are
surface adapters (see the end).

## Pick the entry point

| What exists | Start at | Do not |
|---|---|---|
| Nothing | 0 setup, then 0b brand | Invent a brand or a direction |
| A brand, no design | 1 intake | Re-ask the brand interview |
| A built surface, no design record | 7b audit | Redesign to have something to assess |
| A built surface + a design record | 7b audit, then 9 maintain | Reopen signed decisions |
| A direction, no structure | 4 structure | Re-run the probe |
| A brief, no references | 2 collect | Ask the brief questions again |

`probe init` reports what already exists and never overwrites a document. `probe start` applies this
table from the artifacts: it shows the whole map, recommends an entry stage and prints the next
command. Neither one runs a stage.

## The map

| # | Stage | Command | Ends in | Gate (testable) |
|---|---|---|---|---|
| 0 | Setup | `probe init` | `probe.config.json`, `data/`, `build/`, the five templates | The config resolves a real reference source |
| 0b | Brand | `probe brand scaffold` → `serve` → `emit` · `probe ask` | `docs/brand/brand.md` + `brand.json` | 39 slots, each with a status and a source; no slot silently blank; required interview questions answered, blocking TBC cleared |
| 0c | Brand review | `probe brand review` | `docs/brand/review.md` | 0 blocking; TBC within budget; contrast pairs pass; banned words and forbidden territory non-empty |
| 1 | Intake | `probe ask --stage brief` · authored | `00-brief.md` | A stranger could build from it; success criteria are checkable |
| 2 | Collect | `probe inspire` (optional) → `probe capture` → `refs` → `ingest` → `sheet` → `analyze` → `live` | `01-references.md` | Every reference names a transferable device and a thing not to copy; at least one distance reference |
| 3 | Direct | `probe ask --stage direction` · `probe emit` · `probe compare` | `05-decision.md`, `build-spec.json`, direction block | One direction, three decisions, one refusal, a named cost; `status` is not `needs-decision`; a side-by-side board exists when the options were visual |
| 4 | Structure | authored | `03-structure.md` | Every section has a job; every control has states; a content model exists |
| 5 | Assets | authored | `04-assets.md` | Every slot has a ratio, a prompt and alt text before layout |
| 5b | Copy | `probe copy` | `copy.md` | 0 blocking: no banned words, no placeholders, first person honoured |
| 5c | Content | `probe content` | `content.md` | 0 blocking: one h1, titles and descriptions, alt text, no noindex; model valid if present |
| 5d | Handoff | `probe context` | `handoff/` | `context.md` + `prompt.md` exist; precedence stated; every missing source listed, none invented |
| 6 | Build | routed surface | build log | Build runs; every colour and font comes from a token; one direction engine |
| 7 | Verify | `probe audit` + `bin/sloplint` | `review.md` | axe 0 serious; 375/390/768/1440; keyboard; states; reduced motion; cold read |
| 7b | Audit an existing surface | `probe review` | `10-audit-<date>.md` + evidence | Scored 0–20; every finding is fixed, waived or dismissed with a reason |
| 8 | Launch | `probe launch` | `launch.md` | 0 blocking: HTTPS, redirects, headers, robots, sitemap, real 404, no noindex; previous deploy recorded |
| 9 | Maintain | `probe maintain` | `check-<date>.md`, `maintain.json` | No new blocking finding against the last run; score deltas explained |

## What each gate means

**A gate is not a score.** It is a yes/no with evidence attached. A failure is either fixed or waived
*on the record* — never averaged, never quietly accepted.

**Blocking vs advisory.** Blocking stops the next stage. Advisory is recorded and dispositioned. The
brand review, copy and content stages each define their own blocking set; the audit adds a
`fix / waive / dismiss` disposition for every finding, which is what keeps a deliberate device from
being mistaken for a defect.

**Two directions of travel.**

- *New build:* 0 → 9 in order.
- *Existing surface:* 7b first, then decide whether the work is polish, restyle or redesign. A polish
  goes straight to 5b/5c/7; a restyle reopens 3; a redesign reopens 2–3. Never rebuild to have
  something to audit.

## Commands at a glance

```bash
PIPE="${DESIGN_PIPELINE_HOME:-$HOME/Developer/tools/design-pipeline}"

"$PIPE/bin/probe" init      --project . --slug home
"$PIPE/bin/probe" start     --project . --slug home
"$PIPE/bin/probe" brand     scaffold --project .
"$PIPE/bin/probe" brand     review   --project .
"$PIPE/bin/probe" copy      --project . --url https://example.com/
"$PIPE/bin/probe" content   --project . --url https://example.com/ --model content-model.json
"$PIPE/bin/probe" launch    --project . --url https://example.com/ --previous <ref>
"$PIPE/bin/probe" review    --project . --url https://example.com/
"$PIPE/bin/probe" maintain  --project . --url https://example.com/
```

Every command that learns something writes a document into the project, not into this tool:

```
<project>/docs/brand/brand.md, brand.json, review.md
<project>/docs/design/<slug>/00-brief.md … 05-decision.md, build-spec.json
<project>/docs/design/<slug>/copy.md, content.md, launch.md
<project>/docs/design/<slug>/10-audit-<date>.md + audit-<date>/
<project>/docs/design/<slug>/check-<date>.md + maintain.json
```

If a project has exactly one `docs/design/<slug>/` folder, the commands find it. Otherwise pass
`--config` or `--slug`.

## Failure modes each stage exists to catch

| Stage | The failure it prevents |
|---|---|
| Setting up | Documents scattered outside the project; two sources of truth |
| Brand | Adjectives instead of decisions; a record nobody can check |
| Brand review | A record and a build that both look consistent but disagree; a brand colour that never ships |
| Intake | A page that is beautiful and answers the wrong job |
| Collect | Convergence on the same competitor layout; copying a surface instead of a device |
| Direct | Taste by vibe; two direction engines producing two contracts |
| Structure | Sections that exist because the template had them; controls with no states |
| Assets | Layout broken by images that arrive later; invented photography |
| Copy | A voice that sounds like every other model; banned words and placeholders shipping |
| Content | Pages that cannot be indexed or navigated: missing h1, alt, descriptions, noindex |
| Build | A system replaced silently by a surface's defaults |
| Verify | A visual claim with no evidence; a score quoted as a pass |
| Audit | Drift and semantic defects invisible to a screenshot; deliberate devices flagged as defects |
| Launch | The invisible failures: TLS, redirects, headers, robots, sitemap, a 200 that should be 404 |
| Maintain | Silent regression; the page getting worse while nobody looks |

## Surfaces — what "any project" means

The stages and gates are the same for every surface. The checks are adapters:

| Surface | Stages 0–6 | Audit (7/7b) | Launch (8) | Maintain (9) |
|---|---|---|---|---|
| **Web page / site** | full | Lighthouse + axe, sloplint, detector, copy/content | full | full |
| **Web app / dashboard** | full | `sloplint --scope app`, axe, state matrix; copy/content lighter | full | full |
| **Native macOS / iOS / Android** | full | platform tooling (BAMA snapshots, XCUITest, Compose previews); no URL | App Store pre-flight (not tooled) | snapshot diff + crash/perf |
| **Document / deck** | brand, copy, content | visual review at print size; no runtime | distribution checklist | content freshness |
| **API / CLI** | brand, copy of docs | contract tests + docs accuracy | versioning and deprecation | contract regression |

The engine runs every stage that does not need a browser from any folder. Browser stages require a URL;
native and document adapters are documented here rather than faked, and each names the real tool in
`references/surfaces.md`.

## Non-negotiables for every run

1. **One direction engine per run.** Probe or Hallmark, not both.
2. **Ask once.** If the artifacts answer a question, use them and stamp the inference.
3. **One system of record.** `02-direction.md` is the contract; generated docs are linked, not copied.
4. **Generated blocks are never hand-edited.**
5. **Tensions are resolved, not averaged.**
6. **Unprobed is not empty.** Report it; never invent a constraint.
7. **No claim without evidence.** Name the check, the URL and the viewport — or mark it unverified.
8. **Audit before editing an existing surface.** The audit is the baseline, not an optional extra.
9. **Every finding is dispositioned.** Fix, waive or dismiss with a reason; silence is not a decision.
