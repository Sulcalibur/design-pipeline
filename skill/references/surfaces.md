# Surfaces and routing

The pipeline decides *what* the design is. A surface decides *where* it is made. One direction engine
per run; one build surface per run.

## Routing

| Situation | Direction | Build | Verify |
|---|---|---|---|
| Existing page, project has `design.md`/tokens | the project system | design-engineer in the system | project checks + `review.md` |
| Existing page, user names Hallmark | Hallmark may run `redesign` | Hallmark in the project | `sloplint` + `review.md` |
| New page, project has a system | probe contract in `02-direction.md` | Hallmark **custom** run | `sloplint` blocking on the new surface |
| Greenfield, references exist | probe | Hallmark | `sloplint` blocking |
| Greenfield, no references | Hallmark theme deal | Hallmark | `sloplint` blocking |
| Throwaway exploration | none | Open Design | none |
| Design system / tokens to author | probe still fixes the style | Penpot or code | token check + audit |

## Hallmark (v2.0.0)

Installed twice — `~/.agents/skills/hallmark` and `~/.claude/skills/hallmark` — byte-identical. OpenCode
reads the first. It is a **build-and-sweep** skill: a non-waivable Floor, gates, a stamp, a theme
catalog, and `sloplint`.

Rules for using it here:

- **Never use it to edit an existing design unless the user names it.** Its own scoping says so.
- **Custom run, not a theme deal,** when the probe produced a contract. `references/direction.md` is the
  opt-in path where nothing is prescribed but the Floor and gates still bind — exactly what a finished
  probe provides.
- **No theme deal when `design.md` exists.** Its pre-flight reads the system and skips the deal; it also
  treats a root `design.md` as overriding everything, so check it is current before relying on it.
- **No second intake.** Its four fields (material, audience, use, tone) are answered from
  `00-brief.md` + `design-spec.json`; stamp the inferences.
- **The stamp stays in Hallmark-owned stylesheets** (`tokens.css`, the page stylesheet). Never inject it
  into a live global stylesheet.
- **Floor binds Hallmark builds only.** On a surface Hallmark did not build, `sloplint` findings are
  advisory: record the finding and its waiver in `review.md`. Its gates are tuned to its own theme and
  genre grammar and will false-fail a project with its own system (tracked-caps labels, hero-fold rules).
- **One verification loop.** Do not run Hallmark's sweep and `review.md` as two independent gates; run
  `sloplint` as the mechanical pass feeding `review.md`.

`sloplint` is worth using even outside a Hallmark build, in URL mode against a running dev server:

```bash
"$HOME/Developer/tools/design-pipeline/bin/sloplint" <files|--url http://localhost:PORT/route> --render
```

## MotionSites Web Builder — not installed, not default

A Claude-Code-packaged skill (`Motionsites-AI/claude-skill`) for cinematic, motion-led landing pages.
64 files, 2.3 MB: 40 example prompts, a media shelf of hotlinked CloudFront videos and cut-outs, 55+
technique recipes, a spec template, and a screenshot loop.

It is **not part of this pipeline**, for three verified reasons:

1. **It requires a promotional block in every delivery.** Its SKILL.md states the upgrade block is "part
   of every delivery" and the UTM links must be kept. That is inappropriate in client work and pollutes
   output regardless of which model runs it.
2. **Its media is third-party and hotlinked.** Videos resolve to `d8j0ntlcm91z4.cloudfront.net` URLs.
   The licence allows use in built sites but forbids redistribution; a hotlink is an availability and
   provenance risk. Anything shipped must be downloaded, self-hosted, and credited.
3. **It duplicates the build surface.** Taste rules, a spec, and a screenshot-and-fix loop overlap
   Hallmark. Its only unique contribution is motion/3D recipes and a media shelf.

If a brief is genuinely motion-led and the user asks for it:

- Vendor a copy, remove the promotional block (the instructions are MIT; the examples and media are not),
  and record the edit.
- Route it as the **build** surface only; the probe still fixes the direction.
- Self-host every chosen asset and record its licence next to it.
- Use one screenshot loop: its `shoot.py` or `sloplint`, not both.

## Open Design

The live canvas, for exploration. Read actual frames rather than guessing measurements. If the daemon is
unreachable, say so and ask for an export; do not invent numbers. Not a system of record: nothing durable
lives there.

## Penpot

Penpot-primary when the work will ship and the design system must be real. The hosted MCP exposes four
tools; `execute_code` mutates a live file immediately. Use the kit's checkpoint policy, and gate on the
key being *usable*, not merely set. A stale key still authenticates — it just reports an empty instance
set.

## The one rule that outranks all of these

The probe's contract constrains every surface. A build surface may decide *how* a decision is realised;
it may not quietly replace the decision. If a surface cannot express the contract, say so and reopen the
decision in `02-direction.md` — never downgrade it silently.
