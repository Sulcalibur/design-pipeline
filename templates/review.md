# Review — <slug>

What was checked, at which viewport, with what result. No visual, responsive or accessibility claim
belongs in this file without the check beside it.

## Scope

- Build: <commit / branch>
- URL or preview: <url>
- Date and reviewer:

## Audit

From `probe audit --url <url> --slug <slug>`:

| Category | Score |
|---|---|
| Performance | |
| Accessibility | |
| Best Practices | |
| SEO | |

### Findings

| Finding | Detail | Fix or waiver | Why |
|---|---|---|---|
| | | | |

A score is not a pass. Every failing audit is either fixed or waived with a reason.

## Viewports

| Width | Result | Evidence |
|---|---|---|
| 390 | | |
| 768 | | |
| 1024 | | |
| 1440 | | |
| 1920 | | |

## States

- [ ] hover, focus-visible, active, disabled
- [ ] loading, empty, error
- [ ] overflow: long titles, long words, no images
- [ ] reduced motion removes entrance animation

## Keyboard

- [ ] every control reachable, order matches reading order
- [ ] focus visible, never hidden behind a sticky header
- [ ] skip link works
- [ ] no trap except an intentional modal

## Accessibility

- [ ] axe run with zero serious or critical findings (Lighthouse category covers this)
- [ ] contrast on every text/background pair
- [ ] images have alt, decorative images have empty alt
- [ ] headings in order, one h1
- [ ] language set, page titled

## Anti-slop tests

1. Logo removal — cover the wordmark; can you still name the site?
2. Category swap — put a competitor's name on it; does it still fit?
3. Squint — one focal point and a rhythm?
4. Grayscale — does hierarchy survive?
5. Cold read — a fresh reader sees only a screenshot: what is this, for whom, what is memorable?

## Unverified

Everything not checked, named. "Not tested on a real device" is a valid entry and belongs here.
