/* Brand interview — one question at a time. Vanilla JS, no build step. */
(() => {
  'use strict'

  const $ = (sel) => document.querySelector(sel)
  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue
      if (k === 'class') node.className = v
      else if (k === 'html') node.innerHTML = v
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
      else node.setAttribute(k, v)
    }
    for (const kid of kids.flat()) if (kid != null) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
    return node
  }
  /**
   * Heal values arriving from storage or old tabs: a literal "null" string,
   * an empty object, or a blank-es-only array is no value at all.
   */
  function heal(slot) {
    if (!slot || typeof slot !== 'object') return slot
    if (typeof slot.value === 'string' && /^\s*null\s*$/i.test(slot.value)) slot.value = null
    if (Array.isArray(slot.value) && slot.value.every((x) => /^\s*null\s*$/i.test(String(x)))) slot.value = slot.value.filter((x) => !/^\s*null\s*$/i.test(String(x)))
    return slot
  }

  let config = null
  let answers = {}
  let index = 0
  let reviewing = false
  let saveTimer = null
  let dirty = false

  const hasValue = (v) => {
    if (v == null) return false
    if (Array.isArray(v)) return v.filter((x) => String(x).trim()).length > 0
    if (typeof v === 'object') return Object.values(v).some(hasValue)
    return String(v).trim().length > 0
  }
  const statusOf = (id) => {
    const a = answers[id] ?? {}
    return a.status || (hasValue(a.value) ? 'assumption' : 'tbc')
  }
  const answeredCount = () => config.questions.filter((q) => hasValue(answers[q.id]?.value)).length

  /* ------------------------------------------------------------- load -- */

  Promise.all([
    fetch('/brand.config.json').then((r) => r.json()),
    fetch('/api/answers').then((r) => r.json()),
  ])
    .then(([cfg, saved]) => {
      config = cfg
      answers = saved.answers ?? {}
      for (const slot of Object.values(answers)) heal(slot)
      document.title = config.title || 'Brand interview'
      $('#title').textContent = config.title || 'Brand interview'
      render()
    })
    .catch((error) => {
      $('#main').innerHTML = `<p class="help">Could not load the interview: ${esc(error.message)}. Start it with <code>node probe.mjs brand serve</code>.</p>`
    })

  /* ------------------------------------------------------------ saving -- */

  function scheduleSave() {
    dirty = true
    $('#save').textContent = 'unsaved'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 700)
  }

  async function save() {
    try {
      for (const slot of Object.values(answers)) heal(slot)
      const res = await fetch('/api/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      if (!res.ok) throw new Error('save failed')
      dirty = false
      $('#save').textContent = 'saved'
    } catch (error) {
      $('#save').textContent = 'could not save'
    }
  }

  const answer = (id) => {
    if (!answers[id]) answers[id] = { value: null, status: null, source: null }
    return answers[id]
  }

  /* ------------------------------------------------------------ render -- */

  function render() {
    renderSections()
    const total = config.questions.length
    const done = answeredCount()
    $('#pbar').style.width = `${Math.round((done / total) * 100)}%`
    $('#pbar').parentElement.setAttribute('aria-valuenow', String(Math.round((done / total) * 100)))
    if (reviewing) return renderReview()
    return renderQuestion()
  }

  function renderSections() {
    const list = $('#sections')
    list.innerHTML = ''
    for (const section of config.sections) {
      const qs = config.questions.filter((q) => q.section === section.id)
      if (!qs.length) continue
      const done = qs.filter((q) => hasValue(answers[q.id]?.value)).length
      const active = !reviewing && config.questions[index]?.section === section.id
      list.append(
        el('li', {},
          el('button', {
            type: 'button',
            'aria-current': active ? 'true' : 'false',
            onclick: () => {
              const first = config.questions.findIndex((q) => q.section === section.id)
              if (first >= 0) {
                index = first
                reviewing = false
                render()
              }
            },
          }, el('span', {}, section.title), el('small', {}, `${done}/${qs.length}`)),
        ),
      )
    }
    list.append(
      el('li', {},
        el('button', {
          type: 'button',
          'aria-current': reviewing ? 'true' : 'false',
          onclick: () => { reviewing = true; render() },
        }, el('span', {}, 'Review'), el('small', {}, `${answeredCount()}/${config.questions.length}`)),
      ),
    )
  }

  let fontsLoaded = false
  function loadGoogleFonts() {
    if (fontsLoaded) return
    fontsLoaded = true
    const families = []
    for (const pair of config.fontPairings ?? []) {
      for (const role of ['display', 'body', 'ui']) {
        const f = pair[role]
        if (f) families.push(`family=${encodeURIComponent(f.family).replace(/%20/g, '+')}:wght@${f.weights ?? '400'}`)
      }
    }
    if (!families.length) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?${[...new Set(families)].join('&')}&display=swap`
    document.head.append(link)
  }

  function fontPairings() {
    const pairs = config.fontPairings ?? []
    if (!pairs.length) return null
    loadGoogleFonts()
    const current = String(answers['v3-display']?.value ?? '')
    const wrap = el('div', { class: 'pairings' },
      el('p', { class: 'qhead' }, 'Choose a pairing', el('span', {}, ' — or keep your own faces below')),
      el('p', { class: 'help' }, 'Suggestions are OFL families rendered live. Picking one fills display, body and UI; you can still edit them.'),
    )
    const grid = el('div', { class: 'pairgrid' })
    for (const pair of pairs) {
      const chosen = current.startsWith(pair.display.family)
      const card = el('button', {
        type: 'button',
        class: `paircard${chosen ? ' chosen' : ''}`,
        'aria-pressed': chosen ? 'true' : 'false',
        onclick: () => {
          const note = `chosen in the brand interview: ${pair.name}`
          answers['v3-display'] = { value: `${pair.display.family} — display, 48–96px, ${pair.licence}`, status: 'assumption', source: note }
          answers['v3-body'] = { value: `${pair.body.family} — 18px/1.6, 62–68ch, ${pair.licence}`, status: 'assumption', source: note }
          answers['v3-ui'] = { value: `${pair.ui.family} — nav, labels, buttons, ${pair.licence}`, status: 'assumption', source: note }
          scheduleSave()
          render()
        },
      },
        el('span', { class: 'pairname' }, pair.name, chosen ? ' · chosen' : ''),
        el('span', { class: 'spec-display', style: `font-family:'${pair.display.family}', Georgia, serif` }, 'Stories, pixels & warm places.'),
        el('span', { class: 'spec-body', style: `font-family:'${pair.body.family}', Georgia, serif` }, 'A quiet place to read something made by hand. The body carries the page while the display earns the first glance.'),
        el('span', { class: 'spec-ui', style: `font-family:'${pair.ui.family}', system-ui, sans-serif` }, 'Writing · Photos · Now · Uses'),
        el('span', { class: 'pairwhy' }, pair.rationale),
      )
      grid.append(card)
    }
    wrap.append(grid)
    wrap.append(libraryFonts())
    return wrap
  }

  const FONT_FORMAT = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' }

  function fontFaceRule(specimen) {
    const family = `EagleFont-${specimen.id}`
    const format = FONT_FORMAT[specimen.ext] ?? 'woff2'
    return { family, css: `@font-face { font-family: '${family}'; src: url('/api/font/${specimen.id}?ext=${specimen.ext}') format('${format}'); }` }
  }

  function libraryFonts() {
    const box = el('div', { class: 'lib', id: 'lib-fonts' }, el('p', { class: 'qhead' }, 'From your library', el('span', {}, ' — Eagle fonts')))
    fetch('/api/fonts')
      .then((r) => r.json())
      .then((data) => {
        const list = data.specimens ?? []
        if (!list.length) {
          box.append(el('p', { class: 'help' }, 'None indexed yet. Run: probe fonts --project .'))
          return
        }
        const grid = el('div', { class: 'libgrid' })
        const style = el('style')
        document.head.append(style)
        for (const s of list.slice(0, 24)) {
          const { family, css } = fontFaceRule(s)
          style.append(document.createTextNode(css))
          grid.append(
            el('button', {
              type: 'button', class: 'libcard', title: 'Use this name in the display field',
              onclick: () => {
                answers['v3-display'] = { value: `${s.name} — from an Eagle font file (${s.ext})`, status: 'assumption', source: `Eagle item ${s.id}` }
                scheduleSave()
                render()
              },
            },
              s.image
                ? el('img', { src: `/${s.image}`, alt: s.name, loading: 'lazy' })
                : el('b', { class: 'fontpreview', style: `font-family:'${family}'` }, String(s.name ?? '').slice(0, 1).toUpperCase()),
              el('span', {}, s.name),
            ),
          )
        }
        box.append(grid)
      })
      .catch(() => box.append(el('p', { class: 'help' }, 'Could not read the specimen index.')))
    return box
  }

  function renderQuestion() {
    const q = config.questions[index]
    const section = config.sections.find((s) => s.id === q.section)
    const a = answer(q.id)
    const main = $('#main')
    main.innerHTML = ''

    main.append(
      el('p', { class: 'qhead' }, section?.title ?? '', el('span', {}, ` · ${index + 1} of ${config.questions.length}`)),
      el('h2', {}, q.question),
      q.help ? el('p', { class: 'help' }, q.help) : null,
      q.why ? el('p', { class: 'why' }, el('strong', {}, 'Why this question: '), q.why) : null,
      q.example ? el('p', { class: 'why' }, el('strong', {}, 'What a good answer looks like: '), q.example) : null,
      q.tbcHint ? el('p', { class: 'tbchint' }, q.tbcHint) : null,
    )

    const field = el('div', { class: 'field' })
    if (q.id === 'v3-display') field.append(fontPairings())
    field.append(inputFor(q, a))
    field.append(aiHelpRow(q))
    field.append(statusChips(q, a))
    field.append(
      el('div', { class: 'source' },
        el('label', { for: `src-${q.id}` }, 'Source for this answer — a file, a URL, a conversation'),
        el('input', {
          type: 'text', id: `src-${q.id}`, value: a.source ?? '',
          placeholder: 'e.g. design.md, https://example.com/, call on 14 Oct',
          oninput: (e) => { answer(q.id).source = e.target.value; scheduleSave() },
        }),
      ),
    )

    const last = index === config.questions.length - 1
    const nav = el('div', { class: 'nav' },
      el('button', { class: 'btn', type: 'button', disabled: index === 0, onclick: () => go(index - 1) }, 'Back'),
      el('div', { class: 'row' },
        el('button', {
          class: 'skip', type: 'button',
          onclick: () => { answer(q.id).status = 'tbc'; if (q.type === 'list') answer(q.id).value = []; else if (q.type !== 'dials') answer(q.id).value = null; scheduleSave(); go(index + 1) },
        }, 'Mark TBC'),
        el('button', { class: `btn ${last ? 'primary' : ''}`, type: 'button', onclick: () => (last ? (reviewing = true, render()) : go(index + 1)) }, last ? 'Review' : 'Next'),
      ),
    )
    main.append(field, nav)
    const input = field.querySelector('input[type=text], textarea, input[type=radio], select')
    if (input) input.focus({ preventScroll: true })
  }

  function go(next) {
    index = Math.max(0, Math.min(config.questions.length - 1, next))
    render()
  }

  function inputFor(q, a) {
    const value = a.value
    if (q.type === 'long') {
      return el('textarea', {
        id: `q-${q.id}`, placeholder: q.placeholder ?? '',
        oninput: (e) => { a.value = e.target.value; scheduleSave() },
      }, value ?? '')
    }
    if (q.type === 'list') {
      const text = Array.isArray(value) ? value.join('\n') : value ?? ''
      return el('textarea', {
        id: `q-${q.id}`, placeholder: q.placeholder ?? 'One per line',
        oninput: (e) => { a.value = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); scheduleSave() },
      }, text)
    }
    if (q.type === 'single') {
      const wrap = el('div', { class: 'row', role: 'radiogroup', 'aria-label': q.question })
      for (const opt of q.options ?? []) {
        wrap.append(
          el('label', { class: 'chip' },
            el('input', {
              type: 'radio', name: `q-${q.id}`, value: opt.id, checked: value === opt.id,
              onchange: () => { a.value = opt.id; scheduleSave() },
            }),
            el('span', {}, opt.label),
          ),
        )
      }
      return wrap
    }
    if (q.type === 'dials') {
      const table = el('table', { class: 'dials' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Dial'), el('th', {}, 'Now'), el('th', {}, 'Target'))),
      )
      const body = el('tbody')
      for (const dial of q.dials ?? []) {
        const current = value?.[dial.id]?.current ?? ''
        const target = value?.[dial.id]?.target ?? ''
        const select = (which, chosen) => {
          const s = el('select', {
            onchange: (e) => {
              const next = { ...(a.value ?? {}) }
              next[dial.id] = { ...(next[dial.id] ?? {}), [which]: e.target.value ? Number(e.target.value) : null }
              a.value = next
              scheduleSave()
            },
          }, el('option', { value: '' }, '—'))
          for (let n = 1; n <= 5; n += 1) {
            const o = el('option', { value: String(n) }, String(n))
            if (String(chosen) === String(n)) o.selected = true
            s.append(o)
          }
          return s
        }
        body.append(el('tr', {}, el('td', {}, dial.label), el('td', {}, select('current', current)), el('td', {}, select('target', target))))
      }
      table.append(body)
      return table
    }
    if (q.type === 'owner') {
      // Stored shape is "Name — YYYY-MM-DD"; split for two inputs, join back.
      const m = String(value ?? '').match(/^(.*?)\s*[—–-]\s*(\d{4}-\d{2}-\d{2})\s*$/)
      let name = m ? m[1].trim() : String(value ?? '').trim()
      const dateInput = el('input', {
        type: 'date', value: m ? m[2] : '', 'aria-label': 'Last verified date',
        onchange: commit,
      })
      const nameInput = el('input', {
        type: 'text', id: `q-${q.id}`, value: name, placeholder: 'Name',
        oninput: (e) => { name = e.target.value.trim(); commit() },
      })
      const wrap = el('div', { class: 'row' })
      wrap.append(
        nameInput,
        el('span', { class: 'mini' }, 'Last verified'),
        dateInput,
        el('button', {
          class: 'btn', type: 'button', title: 'Set the date to today',
          onclick: () => {
            // en-CA renders the local date as YYYY-MM-DD
            dateInput.value = new Date().toLocaleDateString('en-CA')
            dateInput.dispatchEvent(new Event('change'))
          },
        }, 'Today'),
      )
      return wrap

      function commit() {
        a.value = [name, dateInput.value].filter(Boolean).join(' — ')
        scheduleSave()
      }
    }
    if (q.type === 'colour') {
      const wrap = el('div', { class: 'row' })
      const swatch = el('span', { class: 'swatch', style: `background:${/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : 'transparent'}` })
      wrap.append(
        el('input', {
          type: 'text', id: `q-${q.id}`, value: value ?? '', placeholder: q.placeholder ?? '#faf0e6',
          style: 'flex:1;min-width:180px',
          oninput: (e) => {
            a.value = e.target.value
            swatch.style.background = /^#[0-9a-f]{6}$/i.test(e.target.value) ? e.target.value : 'transparent'
            scheduleSave()
          },
        }),
        swatch,
      )
      return wrap
    }
    return el('input', {
      type: 'text', id: `q-${q.id}`, value: value ?? '', placeholder: q.placeholder ?? '',
      oninput: (e) => { a.value = e.target.value; scheduleSave() },
    })
  }

  function aiHelpRow(q) {
    // AI drafts are never verified: the record's honesty rules stay intact.
    const row = el('div', { class: 'airow' })
    const btn = el('button', { class: 'btn ghost', type: 'button' }, 'AI help')
    const note = el('span', { class: 'ainote' }, 'draft from answers so far — verify before use')
    btn.addEventListener('click', async () => {
      const a = answer(q.id)
      if (a.value != null && !window.confirm(`Replace your answer with an AI draft? (Current: "${
        Array.isArray(a.value) ? a.value.join('; ') : typeof a.value === 'object' ? '(dials)' : String(a.value)
      }")`)) return
      btn.disabled = true
      btn.textContent = 'Drafting…'
      try {
        const res = await fetch('/api/ai-help', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: q.id, type: q.type }),
        })
        const finisher = await res.json()
        if (!res.ok) throw new Error(finisher.error ?? finisher.message ?? String(finisher))
        if (!finisher.draft) throw new Error('Empty draft')
        answers[q.id] = { value: finisher.draft, status: 'assumption', source: 'AI draft — replace with the real answer' }
        dirty = true
        scheduleSave()
        render()
      } catch (error) {
        btn.textContent = 'AI help'
        btn.disabled = false
        note.textContent = error.message.slice(0, 160)
      }
    })
    row.append(btn, note)
    return row
  }

  function statusChips(q, a) {
    const set = el('fieldset', { class: 'chips' }, el('legend', {}, 'Status'))
    for (const [id, label, hint] of [
      ['verified', 'Verified', 'You read it in a source'],
      ['assumption', 'Assumption', 'Your belief, not yet sourced'],
      ['tbc', 'TBC', 'Not known yet'],
    ]) {
      set.append(
        el('label', { class: 'chip', title: hint },
          el('input', {
            type: 'radio', name: `status-${q.id}`, value: id, checked: statusOf(q.id) === id,
            onchange: () => { answer(q.id).status = id; scheduleSave() },
          }),
          el('span', {}, label),
        ),
      )
    }
    return set
  }

  /* ------------------------------------------------------------ review -- */

  function renderReview() {
    const main = $('#main')
    main.innerHTML = ''
    main.className = 'review'
    main.append(el('h2', {}, 'Review'), el('p', { class: 'help' }, 'Every slot with its status. Click one to change it. Then generate the document.'))

    for (const section of config.sections) {
      const qs = config.questions.filter((q) => q.section === section.id)
      if (!qs.length) continue
      main.append(el('h3', {}, section.title))
      const ul = el('ul')
      for (const q of qs) {
        const status = statusOf(q.id)
        ul.append(
          el('li', {},
            el('span', { class: `dot ${status}`, title: status }),
            el('button', {
              type: 'button',
              onclick: () => {
                index = config.questions.findIndex((x) => x.id === q.id)
                reviewing = false
                main.className = ''
                render()
              },
            }, q.label),
            el('span', { class: 'status' }, status),
          ),
        )
      }
      main.append(ul)
    }

    const checks = el('div', { class: 'checks' },
      el('h3', {}, 'Checks'),
      el('div', { id: 'contrast-check' }, el('p', { class: 'help' }, 'Checking contrast…')),
      el('div', { id: 'font-check' }, el('p', { class: 'help' }, 'Checking type…')),
    )
    main.append(checks)
    loadChecks()

    const out = el('div', { class: 'out' }, el('pre', { id: 'emit-out' }))
    const button = el('button', {
      class: 'btn primary', type: 'button',
      onclick: async () => {
        button.disabled = true
        button.textContent = 'Generating…'
        try {
          await save()
          const res = await fetch('/api/emit', { method: 'POST' })
          const body = await res.json()
          out.style.display = 'block'
          $('#emit-out').textContent = [body.out, body.err].filter(Boolean).join('\n') || (body.ok ? 'written' : 'failed')
          if (body.ok) {
            out.append(el('p', {}, el('a', { href: '/brand.md', target: '_blank', rel: 'noreferrer' }, 'Open brand.md')))
          }
        } catch (error) {
          out.style.display = 'block'
          $('#emit-out').textContent = String(error.message || error)
        } finally {
          button.disabled = false
          button.textContent = 'Generate brand.md'
        }
      },
    }, 'Generate brand.md')

    main.append(el('div', { class: 'nav' },
      el('button', { class: 'btn', type: 'button', onclick: () => { reviewing = false; index = 0; render() } }, 'Back to questions'),
      button,
    ), out)
  }

  /* ----------------------------------------------------------- checks --- */

  function loadChecks() {
    fetch('/api/contrast').then((r) => r.json()).then((data) => {
      const box = document.getElementById('contrast-check')
      if (!box) return
      const pairs = data.pairs ?? []
      if (!pairs.length) {
        box.innerHTML = '<h4>Contrast</h4><p class="help">No colour pairs yet — fill paper, ink, accent and surface.</p>'
        return
      }
      const rows = pairs.map((p) =>
        `<tr><td>${esc(p.label)}</td><td>${esc(p.fg)} on ${esc(p.bg)}</td><td>${p.ratio}:1</td><td>${p.min}:1</td><td class="${p.passes ? 'ok' : 'bad'}">${p.passes ? 'pass' : 'FAIL'}</td></tr>`,
      ).join('')
      box.innerHTML = `<h4>Contrast</h4><table class="checktable"><thead><tr><th>Pair</th><th>Colours</th><th>Ratio</th><th>Req</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`
    }).catch(() => {})

    fetch('/api/font-check').then((r) => r.json()).then((data) => {
      const box = document.getElementById('font-check')
      if (!box) return
      const results = data.results ?? []
      if (!results.length) {
        box.innerHTML = '<h4>Type</h4><p class="help">Not checked yet. Run: <code>probe fonts validate --project .</code></p>'
        return
      }
      const rows = results.map((r) =>
        `<tr><td>${esc(r.role)}</td><td>${esc(r.family)}</td><td>${esc(r.verdict)}</td><td>${esc(r.note ?? '')}</td></tr>`,
      ).join('')
      box.innerHTML = `<h4>Type</h4><table class="checktable"><thead><tr><th>Role</th><th>Family</th><th>Verdict</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`
    }).catch(() => {})
  }

  /* ------------------------------------------------------------ keys --- */

  document.addEventListener('keydown', (event) => {
    if (reviewing) return
    const target = event.target
    const inTextField = target instanceof HTMLTextAreaElement
    if (event.key === 'Enter' && !inTextField && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      if (index === config.questions.length - 1) { reviewing = true; render() } else go(index + 1)
    }
  })

  window.addEventListener('beforeunload', (event) => {
    if (dirty) {
      save()
      event.preventDefault()
      event.returnValue = ''
    }
  })
})()
