# Evals

The part of “the AI understood the context” that can be measured without a model.

A case is a mechanical expectation about a produced artifact: one `h1`, a language, a title, no banned
words, the case's own required and forbidden strings, colours that exist in the tokens, and no mock
copy that should have shipped. It says nothing about whether the design is good; `review` and a human
still do that.

## Run

```bash
node evals/check.mjs --file path/to/artifact.html --case work-index \
  --brand path/to/handoff/brand.json \
  --tokens path/to/handoff/tokens.json
```

`--json` for machine output. Exit 1 on any failed check.

## After an Open Design run

`probe context` writes the handoff. Hand the prompt to Open Design, then pull the artifact file and
run the same check:

```bash
node evals/check.mjs --file /path/to/od-artifact.html --case work-index \
  --brand docs/design/<slug>/handoff/brand.json \
  --tokens docs/design/<slug>/handoff/tokens.json
```

A pass means the context was followed. A fail names the exact constraint that was missed — usually a
banned word, a hard-coded colour, or mock copy that survived.

## Cases

`cases.json` holds the cases. Add one when a page type earns a stable expectation; keep the list short
and the checks real. A case that cannot fail is theatre.

## What this does not check

Taste, hierarchy, composition, whether the page answers the job, interaction states, motion, actual
contrast pairs (beyond the token set), or whether the design is any good. Those need `review`, axe, the
screenshots and a person.
