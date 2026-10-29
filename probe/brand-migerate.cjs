// One-off: recover the answers file from a generated brand.json
const fs = require('fs')
const j = JSON.parse(fs.readFileSync('/Users/sul/Developer/experiments/beagles-bikes/docs/brand/brand.json', 'utf8'))
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
fs.writeFileSync(
  '/Users/sul/Developer/experiments/beagles-bikes/docs/brand/data/answers.json',
  JSON.stringify({ savedAt: new Date().toISOString(), answers }, null, 2) + '\n',
)
console.log('recovered', Object.keys(answers).length, 'slots from brand.json')
