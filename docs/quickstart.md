# Quickstart

The pipeline is a set of stages with gates, not a mood. Every stage ends in a document; no stage starts
before the previous one has one. The engine is dependency-light and per-project.

## 1. Check the machine

```bash
git clone <this repo> ~/Developer/tools/design-pipeline
cd ~/Developer/tools/design-pipeline
npm install                     # optional: puppeteer-core for capture/render
bin/probe doctor
```

`doctor` reports Node, Chrome, Eagle, Lighthouse, Hallmark, the Impeccable detector and the brand
registry. Only Node is required. Rendering needs Chrome; everything else runs without Eagle.

## 2. Start a project

```bash
cd /path/to/your-project
~/Developer/tools/design-pipeline/bin/probe init --project . --slug home
```

This creates `docs/design/home/` with the five templates and `probe.config.json`, and leaves existing
documents alone. The default reference source is a **folder** (`references/`), so no Eagle install is
needed. Use `--source eagle` if you have it.

## 3. Brand first

```bash
bin/probe brand scaffold --project .
bin/probe brand serve    --project .      # http://127.0.0.1:4211
bin/probe ask --stage brand --next        # one question, with branches and a gate
bin/probe brand review   --project .      # gate: 0 blocking
```

The interview writes `docs/brand/brand.md` and `brand.json`: 39 slots, each with a status and a source.
A brand record is the constraint every later decision is checked against. `probe ask` is the same spine
with branches — a person is not asked a company's economics, a company is not asked a personal voice —
plus a recommendation and a blocking gate. Its state is `interview.json`; the brand record remains
`brand.json`.

## 3b. Brief

```bash
bin/probe ask --stage brief --next     # prefills from 00-brief.md, then asks what is missing
bin/probe ask --stage brief --check    # required brief questions answered
```

The brief pack asks for the job, reader, one action, success criteria, scope, exclusions, whether content
exists, and the mock-copy policy. Content missing reveals the mock question; a company or public body
reveals the sign-off question. The gate refuses to close while a required answer is missing.

## 4. References

```bash
bin/probe capture --url https://example.com/ --slug home \
  --device "name-as-poster" --avoid "cream palette, organic circle" \
  --fits "personal-site hero" --evidence "1440 viewport"

bin/probe refs --project .                # gate: every capture names a device and an avoid
bin/probe ingest --source folder --library-path docs/design/home/references
bin/probe analyze --config docs/design/home/probe.config.json
bin/probe sheet  --config docs/design/home/probe.config.json
```

Eagle is optional. When it is running, `capture --to auto` also copies the shot into an Eagle folder
with the device/avoid note in its annotation.

## 5. Direction

```bash
bin/probe compare previews/A.html previews/B.html previews/C.html --out previews/compare.html
```

Curate one axis per pair in `probe.config.json`, then:

```bash
bin/probe build  --config docs/design/home/probe.config.json
bin/probe serve  --config docs/design/home/probe.config.json
bin/probe emit   --config docs/design/home/probe.config.json
```

`emit` writes `05-decision.md` and `build-spec.json`. If you have no probe run, `02-direction.md` is
the contract; say so in it rather than inventing a spec.

## 6. Gates before build

```bash
bin/probe brand review --project .
bin/probe copy        --project . --url https://example.com/   # add --stage layout before real copy
bin/probe content     --project . --url https://example.com/
bin/probe context     --project . --target open-design --scope "Work index, first screen"
```

Mock copy is allowed at layout stage when marked; `--stage build` and `launch` fail on it. Never mock a
number, quote, testimonial or logo.

## 7. After build

```bash
bin/probe review    --project . --url https://example.com/
bin/probe launch    --project . --url https://example.com/ --previous <ref>
bin/probe maintain  --project . --url https://example.com/
```

`review` is the scored audit (Lighthouse, axe, sloplint, detector, brand, copy, content, launch).
`launch` checks TLS, redirects, headers, robots, sitemap, 404 and rollback. `maintain` records a
baseline and reports only what changed.

## Where things land

```
docs/brand/brand.md, brand.json, review.md
docs/design/<slug>/00-brief.md … 05-decision.md, build-spec.json
docs/design/<slug>/copy.md, content.md, launch.md
docs/design/<slug>/10-audit-<date>.md + audit-<date>/
docs/design/<slug>/check-<date>.md + maintain.json
docs/design/<slug>/handoff/            compiled context for a design tool or agent
```

## Optional surfaces

| Surface | Needed for | Without it |
|---|---|---|
| Chrome for Testing | capture, render tier, Lighthouse | text stages still run |
| Eagle | visual library, write-back, media server | folder references work |
| Hallmark / sloplint | mechanical sweep | `review` skips that pass and says so |
| Impeccable detector | detector findings | `review` skips that pass and says so |
| Lighthouse | performance/axe scores | `review` reports no scores |
| Open Design / Penpot | making the design | the handoff folder still compiles |

## The rule that holds everything

No claim without evidence. A visual, responsive or accessibility claim names the check, the URL and the
viewport — or it is marked unverified. Every finding is fixed, waived or dismissed with a reason.
