# Reference profiles

A screenshot carries two kinds of information, and they need different owners.

- **Measured** — what pixels can prove. Deterministic, cached, regenerable.
- **Authored** — what only looking tells you: the typeface's character, the layout's intent, the
  devices worth borrowing. Written by an agent or a person, preserved across refreshes.

Keeping them apart is the point: a heuristic guess at a font is worse than an empty field, and a measured
palette should not be overwritten by a re-run of the probe.

## Command

```bash
"$PIPE/bin/probe" analyze --config <project>/docs/design/<slug>/probe.config.json
```

Defaults to the ids referenced by `pairs` — the images the probe will actually show. Variants:

| Flag | Effect |
|---|---|
| `--ids a,b,c` | specific captures |
| `--all` | every indexed candidate (use with `--limit`) |
| `--limit 200` | cap the work |
| `--refresh` | ignore the cache and re-measure |
| `--brief` | write `data/look-sheet.md`: per-image authoring contract |

Run it after `ingest`, before `sheet`: the contact sheet then shows palette chips, density and column
count on every card, so pairs can be curated from the sheet instead of opening each capture.

## Measured fields

| Field | Meaning | Confidence |
|---|---|---|
| `palette` | up to six colours, merged, with share and a neutrality flag | good |
| `background` | the most common merged colour | good |
| `whitespace` | share of pixels near the background colour | good |
| `visualDensity` | `airy` > 0.58 whitespace, `dense` < 0.32, else `balanced` | good at page scale |
| `luminance` | mean luminance, 0–1 | good |
| `contrast` | luminance standard deviation / 128 | good as a relative signal |
| `temperature` | mean (R − B), negative is cool | good |
| `edgeDensity` | share of pixels with strong local gradient | useful raw, not a verdict |
| `bands` | content runs separated by calm gaps, 1–12 | approximate section count |
| `columns` | interior gutters in the hero region + 1, 1–3 | weak on tall captures; treat as a hint |
| `alignment` | where the edge mass sits: `left-led`, `centred`, `balanced` | weak |
| `aspect` | full height / width | exact |

Every profile is written with `method: "pixel-heuristics@1"` and a shared `limits` array. When a
measurement changes a decision, cite the field and treat `columns`/`alignment` as hints only.

## Authored fields

```jsonc
"authored": {
  "style": "editorial / quiet",
  "layoutModel": "single column with a right rail",
  "heroPosture": "centred display over a soft gradient",
  "nav": "wordmark left, four pill links right, one gold action",
  "mediaTreatment": "plated images, small captions, 2×2 grid",
  "colourRoles": ["paper: warm off-white", "ink: near-black", "accent: one coral CTA"],
  "typeVoice": "high-contrast display face, tight leading; body serif at 18px",
  "sections": [
    { "name": "Start here", "job": "send a new reader in", "composition": "two large cards side by side" },
    { "name": "Latest", "job": "show the writing is alive", "composition": "dated list left, three stacked cards right" }
  ],
  "devices": ["date-stamped entries", "captions set small under the plate"],
  "avoid": ["the wordmark repeated in the hero", "three equal cards"],
  "rating": 4,
  "confidence": "high",
  "notes": "Rhythm comes from image heights, not spacing.",
  "reviewedBy": "design-director",
  "reviewedAt": "2026-10-28T10:00:00.000Z"
}
```

Rules for authoring:

1. **Name the device, not the surface.** "A ruled index with year heads" transfers; "their palette" does not.
2. **Never invent a font name.** Describe the voice — "high-contrast serif, tight leading" — unless the
   source states the family.
3. **`avoid` is evidence.** What the rejected capture teaches is as valuable as what the chosen one does.
4. **Do not fill a field you did not observe.** `null` is a valid, honest value.

## The link layer

Eagle often stores the gallery page (`lapa.ninja`, `land-book`, …) rather than the site it depicts.
`links` resolves that hop and records every form of the URL:

```bash
"$PIPE/bin/probe" links --config …
"$PIPE/bin/probe" links --config … --set 'LNHYNKWGWER0J=https://frontapp.com/?ref=lapaninja'
```

| Field | Meaning |
|---|---|
| `galleryUrl` | the page Eagle saved, canonicalised |
| `linkedAs` | the raw href the gallery used, `ref=` and all — provenance |
| `siteUrl` | the canonical site address, tracker params stripped |
| `finalUrl` | where it lands after redirects (verified) |
| `title`, `status` | what answered, so a dead link is visible |
| `method` | `ld-json:*`, `anchor-cta`, `anchor-outbound`, `manual`, `direct` |
| `needsManual` | the gallery refused the request; resolve and `--set` |

### URL cleaning

`tracking` is the default: removes `ref`, `referrer`, `utm_*`, `fbclid`, `gclid`, `msclkid`,
`mc_cid`, `mc_eid`, `mkt_tok`, `_hsenc`, `_hsmi`, `igshid`, `trk`, `campaign`, `affiliate` and kin.
It also drops the fragment, a default port, a trailing slash and sorts remaining params.

```bash
"$PIPE/bin/probe" links --clean 'https://frontapp.com/?ref=lapaninja'
# → https://frontapp.com/
```

| Mode | Use |
|---|---|
| `tracking` (default) | keep functional params like `page`, `id` |
| `all` | keep nothing; for canonical reference links |
| `none` | keep everything; for debugging |

Set per project in `probe.config.json`:

```jsonc
"links": { "stripQuery": "tracking", "keepParams": ["page", "id"] }
```

`--strip` overrides the config; `keepParams` always wins over the strip mode.

## The live layer

A saved capture is evidence of what you saw. The live page is evidence of what is true now: real font
stacks, computed colours, declared custom properties, section sizes, the motion that exists.

```bash
"$PIPE/bin/probe" live --config … [--ids a,b] [--all] [--limit 20]
```

One page per id, rendered at 1440×900 in an isolated Chrome for Testing, then extracted:

| Field | Value |
|---|---|
| `roles.h1 / h2 / body / nav / action` | font family, size, weight, line-height, letter-spacing, transform, colour, box |
| `roles.navLinks` | how many links the nav actually holds |
| `rootProps` | every `--custom-property` declared on `:root` that is readable (cross-origin sheets are skipped) |
| `colours` | computed `color` / `background-color` frequency |
| `sections` | tag, hint, height, background, display, grid columns, heading text |
| `motion` | count of elements with a transition or animation |
| `a11y` | `h1` count, images, images missing `alt`, language |
| `screenshot` | `data/live/<id>.png` at 1440×900 |

**Gallery captures are skipped.** A `land-book` / `landingfolio` / `lapa` URL is the gallery, not the
site; following it is scraping. `ingest` records those as `via`, and `live` refuses them by name.

**Drift is a fact, not an error.** The capture may predate a redesign. Where the live page and the saved
image disagree, record it in `authored.notes` and cite which is which — the direction is chosen from what
you saw, not from what the site became.

## The vision pass

A multimodal model can read structure from a screenshot better than any heuristic: hero posture, the
section order and each section's job, the nav model, media treatment, colour roles and the type voice. It
cannot be trusted on exact measurements, palette values or font families — those stay with the measured
layer and with the source.

```bash
"$PIPE/bin/probe" analyze --config … --brief    # writes data/look-sheet.md
```

Then, for each image: open the file with the image-reading tool, and fill `authored` in
`data/analysis.json`. Guidance:

- **Downscale before reading.** ~700px wide is enough for structure and costs far fewer tokens; crop a
  region when a detail matters (nav, a card, a caption treatment).
- **If you cannot see the image**, stop. Write `confidence: "none"` and `notes: "not looked at"`, and say
  so in chat. Never author a description from the filename, the URL or the measurement table.
- **Measurements and sight will disagree.** Record it in `notes` instead of silently overriding: the
  column heuristic in particular mis-reads multi-column sections as one column.
- **Describe the device, not the surface**, and never name a font family the source does not state.

Which models can do this varies by deployment. The probe works without vision; the authored layer is
simply thinner, and the readback must say so rather than imply every reference was looked at.

## Where things are saved

| Layer | Path | In git? |
|---|---|---|
| Measured cache | `~/Library/Caches/design-pipeline/images/<hash>.json` | no — machine-local, keyed by library + id + mtime |
| Project profiles | `<project>/docs/design/<slug>/data/analysis.json` | **yes** — the authored layer is project knowledge |

`analysis.json` is deliberately not gitignored: the measured half is regenerable, but the authored half
is not. A refresh rewrites `measured` and leaves `authored` untouched.

## What this does not do

- No OCR, no font identification, no style classification. Those need either a model looking at the image
  or a person.
- No DOM-derived layout: a screenshot has no box model. `bands` and `columns` are visual estimates.
- No judgement about whether a reference is good. It records what is there.
