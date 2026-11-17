/* Reference probe — adaptive engine.
 *
 * Order is decided at runtime:
 *   intake (all) → pairs filtered by the intake and sorted by relevance
 *   → a confirmation pair where the library supports one
 *   → follow-ups whose conditions the answers now satisfy.
 *
 * No model calls. The curator wrote the vocabulary; this only routes and records.
 */
(() => {
  'use strict'

  let KEY = 'probe:default'
  const main = document.getElementById('main')
  const count = document.getElementById('count')
  const crumb = document.getElementById('crumb')
  const keysbar = document.getElementById('keysbar')

  const PRESETS = {
    restrained: {
      label: 'Restrained',
      blurb: 'Quiet entrance. The page carries itself with spacing and type, not motion.',
      values: { motionMs: 200, motionPx: 8, rulePx: 1, imageScale: 1, ornament: 'none' },
    },
    expressive: {
      label: 'Expressive',
      blurb: 'A visible opening and one signature move. Still readable with motion off.',
      values: { motionMs: 520, motionPx: 24, rulePx: 2, imageScale: 1.03, ornament: 'margin-note' },
    },
  }

  const VALUE_LABEL = {
    density: { low: 'Airy', high: 'Dense' },
    chrome: { minimal: 'Minimal chrome', rich: 'Rich chrome' },
    spine: { chronological: 'Chronological', curated: 'Curated index' },
    opening: { image: 'Image first', statement: 'Statement first' },
    media: { 'captioned-grid': 'Captioned grid', 'bare-image': 'Bare images' },
    typeVoice: { expressive: 'Type as the page', quiet: 'Type as text' },
    recirculation: { archive: 'Full archive', curated: 'Curated shelf' },
    firstRung: { pinned: 'A start-here piece', newest: 'The newest post', featured: 'A featured project', intro: 'A short introduction' },
    archivePlace: { home: 'On the home page', 'own-page': 'Its own page', both: 'Both' },
    secondColumn: { now: 'Now / reading', photos: 'Photography', micro: 'Micro-posts', events: 'Events or talks', none: 'Nothing — keep it airy' },
    captionSource: { cms: 'A CMS field', alt: 'Alt text for now', manual: 'Written per post' },
    heroArt: { photo: 'My own photograph', existing: 'Existing artwork', commission: 'A commissioned illustration' },
    displayBudget: { one: 'One', two: 'Two', sections: 'One per section' },
    never: { carousel: 'No carousel', 'three-cards': 'No three equal cards', 'scroll-reveal': 'No scroll-triggered reveals', widgets: 'No sidebar widgets', fake: 'No fake metrics', none: 'Nothing else' },
  }

  let probe = null
  let state = null
  let draft = {}

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const human = (k, v) => (Array.isArray(v) ? v.map((x) => VALUE_LABEL[k]?.[x] ?? x).join(' + ') : VALUE_LABEL[k]?.[v] ?? String(v).replace(/-/g, ' '))
  const recFor = (q) => (Array.isArray(q.recommend) ? q.recommend : q.recommend ? [q.recommend] : [])
  const followed = (q, a) => {
    const ids = Array.isArray(a.value) ? a.value : [a.value]
    const r = recFor(q)
    return r.length > 0 && r.length === ids.length && r.every((x) => ids.includes(x))
  }
  const intakeMatches = (when) =>
    Object.entries(when ?? {}).every(([k, vals]) => {
      const a = state.answers[k]
      if (!a) return false
      const ids = Array.isArray(a.value) ? a.value : [a.value]
      return ids.some((x) => vals.includes(x))
    })
  const factsHTML = () => {
    const facts = (probe.facts ?? []).filter((f) => !f.when || intakeMatches(f.when))
    if (!facts.length) return ''
    return `<div class="facts"><h2>What I already know</h2><ul>${facts
      .map((f) => `<li>${esc(f.text)} <cite>— ${esc(f.source)}</cite></li>`)
      .join('')}</ul></div>`
  }

  fetch('/probe.json')
    .then((r) => { if (!r.ok) throw new Error('probe.json not found'); return r.json() })
    .then((d) => {
      probe = d
      const ui = probe.ui ?? {}
      if (ui.storageKey) KEY = ui.storageKey
      if (ui.title) document.title = ui.title
      const mark = document.querySelector('.bar .mark')
      if (mark && ui.mark) mark.textContent = ui.mark
      const note = document.getElementById('probe-note')
      if (note && ui.note) note.textContent = ui.note
      load()
      render()
    })
    .catch((e) => {
      main.innerHTML = `<p class="hint">Could not load the probe: ${esc(e.message)}. Build it first with <code>probe build --config …</code>, then reload.</p>`
    })

  /* --------------------------------------------------------------- state -- */

  function fresh() {
    return {
      probeId: probe.id,
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      phase: 'intake',
      intakeIndex: 0,
      pairQueue: [],
      pairIndex: 0,
      followupQueue: [],
      followupIndex: 0,
      answers: {},
      order: {},
      conflicts: [],
      resolved: {},
      tensionLog: [],
      confirmations: {},
      sampleMode: {},
      intensity: 'restrained',
      savedAt: null,
      revising: false,
      afterConflict: null,
      complete: false,
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY)
      state = raw ? JSON.parse(raw) : null
    } catch { state = null }
    if (!state || state.probeId !== probe.id) state = fresh()
    draft = {}
  }

  const persist = () => localStorage.setItem(KEY, JSON.stringify(state))
  const pairById = (id) => probe.pairs.find((p) => p.id === id)
  const optionById = (pair, id) => pair.options.find((o) => o.id === id)
  const intakeById = (id) => probe.intake.find((q) => q.id === id)
  const followupById = (id) => probe.followups.find((q) => q.id === id)

  /* ----------------------------------------------------------- conditions -- */

  function merge() {
    const out = {}
    for (const [id, a] of Object.entries(state.answers)) {
      if (a.kind === 'pair') {
        const pair = pairById(id)
        if (!pair || pair.mode === 'confirm' || state.sampleMode[id] || a.side === 'neither') continue
        const opt = optionById(pair, a.optionId)
        for (const [k, v] of Object.entries(opt?.constraints ?? {})) out[k] = v
      }
      if (a.kind === 'followup') {
        const q = followupById(id)
        if (!q) continue
        const ids = Array.isArray(a.value) ? a.value : [a.value]
        for (const oid of ids) {
          const opt = q.options.find((o) => o.id === oid)
          for (const [k, v] of Object.entries(opt?.constraint ?? {})) {
            if (q.type === 'multi') {
              if (Array.isArray(out[k])) {
                if (!out[k].includes(v)) out[k].push(v)
              } else if (out[k] !== undefined) out[k] = [out[k], v]
              else out[k] = [v]
            } else out[k] = v
          }
        }
        // "Nothing else" / "keep it airy" override the other multi choices.
        if (q.type === 'multi' && Array.isArray(out['never']) && out['never'].includes('none')) out['never'] = ['none']
        if (q.type === 'multi' && Array.isArray(out['secondColumn']) && out['secondColumn'].includes('none')) out['secondColumn'] = ['none']
      }
    }
    for (const [k, v] of Object.entries(state.resolved)) out[k] = v
    return out
  }

  function matches(when) {
    const c = merge()
    return Object.entries(when ?? {}).every(([k, vals]) => {
      const v = c[k]
      if (v === undefined) return false
      return Array.isArray(v) ? v.some((x) => vals.includes(x)) : vals.includes(v)
    })
  }

  function score(pair) {
    let s = pair.priority ?? 0
    for (const [id, a] of Object.entries(state.answers)) {
      if (a.kind !== 'intake') continue
      const q = intakeById(id)
      if (!q) continue
      const ids = Array.isArray(a.value) ? a.value : [a.value]
      for (const oid of ids) s += q.options.find((o) => o.id === oid)?.boosts?.[pair.axisKey ?? pair.id] ?? 0
    }
    return s
  }

  function originOf(key) {
    for (const [id, a] of Object.entries(state.answers)) {
      if (a.kind === 'pair' && a.side !== 'neither') {
        const pair = pairById(id)
        const opt = pair && optionById(pair, a.optionId)
        if (opt?.constraints?.[key] !== undefined) return pair.axis
      }
      if (a.kind === 'followup') {
        const q = followupById(id)
        const ids = Array.isArray(a.value) ? a.value : [a.value]
        for (const oid of ids) {
          if (q?.options.find((o) => o.id === oid)?.constraint?.[key] !== undefined) return q.label ?? 'Detail'
        }
      }
    }
    return 'earlier answer'
  }

  /* ---------------------------------------------------------------- route -- */

  function current() {
    if (state.phase === 'done') return { type: 'done' }
    if (state.conflicts.length) return { type: 'conflict', c: state.conflicts[0] }
    if (state.phase === 'intake') return { type: 'intake', q: probe.intake[state.intakeIndex] }
    if (state.phase === 'intake-close') return { type: 'close' }
    if (state.phase === 'pairs') return { type: 'pair', pair: pairById(state.pairQueue[state.pairIndex]) }
    if (state.phase === 'followups') return { type: 'followup', q: followupById(state.followupQueue[state.followupIndex]) }
    return { type: 'done' }
  }

  function render() {
    const node = current()
    if (node.type === 'done') return renderResult()
    if (node.type === 'conflict') return renderConflict(node.c)
    if (node.type === 'intake') return renderQuestion(node.q, 'intake')
    if (node.type === 'close') return renderClose()
    if (node.type === 'followup') return renderQuestion(node.q, 'followup')
    if (node.type === 'pair') return renderPair(node.pair)
    renderResult()
  }

  function chrome(section, step, showKeys = false) {
    crumb.textContent = section
    count.textContent = step ? `Step ${step}` : ''
    keysbar.hidden = !showKeys
  }

  function chipStrip() {
    const said = probe.intake
      .map((q) => {
        const a = state.answers[q.id]
        if (!a) return null
        const ids = Array.isArray(a.value) ? a.value : [a.value]
        const labels = ids.filter(Boolean).map((id) => q.options.find((o) => o.id === id)?.label ?? id)
        return labels.length ? `<li class="chip"><b>${esc(labels.join(' · '))}</b></li>` : null
      })
      .filter(Boolean)
      .slice(0, 4)
    const entries = Object.entries(merge()).slice(0, 6)
    const constraints = entries.map(([k, v]) => `<li class="chip">${esc(k)} <b>${esc(human(k, v))}</b></li>`)
    const all = [...said, ...constraints]
    if (!all.length) return ''
    return `<ul class="chips" aria-label="What is known so far">${all.join('')}</ul>`
  }

  /* ------------------------------------------------------------ questions -- */

  function renderQuestion(q, kind) {
    const total = kind === 'intake' ? probe.intake.length : state.followupQueue.length
    const index = kind === 'intake' ? state.intakeIndex : state.followupIndex
    const step = Object.keys(state.answers).length + 1
    chrome(kind === 'intake' ? 'Intake' : 'Detail', step)

    const selected = draft[q.id] ?? []
    const isMulti = q.type === 'multi'
    const max = q.max ?? (isMulti ? 99 : 1)
    const canContinue = selected.length > 0 || q.optional

    main.innerHTML = `
      <p class="axis">${kind === 'intake' ? 'Before images' : 'One detail'} · ${index + 1} / ${total}</p>
      <h1>${esc(q.question)}</h1>
      <p class="hint">${esc(q.help ?? '')}</p>
      ${kind === 'intake' && state.intakeIndex > 0 ? factsHTML() : ''}
      ${chipStrip()}
      <form data-form="question" data-kind="${kind}" data-id="${esc(q.id)}">
        <div class="options" role="${isMulti ? 'group' : 'radiogroup'}" aria-label="${esc(q.question)}">
          ${q.options
            .map((o, i) => {
              const on = selected.includes(o.id)
              const disabled = isMulti && !on && selected.length >= max
              return `
              <label class="opt" data-on="${on ? 1 : 0}" data-opt="${esc(o.id)}">
                <input type="${isMulti ? 'checkbox' : 'radio'}" name="opt" value="${esc(o.id)}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                <span><b>${esc(o.label)}${recFor(q).includes(o.id) ? '<span class="rec">Recommended</span>' : ''}</b>${o.note ? `<span>${esc(o.note)}</span>` : ''}</span>
                <span class="num" aria-hidden="true">${i + 1}</span>
              </label>`
            })
            .join('')}
        </div>
        ${recFor(q).length ? `<p class="fineprint" style="margin:-8px 0 16px">Recommended: <strong>${recFor(q).map((id) => q.options.find((o) => o.id === id)?.label).filter(Boolean).join(' + ')}</strong>${q.recommendWhy ? ` — ${esc(q.recommendWhy)}` : ''}</p>` : ''}
        <div class="cont">
          <button class="primary" type="submit" ${canContinue ? '' : 'disabled'}>Continue</button>
          ${isMulti && q.max ? `<span class="fineprint">Choose up to ${q.max}.</span>` : ''}
          ${kind === 'followup' ? `<button class="quiet" type="button" data-action="skip">Skip this</button><button class="quiet enough" type="button" data-action="enough">I've seen enough</button>` : ''}
        </div>
      </form>
    `
  }

  function readQuestion(form) {
    const kind = form.dataset.kind
    const id = form.dataset.id
    const values = [...form.querySelectorAll('input[name="opt"]:checked')].map((i) => i.value)
    return { kind, id, values }
  }

  function answerQuestion(kind, id, values) {
    const q = kind === 'intake' ? intakeById(id) : followupById(id)
    if (!values.length && !q?.optional) return
    const value = values.length > 1 ? values : values[0] ?? null
    if (kind === 'intake') {
      state.answers[id] = { kind: 'intake', value }
      delete draft[id]
      state.intakeIndex += 1
      if (state.intakeIndex >= probe.intake.length) state.phase = 'intake-close'
    } else {
      state.answers[id] = { kind: 'followup', value }
      detectConflicts(
        values.flatMap((v) => Object.entries(followupById(id).options.find((o) => o.id === v)?.constraint ?? {})),
        followupById(id).label ?? 'Detail',
      )
      state.followupIndex += 1
      if (state.followupIndex >= state.followupQueue.length) finish()
    }
    if (state.revising) finish()
    persist()
    render()
    window.scrollTo({ top: 0 })
  }

  function skipFollowup() {
    state.followupIndex += 1
    if (state.followupIndex >= state.followupQueue.length) finish()
    persist()
    render()
    window.scrollTo({ top: 0 })
  }

  function renderClose() {
    const close = probe.intakeClose ?? {
      question: 'Is this understanding shared?',
      help: 'The references are chosen from these answers.',
      yes: 'Show the references',
    }
    chrome('Intake', Object.keys(state.answers).length + 1)
    const rows = probe.intake
      .map((q) => {
        const a = state.answers[q.id]
        if (!a) return null
        const ids = Array.isArray(a.value) ? a.value : [a.value]
        const labels = ids.filter(Boolean).map((id) => q.options.find((o) => o.id === id)?.label ?? id)
        const r = recFor(q)
        const ok = followed(q, a)
        return `<tr>
          <td>${esc(q.question)}</td>
          <td>${esc(labels.join(' · ')) || '—'}</td>
          <td class="${r.length ? (ok ? 'yes' : 'no') : ''}">${r.length ? (ok ? 'followed' : 'overridden') : '—'}</td>
          <td><button class="quiet" type="button" data-action="reopen" data-id="${esc(q.id)}">reopen</button></td>
        </tr>`
      })
      .filter(Boolean)
      .join('')

    main.innerHTML = `
      <p class="axis">Intake · shared understanding</p>
      <h1>${esc(close.question)}</h1>
      <p class="hint">${esc(close.help)}</p>
      ${factsHTML()}
      <table class="tree">
        <thead><tr><th>Decision</th><th>Your answer</th><th>Recommendation</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="actions">
        <button class="primary" type="button" data-action="start-pairs">${esc(close.yes)}</button>
        <p class="fineprint" style="margin:0">Nothing is shown until you continue. Reopen any line that is wrong.</p>
      </div>
    `
  }

  /* ---------------------------------------------------------------- pairs -- */

  function startPairs() {
    const eligible = probe.pairs.filter((p) => p.mode !== 'confirm' && matches(p.when))
    const byAxis = new Map()
    for (const p of eligible) {
      if (!byAxis.has(p.axis)) byAxis.set(p.axis, [])
      byAxis.get(p.axis).push(p)
    }
    const axes = [...byAxis.keys()].sort(
      (a, b) => Math.max(...byAxis.get(b).map(score)) - Math.max(...byAxis.get(a).map(score)),
    )
    const used = new Set()
    const queue = []
    for (const axis of axes) {
      const ranked = byAxis
        .get(axis)
        .map((p) => ({ p, s: score(p) - (p.options.some((o) => used.has(o.source)) ? 30 : 0) }))
        .sort((a, b) => b.s - a.s)
      // Near-ties alternate between curated variants, so a new run does not
      // replay the same reference set.
      if (ranked.length > 1 && Math.abs(ranked[0].s - ranked[1].s) <= 6 && Math.random() < 0.5) {
        ;[ranked[0], ranked[1]] = [ranked[1], ranked[0]]
      }
      const pick = ranked[0].p
      queue.push(pick.id)
      pick.options.forEach((o) => used.add(o.source))
    }
    state.phase = 'pairs'
    state.pairQueue = queue
    state.pairIndex = 0
    if (!queue.length) return startFollowups()
  }

  function orderFor(pair) {
    if (!state.order[pair.id]) {
      state.order[pair.id] = Math.random() < 0.5 ? [0, 1] : [1, 0]
      persist()
    }
    return state.order[pair.id]
  }

  function optionAt(pair, side) {
    const [l, r] = orderFor(pair)
    return pair.options[side === 'left' ? l : r]
  }

  function renderPair(pair) {
    const step = Object.keys(state.answers).length + 1
    chrome(pair.mode === 'confirm' ? 'Confirmation' : 'References', step)
    const left = optionAt(pair, 'left')
    const right = optionAt(pair, 'right')
    const answeredPairs = Object.values(state.answers).filter((a) => a.kind === 'pair').length

    main.innerHTML = `
      <p class="axis">${esc(pair.axis)} · pair ${answeredPairs + 1}${pair.mode === 'confirm' ? ' · consistency check' : ''}</p>
      <h1>${esc(pair.question)}</h1>
      <p class="hint">${esc(pair.hint)}</p>
      ${chipStrip()}
      <div class="pair">
        ${card(left, 'left', 'A')}
        ${card(right, 'right', 'B')}
      </div>
      <div class="under">
        <button class="neither" data-action="neither" type="button">Neither of these</button>
        <p class="kbdhint">Judge one thing: <strong>${esc(pair.axis.toLowerCase())}</strong>.</p>
        <button class="quiet" type="button" data-action="enough" style="margin-left:auto">I've seen enough</button>
      </div>
      <form class="why" data-form="why" hidden>
        <label for="why">What is wrong with both? <span>optional, one line</span></label>
        <input id="why" name="why" maxlength="140" placeholder="e.g. both are too busy at the top" autocomplete="off">
        <div class="row">
          <button class="primary" type="submit">Record “neither”</button>
          <button class="quiet" type="button" data-action="cancel-why">Cancel</button>
        </div>
      </form>
    `
    preloadNext()
  }

  function card(o, side, letter) {
    const pos = o.focus === 'bottom' ? 'center bottom' : 'center top'
    const src = o.src ?? `/img/${o.id}${o.thumb ? '?thumb=1' : ''}`
    return `
      <button class="card" type="button" data-action="choose" data-side="${side}">
        <span class="frame"><img src="${src}" alt="${esc(o.alt)}" style="object-position:${pos}" draggable="false"></span>
        <span class="foot"><span class="key">${side === 'left' ? '←' : '→'}</span><b>${letter}</b> keep this one</span>
      </button>`
  }

  function preloadNext() {
    const nextId = state.pairQueue[state.pairIndex + 1]
    const next = nextId && pairById(nextId)
    if (!next) return
    for (const side of ['left', 'right']) {
      const o = optionAt(next, side)
      const img = new Image()
      img.src = o.src ?? `/img/${o.id}${o.thumb ? '?thumb=1' : ''}`
    }
  }

  function choose(side) {
    const node = current()
    if (node.type !== 'pair') return
    const pair = node.pair
    const option = optionAt(pair, side)
    const before = merge()

    const isCheck = pair.mode === 'confirm' || state.sampleMode[pair.id]
    if (isCheck) {
      const key = Object.keys(option.constraints)[0]
      const first = before[key]
      const consistent = first === option.constraints[key]
      state.confirmations[pair.axis] = { key, consistent, first, second: option.constraints[key], sample: state.sampleMode[pair.id] ? pair.id : null }
      if (!consistent) {
        state.conflicts.push({
          key,
          a: { value: first, label: human(key, first), source: 'Round 1' },
          b: { value: option.constraints[key], label: human(key, option.constraints[key]), source: 'Round 2' },
        })
      }
    } else {
      detectConflicts(Object.entries(option.constraints), pair.axis)
    }

    state.answers[pair.id] = { kind: 'pair', side, optionId: option.id, ms: Date.now() }
    const confirm = probe.pairs.find((p) => p.mode === 'confirm' && p.after === pair.id)
    if (!isCheck && confirm && !state.answers[confirm.id] && matches(confirm.when) && !state.pairQueue.includes(confirm.id)) {
      const usedSources = new Set(
        probe.pairs
          .filter((p) => state.answers[p.id] && state.answers[p.id].side !== 'neither')
          .flatMap((p) => p.options.filter((o) => o.id === state.answers[p.id].optionId).map((o) => o.source)),
      )
      usedSources.add(option.source)
      if (!confirm.options.some((o) => usedSources.has(o.source))) {
        state.pairQueue.splice(state.pairIndex + 1, 0, confirm.id)
      }
    }
    state.pairIndex += 1
    if (state.pairIndex >= state.pairQueue.length) startFollowups()
    if (state.revising) {
      if (state.conflicts.length) state.afterConflict = 'done'
      else finish()
    }
    persist()
    render()
    window.scrollTo({ top: 0 })
  }

  function neither(reason) {
    const node = current()
    if (node.type !== 'pair') return
    state.answers[node.pair.id] = { kind: 'pair', side: 'neither', reason: reason || '', ms: Date.now() }
    state.pairIndex += 1
    if (state.pairIndex >= state.pairQueue.length) startFollowups()
    if (state.revising) {
      if (state.conflicts.length) state.afterConflict = 'done'
      else finish()
    }
    persist()
    render()
    window.scrollTo({ top: 0 })
  }

  function detectConflicts(pairs, source = 'this answer') {
    const before = merge()
    for (const [k, v] of pairs) {
      if (before[k] === undefined) continue
      if (Array.isArray(before[k]) || Array.isArray(v)) continue
      if (JSON.stringify(before[k]) === JSON.stringify(v)) continue
      state.conflicts.push({
        key: k,
        a: { value: before[k], label: human(k, before[k]), source: originOf(k) },
        b: { value: v, label: human(k, v), source },
      })
    }
  }

  /* ------------------------------------------------------------- conflicts -- */

  function renderConflict(c) {
    const step = Object.keys(state.answers).length + 1
    chrome('Tension', step)
    main.innerHTML = `
      <p class="axis">Two answers disagree · ${esc(c.key)}</p>
      <h1>Which one is the rule?</h1>
      <p class="hint">A direction is a set of constraints, not a collage. Pick one; the other is recorded as rejected.</p>
      ${chipStrip()}
      <div class="tension">
        <p>You chose <strong>${esc(c.a.label)}</strong> in ${esc(c.a.source)} and <strong>${esc(c.b.label)}</strong> in ${esc(c.b.source)}.</p>
        <label><input type="radio" name="conflict" data-action="resolve" data-key="${esc(c.key)}" value="${esc(String(c.a.value))}"> ${esc(c.a.label)} <span style="color:var(--muted)">— ${esc(c.a.source)}</span></label>
        <label><input type="radio" name="conflict" data-action="resolve" data-key="${esc(c.key)}" value="${esc(String(c.b.value))}"> ${esc(c.b.label)} <span style="color:var(--muted)">— ${esc(c.b.source)}</span></label>
        <div class="cont" style="margin-top:12px">
          <button class="primary" type="button" data-action="resolve-continue" disabled>Continue</button>
          <button class="quiet" type="button" data-action="enough">I've seen enough</button>
        </div>
      </div>
    `
    main.querySelector('input[data-action="resolve"]')?.addEventListener('change', () => {
      const btn = main.querySelector('[data-action="resolve-continue"]')
      if (btn) btn.disabled = false
    })
  }

  function resolveConflict(valueRaw) {
    const c = state.conflicts[0]
    if (!c) return
    const value = Array.isArray(c.a.value) || Array.isArray(c.b.value)
      ? valueRaw.split(',').filter(Boolean)
      : valueRaw
    state.resolved[c.key] = value
    state.tensionLog.push({ key: c.key, a: c.a, b: c.b, winner: value })
    state.conflicts.shift()
    state.savedAt = null
    if (!state.conflicts.length && state.afterConflict === 'done') {
      state.afterConflict = null
      finish()
    }
    persist()
    render()
    window.scrollTo({ top: 0 })
  }

  /* -------------------------------------------------------------- details -- */

  function startFollowups() {
    const queue = probe.followups.filter((q) => !state.answers[q.id] && matches(q.when)).map((q) => q.id)
    state.phase = 'followups'
    state.followupQueue = queue
    state.followupIndex = 0
    if (!queue.length) finish()
  }

  function finish() {
    // A run cannot complete with an unresolved conflict. Defer until it is settled.
    if (state.conflicts.length) {
      state.afterConflict = 'done'
      state.revising = false
      persist()
      return
    }
    state.phase = 'done'
    state.complete = true
    state.completedAt = new Date().toISOString()
    state.revising = false
    // A revised answer can invalidate a detail; drop answers whose condition no longer holds.
    for (const q of probe.followups) {
      if (state.answers[q.id] && !matches(q.when)) delete state.answers[q.id]
    }
    persist()
  }

  function finishNow() {
    state.conflicts = []
    state.phase = 'done'
    state.complete = true
    state.completedAt = new Date().toISOString()
    state.revising = false
    persist()
    render()
    window.scrollTo({ top: 0 })
  }

  /* --------------------------------------------------------------- result -- */

  function chosenPairs() {
    return probe.pairs
      .filter((p) => p.mode !== 'confirm' && !state.sampleMode[p.id])
      .map((p) => ({ pair: p, a: state.answers[p.id] }))
      .filter((x) => x.a && x.a.kind === 'pair' && x.a.side !== 'neither')
      .map((x) => ({ pair: x.pair, option: effectiveOption(x.pair, x.a) }))
  }

  // If a conflict was resolved against the first answer, show the winning option,
  // not the one that was clicked first.
  function effectiveOption(pair, a) {
    let o = optionById(pair, a.optionId)
    for (const k of Object.keys(o.constraints ?? {})) {
      const r = state.resolved[k]
      if (r !== undefined && r !== o.constraints[k]) {
        const alt = pair.options.find((x) => x.constraints?.[k] === r)
        if (alt) o = alt
      }
    }
    return o
  }

  function avoided() {
    const out = []
    for (const p of probe.pairs) {
      if (p.mode === 'confirm') continue
      const a = state.answers[p.id]
      if (!a || a.kind !== 'pair' || a.side === 'neither') continue
      const rejected = p.options.find((o) => o.id !== a.optionId)
      if (rejected) out.push(`${rejected.avoid} (${p.axis.toLowerCase()})`)
    }
    const avoid = state.answers['avoidFeel']
    if (avoid) {
      const q = intakeById('avoidFeel')
      const ids = Array.isArray(avoid.value) ? avoid.value : [avoid.value]
      for (const id of ids) {
        const o = q.options.find((x) => x.id === id)
        if (o?.avoid) out.push(o.avoid)
      }
    }
    return out
  }

  function renderResult() {
    chrome('Result', null)
    keysbar.hidden = true

    const intakeRows = probe.intake
      .map((q) => {
        const a = state.answers[q.id]
        if (!a) return null
        const ids = Array.isArray(a.value) ? a.value : [a.value]
        const labels = ids.map((id) => q.options.find((o) => o.id === id)?.label ?? id)
        return `<div class="vrow"><span class="k">${esc(q.question)}</span><p>${esc(labels.join(' · '))}</p><span></span></div>`
      })
      .filter(Boolean)
      .join('')

    const pairRows = probe.pairs
      .filter((p) => p.mode !== 'confirm' && !state.sampleMode[p.id])
      .map((p) => {
        const a = state.answers[p.id]
        if (!a) return null
        if (a.side === 'neither') {
          return `<div class="vrow"><span class="k">${esc(p.axis)}</span><p class="none">No preference${a.reason ? ` — “${esc(a.reason)}”` : ''}</p><button class="quiet" data-action="revise" data-kind="pair" data-id="${esc(p.id)}">revise</button></div>`
        }
        const o = effectiveOption(p, a)
        const alt = probe.pairs.find((x) => x.axis === p.axis && x.id !== p.id && x.mode !== 'confirm' && !state.answers[x.id] && !state.sampleMode[x.id])
        return `<div class="vrow"><span class="k">${esc(p.axis)}</span><p>${esc(o.vocab)}</p><span style="display:flex;gap:14px">${alt ? `<button class="quiet" data-action="sample" data-id="${esc(p.id)}">try another pair</button>` : ''}<button class="quiet" data-action="revise" data-kind="pair" data-id="${esc(p.id)}">revise</button></span></div>`
      })
      .filter(Boolean)
      .join('')

    const consistency = Object.entries(state.confirmations)
      .filter(([, c]) => c)
      .map(([axis, c]) => {
        const key = c.key ?? Object.keys(probe.pairs.find((p) => p.mode === 'confirm' && p.axis === axis)?.options[0]?.constraints ?? {})[0]
        if (c.consistent) {
          return `<li><b>${esc(axis)}:</b> same answer on both pairs${key && c.first ? ` (${esc(human(key, c.first))})` : ''}.</li>`
        }
        const winner = state.resolved[key]
        return `<li><b>${esc(axis)}:</b> ${c.first ? esc(human(key, c.first)) : 'one answer'} on the first pair, ${c.second ? esc(human(key, c.second)) : 'the other'} on the second${winner ? ` → you resolved it to <strong>${esc(human(key, winner))}</strong>` : ''}.</li>`
      })
      .join('')

    const detailRows = probe.followups
      .map((q) => {
        const a = state.answers[q.id]
        if (!a) return null
        const ids = Array.isArray(a.value) ? a.value : [a.value]
        const labels = ids.map((id) => q.options.find((o) => o.id === id)?.label ?? id)
        return `<div class="vrow"><span class="k">${esc(q.whenLabel ?? 'Detail')}</span><p>${esc(labels.join(' · '))}</p><button class="quiet" data-action="revise" data-kind="followup" data-id="${esc(q.id)}">revise</button></div>`
      })
      .filter(Boolean)
      .join('')

    const tensions = state.tensionLog
      .map((t) => `<li><b>${esc(t.key)}:</b> ${esc(t.a.label)} (${esc(t.a.source)}) vs ${esc(t.b.label)} (${esc(t.b.source)}) → <strong>${esc(human(t.key, t.winner))}</strong> wins.</li>`)
      .join('')

    const avoidedList = avoided().map((a) => `<li>${esc(a)}</li>`).join('')
    const preset = PRESETS[state.intensity]
    const p = preset.values
    const unanswered = probe.pairs.filter((x) => x.mode !== 'confirm' && !state.answers[x.id])

    main.innerHTML = `
      <p class="axis">Result</p>
      <h1>Your direction, as constraints</h1>
      <p class="lede">${Object.keys(state.answers).length} decisions, read back as rules. Revise any line that is wrong — it is cheaper now than after the build.</p>

      ${intakeRows ? `<div class="block" style="margin-top:0"><h2>What you told me</h2><div class="vocab">${intakeRows}</div></div>` : ''}
      ${pairRows ? `<div class="block"><h2>What you chose</h2><div class="vocab">${pairRows}</div></div>` : ''}
      ${consistency ? `<div class="block"><h2>Consistency</h2><ul class="rules">${consistency}</ul></div>` : ''}
      ${detailRows ? `<div class="block"><h2>Details</h2><div class="vocab">${detailRows}</div></div>` : ''}

      ${avoidedList ? `<div class="block"><h2>Rules out</h2><ul class="rules">${avoidedList}</ul></div>` : ''}
      ${tensions ? `<div class="block"><h2>Tensions resolved</h2><ul class="rules">${tensions}</ul></div>` : ''}

      ${unanswered.length ? `<div class="block"><h2>Not probed</h2><p>${unanswered.map((x) => esc(x.axis)).join(' · ')} — no constraint from the references. The build should not invent one.</p></div>` : ''}

      <div class="block">
        <h2>Intensity</h2>
        <p>Not a label: it writes the values the build will use.</p>
        <div class="presets">
          ${Object.entries(PRESETS)
            .map(
              ([key, v]) => `
            <label class="preset">
              <input type="radio" name="intensity" value="${key}" data-action="intensity" ${state.intensity === key ? 'checked' : ''}>
              <b>${esc(v.label)}</b>
              <span>${esc(v.blurb)}</span>
              <code>${v.values.motionMs}ms · ${v.values.motionPx}px · ${v.values.rulePx}px rules · scale ${v.values.imageScale} · ${esc(v.values.ornament)}</code>
            </label>`,
            )
            .join('')}
        </div>
      </div>

      <div class="actions">
        <button class="primary" id="save" type="button" data-action="save">${state.savedAt ? 'Save again' : 'Save to disk'}</button>
        <p class="status" id="status" role="status">${state.savedAt ? 'Saved ' + esc(new Date(state.savedAt).toLocaleTimeString()) : ''}</p>
        <button class="quiet" type="button" data-action="reset">start over</button>
      </div>

      ${
        state.savedAt
          ? `<div class="sources">
              <h2>Sources</h2>
              <ul>${chosenPairs()
                .map(
                  ({ pair, option }) =>
                    `<li><span class="k">${esc(pair.axis)}</span><span>${esc(option.source)} — <a href="${esc(option.url)}" target="_blank" rel="noopener noreferrer">${esc(option.url.replace(/^https?:\/\//, ''))}</a></span></li>`,
                )
                .join('')}</ul>
              <p class="fineprint" style="margin-top:12px">Sources were hidden while choosing. Some captures carry their own wordmarks; that is the page, not a hint. Captures are historical: the live page may differ.</p>
            </div>`
          : `<p class="fineprint" style="margin-top:20px">Sources stay hidden until you save, so the names cannot pull the revision.</p>`
      }
    `
  }

  /* ---------------------------------------------------------------- save -- */

  function payload() {
    const presented = {}
    for (const p of probe.pairs) {
      if (!state.order[p.id]) continue
      const [l, r] = state.order[p.id]
      presented[p.id] = { left: p.options[l].id, right: p.options[r].id }
    }
    return {
      runId: state.runId,
      probeId: state.probeId,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      answers: state.answers,
      presented,
      constraints: merge(),
      resolved: state.resolved,
      tensionLog: state.tensionLog,
      confirmations: state.confirmations,
      sampleMode: state.sampleMode,
      intensity: { name: state.intensity, ...PRESETS[state.intensity].values },
      avoided: avoided(),
      unanswered: {
        pairs: (() => {
          const answeredAxes = new Set(
            probe.pairs
              .filter((p) => p.mode !== 'confirm' && !state.sampleMode[p.id] && state.answers[p.id])
              .map((p) => p.axisKey ?? p.id),
          )
          return probe.pairs
            .filter((p) => p.mode !== 'confirm' && !answeredAxes.has(p.axisKey ?? p.id))
            .map((p) => p.id)
        })(),
        followups: probe.followups.filter((q) => !state.answers[q.id] && matches(q.when)).map((q) => q.id),
      },
    }
  }

  async function saveAnswers() {
    const status = document.getElementById('status')
    const btn = document.getElementById('save')
    btn.disabled = true
    status.textContent = 'Saving…'
    status.dataset.ok = '0'
    try {
      const res = await fetch('/api/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'save failed')
      state.savedAt = new Date().toISOString()
      persist()
      renderResult()
      const after = document.getElementById('status')
      after.dataset.ok = '1'
      after.textContent = body.emitted
        ? 'Saved · spec generated (05-decision.md, build-spec.json)'
        : body.emitError
          ? `Saved, but the spec did not generate: ${body.emitError}`
          : 'Saved to data/answers.json'
    } catch (err) {
      status.textContent = 'Could not save: ' + err.message
      btn.disabled = false
    }
  }

  /* ------------------------------------------------------------- controls -- */

  main.addEventListener('change', (e) => {
    const input = e.target.closest('input[name="opt"]')
    if (input) {
      const form = input.closest('form')
      const q = form.dataset.kind === 'intake' ? intakeById(form.dataset.id) : followupById(form.dataset.id)
      const selected = [...form.querySelectorAll('input[name="opt"]:checked')].map((i) => i.value)
      draft[q.id] = selected
      const max = q.max ?? (q.type === 'multi' ? 99 : 1)
      form.querySelectorAll('.opt').forEach((label) => {
        const i = label.querySelector('input')
        label.dataset.on = i.checked ? '1' : '0'
        i.disabled = q.type === 'multi' && !i.checked && selected.length >= max
      })
      const btn = form.querySelector('button[type="submit"]')
      if (btn) btn.disabled = selected.length === 0 && !q.optional
      return
    }

    const res = e.target.closest('input[data-action="resolve"]')
    if (res) {
      const btn = main.querySelector('[data-action="resolve-continue"]')
      if (btn) btn.disabled = false
    }
  })

  main.addEventListener('submit', (e) => {
    if (e.target.dataset.form === 'why') {
      e.preventDefault()
      neither(new FormData(e.target).get('why')?.toString().trim() ?? '')
      return
    }
    if (e.target.dataset.form !== 'question') return
    e.preventDefault()
    const { kind, id, values } = readQuestion(e.target)
    answerQuestion(kind, id, values)
  })

  main.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]')
    if (!el) return
    const action = el.dataset.action

    if (action === 'choose') return choose(el.dataset.side)
    if (action === 'neither') {
      const form = main.querySelector('[data-form="why"]')
      form.hidden = false
      form.querySelector('input').focus()
      return
    }
    if (action === 'cancel-why') { main.querySelector('[data-form="why"]').hidden = true; return }
    if (action === 'enough') return finishNow()
    if (action === 'start-pairs') {
      state.phase = 'pairs'
      startPairs()
      persist()
      render()
      window.scrollTo({ top: 0 })
      return
    }
    if (action === 'reopen') {
      const i = probe.intake.findIndex((q) => q.id === el.dataset.id)
      if (i < 0) return
      for (const q of probe.intake.slice(i)) delete state.answers[q.id]
      state.phase = 'intake'
      state.intakeIndex = i
      persist()
      render()
      window.scrollTo({ top: 0 })
      return
    }
    if (action === 'skip') return skipFollowup()
    if (action === 'save') return saveAnswers()

    if (action === 'resolve-continue') {
      const chosen = main.querySelector('input[data-action="resolve"]:checked')
      if (chosen) resolveConflict(chosen.value)
      return
    }

    if (action === 'intensity') {
      const wasSaved = !!state.savedAt
      state.intensity = el.value
      state.savedAt = null
      persist()
      if (wasSaved) renderResult()
      return
    }

    if (action === 'sample') {
      const base = pairById(el.dataset.id)
      const alt = probe.pairs.find((x) => x.axis === base.axis && x.id !== base.id && x.mode !== 'confirm' && !state.answers[x.id] && !state.sampleMode[x.id])
      if (!alt) return
      state.sampleMode[alt.id] = true
      state.savedAt = null
      if (!state.pairQueue.includes(alt.id)) state.pairQueue.push(alt.id)
      state.phase = 'pairs'
      state.pairIndex = state.pairQueue.indexOf(alt.id)
      state.revising = true
      persist()
      render()
      window.scrollTo({ top: 0 })
      return
    }

    if (action === 'revise') {
      const kind = el.dataset.kind
      const id = el.dataset.id
      state.savedAt = null
      state.revising = true
      delete state.answers[id]
      if (kind === 'pair') {
        const pair = pairById(id)
        if (!state.pairQueue.includes(id)) state.pairQueue.push(id)
        state.phase = 'pairs'
        state.pairIndex = state.pairQueue.indexOf(id)
        if (pair?.mode === 'confirm') state.confirmations[pair.axis] = undefined
        else {
          const conf = probe.pairs.find((p) => p.mode === 'confirm' && p.after === id)
          if (conf) { delete state.answers[conf.id]; delete state.confirmations[conf.axis] }
        }
      } else {
        if (!state.followupQueue.includes(id)) state.followupQueue.push(id)
        state.phase = 'followups'
        state.followupIndex = state.followupQueue.indexOf(id)
      }
      persist()
      render()
      window.scrollTo({ top: 0 })
      return
    }

    if (action === 'reset') {
      if (!confirm('Start over? This clears the answers on this machine.')) return
      localStorage.removeItem(KEY)
      state = fresh()
      draft = {}
      persist()
      render()
    }
  })

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
    const node = current()

    if (typing) {
      if (e.key === 'Escape') {
        const form = main.querySelector('[data-form="why"]')
        if (form) { form.hidden = true; document.activeElement.blur() }
      }
      return
    }

    if (node.type === 'pair') {
      if (e.key === 'ArrowLeft') { e.preventDefault(); choose('left') }
      else if (e.key === 'ArrowRight') { e.preventDefault(); choose('right') }
      else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const form = main.querySelector('[data-form="why"]')
        if (form) { form.hidden = false; form.querySelector('input').focus() }
      }
    }

    if (node.type === 'conflict') {
      const inputs = [...main.querySelectorAll('input[data-action="resolve"]')]
      const n = Number(e.key)
      if (n >= 1 && n <= inputs.length) {
        inputs[n - 1].checked = true
        inputs[n - 1].dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (e.key === 'Enter') {
        const btn = main.querySelector('[data-action="resolve-continue"]')
        if (btn && !btn.disabled) btn.click()
      }
    }

    if (node.type === 'intake' || node.type === 'followup') {
      const form = main.querySelector('form[data-form="question"]')
      if (!form) return
      const inputs = [...form.querySelectorAll('input[name="opt"]')]
      const n = Number(e.key)
      if (n >= 1 && n <= inputs.length) {
        const input = inputs[n - 1]
        if (input.disabled) return
        if (input.type === 'radio') {
          input.checked = true
          input.dispatchEvent(new Event('change', { bubbles: true }))
        } else {
          input.click()
        }
      }
      if (e.key === 'Enter' && !e.metaKey) {
        const btn = form.querySelector('button[type="submit"]')
        if (btn && !btn.disabled) { e.preventDefault(); form.requestSubmit() }
      }
    }
  })
})()
