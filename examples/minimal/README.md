# Minimal example

A neutral project with just enough to compile a handoff: a brand record, a brief, a committed
direction, and a token file. No Eagle, no probe run, no network.

```bash
cd examples/minimal
node ../../probe/context.mjs --project . --target generic --scope "Work index — first screen"
```

This writes `docs/design/demo/handoff/` with:

- `context.md` — the one-page brief and precedence
- `prompt.md` — an opening prompt
- `brand.json`, `brief.md`, `direction.md`, `tokens.css`, `tokens.json`
- `examples/README.md` — empty until you supply approved and rejected exemplars

The compiler lists what is missing (`build-spec.json`, references) rather than inventing it. That is the
point: a handoff is only as good as the record it compiles.

To run the gates on a real page:

```bash
cd ../..
bin/probe content --project examples/minimal --url https://example.com/
```
