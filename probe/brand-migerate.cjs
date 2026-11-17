// One-off helper: recover an answers file from a generated brand.json.
//
//   node brand-migerate.cjs <brand.json> [answers.json]
//
// Defaults the output to <brand.json dir>/data/answers.json. No paths are
// assumed beyond the one you pass.
const fs = require('fs')
const path = require('path')

const [, , from, toArg] = process.argv
if (!from) {
  console.error('usage: node brand-migerate.cjs <brand.json> [answers.json]')
  process.exit(1)
}
const target = toArg ?? path.join(path.dirname(from), 'data', 'answers.json')
if (!fs.existsSync(from)) {
  console.error(`not found: ${from}`)
  process.exit(1)
}
const j = JSON.parse(fs.readFileSync(from, 'utf8'))
const answers = {}
for (const [id, slot] of Object.entries(j.slots || {})) {
  if (slot.value == null && slot.status == null) continue
  answers[id] = { value: slot.value ?? null, status: slot.status ?? null, source: slot.source ?? null }
}
// dials live under direction.dials in the record; the interview stores them on the 'dials' slot
const dials = {}
for (const [id, d] of Object.entries(j.direction?.dials || {})) {
  dials[id] = { current: d.current ?? null, target: d.target ?? null }
}
answers.dials = { value: dials, status: answers.dials?.status ?? null, source: null }
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, JSON.stringify({ savedAt: new Date().toISOString(), answers }, null, 2) + '\n')
console.log(`recovered ${Object.keys(answers).length} slots → ${target}`)
