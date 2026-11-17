# Output contract

## Files

| File | Written by | Durable? |
|---|---|---|
| `05-decision.md` | `emit` | yes — the human readback |
| `build-spec.json` | `emit` | yes — what an agent reads first |
| `02-direction.md` | you, plus a generated block | yes — the contract |
| `docs/brand/review.md` | `brand review` | yes — the brand gate |
| `copy.md` | `copy` | yes — the voice gate |
| `content.md` | `content` | yes — the completeness gate |
| `launch.md` | `launch` | yes — the pre-flight and rollback target |
| `10-audit-<date>.md` + `audit-<date>/` | `review` | yes — the scored audit and its evidence |
| `check-<date>.md` + `maintain.json` | `maintain` | yes — the recurring check and its baseline |
| `data/answers.json` | `serve` on save | no — gitignored evidence |
| `data/candidates.json` | `ingest` | no — regenerable |
| `build/probe.json`, `build/sheet.html` | `build`, `sheet` | no — generated |

## Status

| Value | Meaning | What may proceed |
|---|---|---|
| `confirmed` | no baseline conflict, every axis probed | build |
| `partial` | some axes unprobed, no conflict | build, but the unprobed axes stay undecided — do not invent them |
| `needs-decision` | the baseline and the probe disagree | nothing until each conflict is resolved in `02-direction.md` or by re-running the pair |

A conflict is not an error. It is a decision the probe cannot make. Resolve it by changing the contract
or re-running the pair. **Never average two constraints.**

## The spec

```jsonc
{
  "generatedAt": "…",
  "runId": "…",
  "probe": "acme-home",
  "direction": "the committed direction, or 'No committed direction'",
  "reference": { "id", "label", "note" } | null,
  "applications": ["web", "social"],
  "extrapolation": [{ "key", "value", "rule" }],
  "status": "confirmed | partial | needs-decision",
  "partial": false,
  "intake": { "question": ["answer label"] },
  "facts": [{ "text", "source" }],
  "recommendations": [{ "question", "answer", "recommended", "followed", "why" }],
  "constraints": { "axis": "value" },
  "intensity": { "name", "motionMs", "motionPx", "rulePx", "imageScale", "ornament" },
  "buildRules": [{ "key", "value", "rule" }],
  "assets": [{ "id", "effect" }],
  "avoided": ["what the rejected sides teach"],
  "sources": [{ "axis", "source", "url", "borrow", "label" }],
  "confirmations": {},
  "consistency": [{ "axis", "key", "consistent", "first", "second", "resolved" }],
  "tensions": [{ "key", "a", "b", "winner" }],
  "conflicts": [{ "axis", "baseline", "chosen", "note" }],
  "unanswered": { "pairs": [], "followups": [] },
  "pendingTokens": [{ "name", "value", "why" }],
  "openQuestions": [],
  "tokenRefs": []
}
```

## Rules for the reader

1. **Read `constraints` as decisions, not suggestions.** Each one is evidence from a comparison the user
   made. Changing one requires reopening the pair.
2. **`buildRules` is the actionable layer.** If it is empty, the config has no `semantics` and no option
   vocabularies — fix the config rather than guessing rules.
3. **`unanswered.pairs` is a list of decisions that do not exist.** Do not read a default from the
   baseline into them; report them as unprobed.
4. **`pendingTokens` is the only sanctioned way to add a value not yet in the system.** Add it to the
   token source and the runtime mirror together.
5. **`sources` is evidence, not instruction.** Borrow the device; never copy the palette, wordmark or
   illustration style.
6. **`conflicts` blocks the build** when `status` is `needs-decision`.

## What the readback deliberately does not do

- No ranking or scoring of references. It records which one you kept.
- No live capture: references are historical saves.
- No confidence number: a consistency check is consistent or not.
- No micro-detail decisions (buttons, hover, nav states). Those need live captures with coordinates and
  belong to `03-structure.md`.

## Brand constraints as build rules

`build-spec.json`'s `buildRules` includes the brand record's enforceable items alongside the pair
decisions: every banned word becomes a *never write* rule, every forbidden item a *must not appear*
rule, voice rules carry a voice tag, and each dial becomes `dial-<name>` with its target. A Hallmark
custom run enforces the brand without consulting the source record; the `brand` blob remains the
context behind the rules.

## Design index (AGENTS.md / design.md)

Every emit upserts one marker-delimited section (`<!-- design-pipeline:auto -->`) into the project
root's `AGENTS.md`, `design.md`, and `docs/design/README.md`: links to the brand record, the decision
doc, the machine brief, and the direction contract, plus the treatment rules. Generated — re-run, do
not hand-edit. Files are linked, never copied.
