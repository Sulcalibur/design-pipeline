# Design loop

The path from a reference to a page that can be checked. Every stage ends in a file, and no stage
starts before the previous one has one.

```
scope/
  <slug>/
    00-brief.md        what problem, for whom, how we know it worked
    01-references.md   what we looked at, what transfers, what must not
    02-direction.md    three directions, one decision, six dials
    03-structure.md    section jobs, component inventory, states
    04-assets.md       slots, prompts, placeholder contract
    review.md          what was checked, at which viewport, with what result
```

## Stages and gates

| # | Stage | Ends in | Gate |
|---|-------|---------|------|
| 1 | Intake | `00-brief.md` | A stranger could build from it without asking a question |
| 2 | Collect | `01-references.md` | Every reference names a transferable device and a thing not to copy |
| 3 | Direct | `02-direction.md` | One direction chosen in writing, with three named decisions |
| 4 | Structure | `03-structure.md` | Every section has a job; every interactive element has states |
| 5 | Assets | `04-assets.md` | Every image slot has a ratio, a prompt, and alt text before layout |
| 6 | Build + verify | code + `review.md` | Screenshots at five widths, axe, keyboard, reduced motion, cold read |

## Rules that hold across stages

- **UX before UI.** Page anatomy and component states are decided before type and colour are polished.
- **Specify, don't vibe.** "Warm and editorial" is not a direction until it becomes three decisions.
- **Distance is mandatory.** At least one reference from outside the category (print, film, packaging,
  illustration, architecture). A library of competitor sites converges on the same page.
- **Reference the device, never the surface.** Copying a layout mechanic is research; copying a palette,
  wordmark or illustration style is imitation.
- **Real content before layout.** No lorem, no placeholder headlines, no invented metrics.
- **Images are specified before they exist.** A slot has a ratio, a prompt and alt text from day one.
- **No visual claim without evidence.** `review.md` records the check, the viewport and the result.

## Anti-slop tests (run at review)

1. **Logo removal** — cover the wordmark. Can you still name the site? No → generic.
2. **Category swap** — put a competitor's name on it. Does it still fit? Yes → generic.
3. **Squint** — blur 10px. One focal point and a rhythm? No → hierarchy failure.
4. **Grayscale** — desaturate. Does hierarchy survive? No → colour is doing layout's job.
5. **Cold read** — a fresh agent sees only the screenshot: what is this, for whom, what is memorable?

## Dials

Score 1–5, current and target. The gap is the brief for the visual work.

`density` · `contrast` · `warmth` · `editoriality` · `ornament` · `motion`
