# Brand interview

A local web app that asks the brand questions one at a time and writes the record. It exists because a
brand is the constraint every later decision is checked against — and because "write a brand doc" produces
adjectives, not decisions.

```bash
"$PIPE/bin/probe" brand scaffold --project .
"$PIPE/bin/probe" brand serve    --project .      # http://127.0.0.1:4211
"$PIPE/bin/probe" brand status   --project .
"$PIPE/bin/probe" brand emit     --project . [--dry]
```

## What it asks

Thirty-nine slots in six sections. The first twelve are the positioning record from `brand-breakdown`; the
next nineteen are the visual identity and direction that the skill leaves out.

| Section | Slots |
|---|---|
| Evidence | product, one line, stage, owner and date, sources read |
| Define | A1 the thing, A2 who, A3 the alternative, A4 the problem in their words |
| Position | B1 promise, B2 proof (exists / earnable / never claim), B3 offer, B4 category, B5 enemy |
| Operate | C1 voice (rules, banned words, keeper lines), C2 economics, C3 the one motion |
| Identity | V1 logo, V2 colour roles (paper, ink, accent, surface), V3 type roles (display, body, UI), V4 imagery, V5 layout signatures, V6 motion, V7 texture and detail, V8 forbidden territory |
| Direction | D1 three decisions and one refusal, D2 the six dials (current and target) |

Each screen carries three controls beyond the answer:

- **Status** — `Verified` (read in a source), `Assumption` (your belief), `TBC` (not known).
- **Source** — a file, URL or conversation for *this* slot. A slot with no source cannot be `Verified`.
- **Mark TBC** — moves on without pretending.

The two are independent on purpose: an answer can be present and still be an assumption.

## Font options

The type question is not a blank field. `brand.config.json` carries six curated pairings — editorial
warmth, modern minimal, swiss technical, publication, playful editorial, quiet luxe — each with display,
body and UI families and a one-line rationale. They render as live specimens in the app (Google Fonts,
OFL), so the choice is made by looking rather than by naming a font from memory.

Choosing one fills the three type slots and marks them `assumption`, with the source `chosen in the brand
interview`. The fields stay editable; a project's real faces override a suggestion.

**Eagle specimens.** `probe fonts --project .` indexes the URL-less, small, weight-tagged captures in the
library and copies a preview of each into `docs/brand/fonts/`, so the app can show "from your library"
beside the pairings. Clicking a specimen uses its name; specimen names are captures, not authoritative
family names, so it records `assumption`.

There is no dependable public API for font pairing. Google Fonts publishes a metadata endpoint
(`fonts.google.com/metadata/fonts`) for categories and weights, but recommendations here are a curated
shortlist plus rules (one display, a reading body, a quiet UI), not a ranked model.

## Checks the record runs

**Contrast.** Five pairs, computed from the colour slots: ink on paper, ink on surface, paper on accent
(a CTA fill), accent on paper, accent on surface. Each has its own minimum (4.5 for body text). A failure
prints `FAIL` in `brand.md` and in the app's review screen.

The agent may cross-check a marginal pair with the `a11y` MCP (`check_color_contrast`) — the same WCAG
maths, but it keeps the number independent of this code. The app's own calculation stands as the record.

**Type.** `probe fonts validate --project .` extracts the family from each type slot and checks it against
the Google Fonts catalogue (metadata cached for 30 days):

| Verdict | Meaning |
|---|---|
| `google` | a real OFL family; the category is reported |
| `system` | a system stack; no webfont licence needed |
| `unknown` | not on Google Fonts — self-hosted, commercial or misspelled; confirm the licence |

`unknown` is not an error. `Arco` is a legitimate answer; it just cannot be verified from a public
catalogue, so the record says so instead of implying it was checked.

## What it writes

```
docs/brand/brand.md      the record: sources, every slot with its status, contrast results, gaps, direction
docs/brand/brand.json    the same for agents
docs/brand/data/answers.json   the working answers (gitignored)
```

`brand.md` opens with a contrast table computed from the colour slots — ink on paper, ink on surface — with
the ratio and whether it clears the configured minimum. A failing pair is shown as `FAIL`, not softened.

It ends with a **gap table** (every TBC and every required slot that is empty) and an **assumptions** line.
Those are the parts a reviewer reads first.

## Context in the questions

Every slot carries three explanation lines, served fresh from the tool default even if
the project's copied config is older: **why this question** (what the answer feeds),
**what a good answer looks like** (a worked example, often a bike-shop one), and a
**TBC hint** (when not knowing is the honest answer). If a slot's answer looks like it
answered the neighbouring question — a tone word in the promise, a subject where a
layout signature belongs — read the why line aloud before re-asking.

## AI help

Every slot has an **AI help** button. It drafts an answer from the record so far
(spawned through `opencode run`; `BRAND_AI_CMD` / `BRAND_AI_MODEL` override it) and
fills the field as `assumption` with the source line **"AI draft — replace with the
real answer"**. It never marks `verified`, and the value counts toward the
assumptions line in the record either way. A slot with an existing answer asks
before replacing. Late in the interview the context is richest — the loop-back is
the point.

## How it connects

The probe reads the record automatically. `probe build` walks up from `docs/design/<slug>/` to the project
root; when it finds `docs/brand/brand.json` the runtime carries the block, `status` reports it, and `emit`
writes a **Brand constraints** section into `build-spec.json` and `05-decision.md`. No record → the section
is absent, not filled from adjectives.

- **Brief** (`00-brief.md`) takes A2 for the reader and B2 for what may be claimed.
- **Direction** (`02-direction.md`) takes C1, V8 and the dials. The refusal in D1 is the forbidden list the
  build needs.
- **Assets** (`04-assets.md`) takes V4 and V8.
- **Copy** takes C1 and the banned words; an agent writing for the brand must not use them.

A project can override the question set by keeping `docs/brand/brand.config.json`; otherwise the tool's
default is used, so every project asks the same 39 questions and the records can be compared.

## Limits, stated

- One user, one record, no version history: the answers file keeps the latest save only.
- No PDF or DOCX export. `brand.md` renders anywhere; that is the deliverable.
- The app cannot verify a source. `Verified` is a claim by the person answering; the record shows what they
  cited, not whether it says that.
- `brand-extract` (live site → kit) and `brand-voice` (voice rules from published copy) are still separate
  judgement skills. This app records their conclusions; it does not run them.
