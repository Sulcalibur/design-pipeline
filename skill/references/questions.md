# Question packs

`probe ask` is a deterministic interview engine. A pack is a constant spine of questions plus conditions
that decide which are visible for this project. No model is called; the recommendations are derived from
the brand record and the project files.

## Pack shape

```jsonc
{
  "id": "brand",
  "title": "Brand interview",
  "include": "../brand.config.json",       // a base question set
  "context": [                             // asked first, before the base
    {
      "id": "kind",
      "section": "context",
      "question": "Is this a person, a company, or a public body?",
      "type": "single",
      "required": true,
      "gate": "blocking",
      "options": ["person", "company", "public"]
    }
  ],
  "askIf": {
    "owner": { "kind": ["company", "public"] },
    "c2": { "kind": ["company", "public"] }
  }
}
```

A base question can also carry `askIf` directly. `askIf` maps a previous question id to the values that
make this question visible. Missing answers mean hidden: a branch waits for its parent.

## Statuses and gates

- **required** — the stage cannot close while it is unanswered.
- **gate: "blocking"** — a TBC here blocks; used for the context questions, because a branch cannot run
  on an unknown kind or sector. A required TBC elsewhere is a warning.
- **assumption** — an answer with a status, not a fact. Required assumptions are warnings, not blockers;
  the brand review already budgets assumptions.
- **TBC** — an answer of “not known”, ideally with a plan.

`--check` prints blocking gaps and recorded warnings; `--write` also emits `interview.md`.

## Recommendations

A context question may carry `recommend: { value, why }`, or the engine derives one:

| Question | Derived from |
|---|---|
| `kind` | product/one-line/public-sector language |
| `sector` | a2, one-line, promise: public-sector and regulated signals |
| `identity` | filled v1/v2/v3 slots |
| `cms` | directus/contentful/sanity/strapi/payload/wordpress in the project |

A recommendation is a suggestion with a reason. It is never recorded until someone answers.

## Stage packs

| Stage | Pack | Spine |
|---|---|---|
| Brand | `packs/brand.json` | the 39 slots + kind/sector/identity/cms |
| Brief | `packs/brief.json` | job, reader(s), action, success criteria, scope, exclusions, content, mock policy, constraints, sign-off, language, deadline, measure |
| Direction | `packs/direction.json` | dials, reference basis, opening, spine, colour field, borrowed device or distance reference, refusal, cost, forbidden list |
| Content | planned | model, roles, workflow, publish states |
| Launch | planned | domain, rollback, monitoring, owner |

The brief pack prefills `job`, `reader`, `action`, `success` and `scope` from an existing `00-brief.md`
before asking anything. `mockPolicy` is only visible when `content` is `none` or `partial`; `stakeholders`
only when `brand.kind` is a company or public body. That is the cross-stage condition syntax:
`"askIf": { "brand.kind": ["company", "public"] }`.

Adding a pack is adding a file. The engine does not need to change; the conditions and the gate are data.

## Why not put this in the brand app

The app is the visual form: 39 screens, status and source, a record. The pack engine is the interview:
branches, recommendations, and a gate that can be run from an agent or a terminal. They share
`brand.config.json`, so the spine cannot drift. The app can adopt `askIf` later without changing the
pack format.
