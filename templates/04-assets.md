# Assets — <slug>

## Slot inventory

| ID | Role | Ratio | Placement | Prompt ref | Palette tokens | Alt | Status |
|---|---|---|---|---|---|---|---|
| | | | | | | | pending |

## Placeholder contract

- Component: `<path>`
- Props: `id`, `ratio`, `role`, `promptRef`, `palette`, `alt`, `src?`
- Renders at the real ratio; empty slots must not collapse or shift layout.
- Audit mode: `<url>?art=audit` lists every unfilled slot.

## Midjourney sheet

**Style anchor:** <one line describing the set, with the anchor image URL>
**Anchor flags:** `--sref <url> --sw 100 --style raw --s 150`
**Negatives:** `--no text, watermark, 3d render, neon, photorealistic`

### <slot-id>

```
<subject>, <composition>, <medium>, <palette>, <light>, <texture>
--ar <ratio> --seed <n>
```

- Crop: <focal point, safe area>
- Alt: <sentence>

## Sourcing order

1. Real product screenshots and real photography.
2. Existing library assets (Eagle).
3. Generated set, from the anchor above.

## Swap protocol

1. Export `<slot-id>.webp` at 2 widths.
2. Drop in `<public path>`.
3. Set `src`.
4. No layout change. If layout changes, the slot spec was wrong.

## Review checklist

- [ ] Every slot has a ratio, prompt, alt.
- [ ] No stock people.
- [ ] Palette of each image matches the direction contract.
- [ ] Dark and light treatments considered.
