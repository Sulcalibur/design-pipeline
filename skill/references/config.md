# Config

`probe.config.json` is the source of truth. Everything else is generated.

## Minimal valid config

```jsonc
{
  "id": "acme-home",
  "created": "2026-10-28",
  "intake": [
    {
      "id": "character",
      "question": "What should the work feel like when it is right?",
      "help": "Choose up to three.",
      "type": "multi",
      "max": 3,
      "recommend": ["warm"],
      "recommendWhy": "The existing art is watercolour.",
      "options": [
        { "id": "warm", "label": "Warm", "boosts": { "media": 10 } },
        { "id": "exact", "label": "Exact", "boosts": { "density": 10 } }
      ]
    }
  ],
  "pairs": [
    {
      "id": "opening",
      "axisKey": "opening",
      "axis": "Opening",
      "question": "What should the first screen do?",
      "hint": "Ignore colour and type. Which structure would you keep?",
      "priority": 50,
      "when": {},
      "options": [
        {
          "id": "ref-01",
          "label": "Image first",
          "source": "Example A",
          "url": "https://example.com/",
          "alt": "A page opening with a large photograph",
          "vocab": "Image leads the first screen",
          "constraints": { "opening": "image" },
          "avoid": "a page that opens on a paragraph",
          "note": "The image carries the first screen."
        },
        {
          "id": "ref-02",
          "label": "Statement first",
          "src": "/absolute/path/to/shot.png",
          "source": "Example B",
          "url": "https://example.com/b",
          "alt": "A page opening with a large sentence",
          "vocab": "A sentence leads the first screen",
          "constraints": { "opening": "statement" },
          "avoid": "a decorative hero image",
          "note": "Type carries the first screen."
        }
      ]
    }
  ],
  "followups": [
    {
      "id": "heroArt",
      "label": "Hero art",
      "question": "Where does the hero image come from?",
      "type": "single",
      "when": { "opening": ["image"] },
      "options": [
        { "id": "photo", "label": "My own photograph", "constraint": { "heroArt": "photo" } },
        { "id": "none", "label": "No image yet", "constraint": { "heroArt": "none" } }
      ]
    }
  ],
  "ui": { "title": "Acme reference probe", "mark": "Acme", "storageKey": "probe:acme-home", "note": "" },
  "output": { "readbackTitle": "Probe result — Acme home" },
  "sources": { "kind": "folder", "path": "references" },
  "paths": { "out": ".", "data": "data", "build": "build" }
}
```

## Blocks

| Block | Notes |
|---|---|
| `intake` | 6–7 questions. `single` or `multi`. Each option may `boost` axes. `recommend` must name real option ids; `recommendWhy` is required when a recommendation exists. |
| `pairs` | One axis per pair. `axisKey` groups variants of the same axis; `mode: "confirm"` adds a consistency check and needs `after`. |
| `followups` | Conditional; `when` maps a constraint key to allowed values. Every option needs a non-empty `constraint`. |
| `facts` | `{ text, source }`, optional `when`. Looked up, never asked. |
| `intakeClose` | the closing screen; `question`, `help`, `yes` |
| `baseline` | the committed direction to check against: `direction`, `constraints`, optional `intensity`, `when` |
| `ui` | `title`, `mark`, `storageKey`, `note` |
| `system` | `tokensFile`, `tokensNamespace`, `tokenRefs` — optional |
| `output` | `readbackTitle`, `systemNote`, `assetsNote`, `directionFile`, `agentBrief[]`, `doNot[]` |
| `semantics` | `vocabulary`, `implications`, `details`, `crossMedia`, `conflictNotes`, `assets[]`, `pendingTokens[]`, `openQuestions[]` |
| `sources` | `{ kind: "eagle" \| "folder", library?, path?, generatedPrefix? }` |
| `paths` | `{ out?, data?, build? }`, relative to the config directory |
| `links` | `{ stripQuery: "tracking" \| "all" \| "none", keepParams: [] }` |

## Semantics, and what happens without them

`semantics.vocabulary` maps `constraintKey → value → human label`. Used in tables and in the spec.

`semantics.implications` and `semantics.details` map `key → value → sentence` and become `buildRules`.
**If either is non-empty, they are authoritative**: no fallback rules are invented on top. With neither,
each chosen option's `vocab` becomes its build rule, so a project that has written no semantics still
gets actionable output.

`semantics.assets` is a list of rules. The **first match per id wins**:

```jsonc
{ "id": "hero-plate", "when": { "opening": "image", "heroArt": "commission" }, "effect": "Slot stays pending until commissioned." }
{ "id": "hero-plate", "effect": "Stays behind the statement." }
```

`semantics.pendingTokens` accepts `{ name, value, why }` or `{ name, valueFrom: { intensity: "motionMs", suffix: "ms" }, why }`.
`{intensity}` in any authored prose resolves to the run's intensity name.

`semantics.conflictNotes` is keyed `"key:value"` and only shown when the baseline disagrees.

## Folder manifest

```jsonc
{
  "items": [
    { "id": "ref-01", "name": "Homepage", "file": "ref-01.png", "width": 1440, "height": 900,
      "url": "https://example.com/", "kind": "page", "tags": [], "folders": [] }
  ]
}
```

`id` defaults to `ref-NN`. `file` resolves relative to the manifest. `file` or `url` is required; a
missing file fails the ingest rather than silently producing a broken pair.

## Sheet slice

```jsonc
"sheet": {
  "slice": {
    "tags": ["inspiration"],
    "folders": ["Portfolio Examples"],
    "hosts": ["austinkleon", "jessicahische"],
    "excludeHosts": ["airbnb.com", "expedia.com"],
    "title": "Editorial slice — 133 captures",
    "meta": "Inspirations.library · known editorial hosts"
  }
}
```

No slice config means everything in `candidates.json`, sorted by host then name.
