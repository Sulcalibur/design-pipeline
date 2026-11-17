---
name: design-pipeline
description: "Run a design engagement in any project at any stage: setup, brand interview and review, intake, reference probe, direction, structure, assets, copy, content, build routing, verification, audit, launch and maintenance. Use when starting a design, auditing an existing page, extracting a brand style from references, checking copy or a content model, or deciding which design surface (project system, Hallmark, Open Design, Penpot) should do the work. Triggers: 'design this', 'design assessment', 'audit this site', 'reference probe', 'what should it feel like', 'start a design', 'launch check', 'design pipeline', 'which design skill'."
whenToUse: "Before drawing anything, whenever a built surface needs a scored audit, and whenever a design task needs a recorded direction or gate result rather than an improvised one."
---

# Design pipeline

The pipeline is a set of files with gates, not a mood. Every stage ends in a document; no stage starts
before the previous one has one. This skill owns the runbook. The engine and the runbook live in one
repository; a project holds only its content.

## Tool location

```bash
PIPE="${DESIGN_PIPELINE_HOME:?set DESIGN_PIPELINE_HOME to the design-pipeline repo}"
"$PIPE/bin/probe" help          # same engine, works from any project
"$PIPE/bin/sloplint" --help     # Hallmark's sweep with the render tier configured
```

The installer (`./install.sh`) prints the export line for your shell. If the path is missing, say so and
stop. Do not reimplement the probe inline.

## Entry points — start where the project actually is

| What exists | Start at | Do not |
|---|---|---|
| A built page, no design docs | Intake, with the live page as the reference point | Rebuild the page to have something to assess |
| A brief, no references | Reference probe | Ask the brief questions again |
| References, no direction | Probe → `emit` → direction | Write a direction from memory |
| A direction, no structure | Structure | Re-run the probe |
| A built page + a direction | Verify (`review.md`) | Reopen decisions that were signed |
| Nothing | `init` + intake | Invent a brand |

`init` detects `design.md`, tokens, framework, sibling design slugs and `.hallmark/`, then creates only
what is missing. Existing documents are never overwritten. `probe start` applies the entry-point table
from the artifacts: it prints the 0→9 map, recommends a stage and gives the next command, without
running or writing anything.

## Stage map

```
0 setup     init → docs/design/<slug>/ + probe.config.json skeleton
0b brand    brand interview → docs/brand/brand.md (project-scoped, one per brand)
            probe ask --stage brand   branch gate: required questions answered, blocking TBC cleared
0c brand review  probe brand review → docs/brand/review.md   gate: 0 blocking, TBC within budget
1 intake    probe ask --stage brief → 00-brief.md
            gate: testable success criteria; required brief questions answered
2 collect   probe: capture → refs → ingest → analyze → sheet → curate pairs → build → serve
            01-references.md        gate: each reference names a device and a non-transferable surface
3 direct    probe ask --stage direction → the contract questions
            probe: emit → 05-decision.md + build-spec.json
            probe compare → a side-by-side board when the choice is visual
            02-direction.md         gate: one direction, three decisions, one refusal, a named cost
4 structure 03-structure.md         gate: every section has a job; every control has states
5 assets    04-assets.md            gate: every slot has ratio, prompt, alt
5b copy     probe copy → copy.md    gate: 0 blocking (banned words, placeholders, voice)
5c content  probe content → content.md  gate: 0 blocking (h1, alt, titles, noindex, model)
5d handoff  probe context → handoff/  gate: context.md + prompt.md; missing sources listed, none invented
6 build     per the routing table
7 verify    probe audit (Lighthouse incl. axe) + sloplint (mechanical) + review.md (judged)
7b audit    probe review → 10-audit-<date>.md   gate: scored, every finding dispositioned
8 launch    probe launch → launch.md            gate: 0 blocking (TLS, headers, robots, 404, rollback)
9 maintain  probe maintain → check-<date>.md     gate: no new blocking against the last run
```

The full gate table, entry points and surface adapters are in [`references/stages.md`](references/stages.md).
Read it before choosing where to start; a project already built starts at 7b, not 0.

## Non-negotiables

1. **One direction engine per run.** The probe extracts a contract from real references. Hallmark's
   theme deal is a different mechanism and is skipped when a probe ran or a `design.md` exists. Two
   engines produce two contracts.
2. **Ask once.** If the brief and the probe already answered Hallmark's four fields (material,
   audience, use, tone), answer them from the artifacts, stamp the inference, and do not interrogate
   the user again.
3. **One system of record.** `02-direction.md` is the contract. A generated `design.md` is produced
   only on an explicit "lock the system" and is linked from `02-direction.md`.
4. **The generated block is never hand-edited.** Re-run `emit`.
5. **Tensions are resolved, not averaged.** The probe blocks until one side wins; record the winner.
6. **Unprobed is not empty.** An axis with no answer is reported as unprobed. Never invent a constraint
   to fill it.
7. **No claim without evidence.** A visual, responsive or accessibility claim names the check, the URL
   and the viewport — or it is marked unverified.
8. **Audit before editing an existing surface.** Run stage 7b first; the audit is the baseline, and a
   polish, restyle or redesign is chosen from its findings.
9. **Every finding is dispositioned.** Fix, waive or dismiss with a reason. Silence is not a decision.

## The loop

```bash
C="--config <project>/docs/design/<slug>/probe.config.json"
node "$PIPE/probe/probe.mjs" ingest $C
node "$PIPE/probe/probe.mjs" sheet  $C
# curate pairs in probe.config.json — this is the only judgement step
node "$PIPE/probe/probe.mjs" build  $C
node "$PIPE/probe/probe.mjs" serve  $C
```

After the build, the gates that do not depend on a model run from the project:

```bash
"$PIPE/bin/probe" brand    review --project .
"$PIPE/bin/probe" copy     --project . --url https://example.com/
"$PIPE/bin/probe" content  --project . --url https://example.com/
"$PIPE/bin/probe" review   --project . --url https://example.com/
"$PIPE/bin/probe" launch   --project . --url https://example.com/ --previous <ref>
"$PIPE/bin/probe" maintain --project . --url https://example.com/
```

Saving a complete run emits automatically. To re-emit or choose a run:

```bash
node "$PIPE/probe/probe.mjs" emit $C [--run <id>] [--dry] [--no-touch]
node "$PIPE/probe/probe.mjs" record $C [--apply]
```

## Curating pairs — the part that decides quality

- **One axis per pair.** If a viewer could answer the pair by noticing two different things, the pair
  is noise. Split it.
- **Both options must be defensible.** A pair where one side is obviously bad teaches nothing.
- **Every option carries** `source`, `url`, `alt`, `vocab`, `note`, `constraints`, `avoid`.
  `vocab` is the line the spec will quote; `avoid` is what the rejected side teaches.
- **Intake options carry `boosts`** naming axes, so the answers pick the order.
- **`when` conditions** keep a pair or follow-up out of runs where it does not apply.
- **Facts are looked up, not asked.** A fact carries `text` and `source`.
- **Six to twelve pairs is a run.** Beyond that the user stops reading carefully.

## Routing at build time

| Situation | Direction | Build | Verify |
|---|---|---|---|
| Existing page, project has `design.md`/tokens | project system | design-engineer in the system; Hallmark only if the user names it | project checks + `review.md` |
| New page, project has a system | probe contract | Hallmark **custom** run (inherits `design.md`, no theme deal) | `sloplint` blocking on the new surface |
| Greenfield | probe if references exist, else Hallmark deal | Hallmark | `sloplint` blocking |
| Throwaway exploration | none | Open Design | none |
| Motion-led cinematic surface | probe still fixes the direction | optional third-party builder, never by default | its own loop + `review.md` |

Third-party build skills are routed to, never vendored here. Read `references/surfaces.md` before
choosing one.

## Output contract

`05-decision.md` — what you told me, what you chose, consistency, details, tensions, intensity, build
rules, across formats, assets, rules out, conflicts, unprobed axes, sources, agent brief.

`build-spec.json` — the same as `reference`, `applications`, `extrapolation`, `intake`, `constraints`,
`intensity`, `buildRules`, `assets`, `confirmations`, `tensions`, `conflicts`, `unanswered`,
`pendingTokens`, `openQuestions`, `tokenRefs`. `status` is `confirmed | partial | needs-decision`.

`02-direction.md` — a generated block: run id, date, status, decision count, link to the readback.

Handoff order: `build-spec.json` → `02-direction.md` → `03-structure.md` → `04-assets.md`.

## References

- `references/stages.md` — the full stage map, gates, entry points and surface adapters.
- `references/questions.md` — the `probe ask` packs: conditions, statuses, recommendations and gates.
- `references/commands.md` — every command, flag and failure mode.
- `references/analysis.md` — reference profiles: what is measured, what is authored, where each is saved.
- `references/brand.md` — the brand interview: 39 slots, statuses, sources, live font pairings, and the record it emits.
- `references/config.md` — the config contract with a worked example.
- `references/surfaces.md` — routing rules, Hallmark/MotionSites/Open Design/Penpot, and the traps.
- `references/environment.md` — verified machine reality: Eagle, browsers, Penpot, tokens.
- `references/output-contract.md` — what `status` means and what a partial run must not invent.
