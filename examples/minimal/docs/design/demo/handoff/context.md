# Design context — Northwind

> Generated 2026-11-17 · target **generic** · scope **Work index — first screen**
> Precedence: brand constraints **>** the direction contract **>** the brief **>** references **>** this prompt.
> If two constraints conflict, stop and ask. Never average them.

## How to use this

1. Read this page first. It is the whole brief.
2. `brand.json` and `brand.md` are the constraints; they are not suggestions.
3. `direction.md` is the committed direction. `build-spec.json` (when present) is the executable subset.
4. `tokens.css` / `tokens.json` hold the only allowed values.
5. `references/` teaches devices. Borrow the device, never the surface.
6. `examples/` is what "right" looks like — when they are annotated.

## The job

A small studio that makes public-sector services easier to use.

- Commissioners in local government.
- Service owners who inherit a service and need it fixed.

Ask for a conversation, with two relevant case studies one click away.

### Acceptance criteria

- [ ] A commissioner can name one service the studio has improved, in ten seconds.
- [ ] Every claim links to a receipt — a live service, a report, or a named outcome.
- [ ] No stock photography and no invented metrics.


## Brand constraints

- **Product:** Northwind
- **One line:** A small studio that makes public-sector services easier to use.
- **Promise:** A commissioner can tell, in one screen, whether this studio has done the work before.
- **Who it is for:** Commissioners and service owners in local government.
- **Voice rules:** Plain English, first person · Every claim carries a receipt
- **Banned words:** seamless · world-class · revolutionary
- **Forbidden territory:** gradients · stock photography · fake metrics

### Colour roles

| Role | Value |
|---|---|
| paper | #F6F3EC |
| ink | #18211D |
| accent | #1F5C45 |
| surface | #FFFFFF |

### Type roles

| Role | Value |
|---|---|
| display | Fraunces |
| body | Newsreader |
| ui | IBM Plex Mono |

### Dials

—

## Direction

**Committed: the evidence ledger.** A single ruled index of work, one receipt per row, with the
statement above it. It gives up the visual comfort of a photograph-led hero: the proof has to carry
the first screen.

### Contract

| Slot | Decision |
|---|---|
| Display type | Fraunces, statement at 48–80px |
| Reading type | Newsreader, 17–19px, 60–72ch |
| UI and labels | IBM Plex Mono, labels only |
| Surface | `#F6F3EC` paper, `#18211D` ink |
| Accent | `#1F5C45`, links and the one primary action |
| Motion | 200ms, opacity and transform only, reduced-motion honoured |

### Forbidden list

- gradients, glassmorphism, stock photography
- invented metrics, quotes or client logos
- card grids without a receipt







## References

_No captured reference pack. Capture with `probe capture --device … --avoid …`, then run `probe refs`._

## Exemplars

_None supplied. Two approved sections and one rejected, each with a one-line reason, is the highest-leverage input in this handoff._

## Mock content

- Mock copy is allowed **at layout stage only**, when the real copy does not exist.
- Mark it explicitly: `data-mock` on the element, or a `MOCK:` prefix in the copy source.
- Keep it plausible in length and register; lorem hides layout problems.
- Remove every mock before build or launch. `probe content --stage build` and `probe copy --stage build` fail on it.
- **Never mock a number, quote, testimonial, client logo or outcome.** Those are not placeholders; they are false claims.

## Do not

- never write “seamless”
- never write “world-class”
- never write “revolutionary”
- never use gradients
- never use stock photography
- never use fake metrics
- never invent a metric, quote, testimonial, logo or case-study count
- never introduce a colour, font, radius or shadow that is not in the tokens
- never copy a reference’s palette, wordmark or illustration style

## Files in this handoff

| File | What it is |
|---|---|
| `context.md` | this page — read first |
| `prompt.md` | the opening prompt for generic |
| `brand.json` · `brand.md` | the constraints and the story |
| `brief.md` · `direction.md` | the job and the signed direction |
| `build-spec.json` | executable rules, when the probe produced them |
| `tokens.css` · `tokens.json` | the only allowed values |
| `references/` | the captured pack, with device and avoid notes |
| `examples/` | approved and rejected exemplars, when supplied |
| `audit.md` | the latest audit, when `--with-audit` was used |
