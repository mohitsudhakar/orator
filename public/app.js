/**
 * ORATOR client app.
 *
 * Views: dashboard | module | studio (live voice coach) | tutor | scenarios
 * No framework - plain ES modules and DOM. Keeps the payload small and the
 * behaviour explicit, which matters for a tool that has to feel instant.
 */

/* ------------------------------------------------------------------ */
/* Tiny helpers                                                        */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* non-json error body */ }
    throw new Error(msg);
  }
  return res.json();
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3800);
}

/** Minimal markdown -> HTML for tutor output. */
function md(src) {
  let s = escapeHtml(src || '');
  s = s.replace(/```([\s\S]*?)```/g, (m, c) => `<pre><code>${c.trim()}</code></pre>`);
  s = s.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  s = s.replace(/^##\s+(.*)$/gm, '<h3>$1</h3>');
  s = s.replace(/^#\s+(.*)$/gm, '<h3>$1</h3>');
  s = s.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[\s\S]*?<\/li>)(?![\s\S]*<li>)/, '<ul>$1</ul>');
  s = s.replace(/\n{2,}/g, '</p><p>');
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/<p>/g, '').replace(/<\/p>/g, '');
  s = s.replace(/<ul>\s*<\/ul>/g, '');
  return `<p>${s}</p>`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const fmtDur = (sec) => {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/* ------------------------------------------------------------------ */
/* App state                                                           */
/* ------------------------------------------------------------------ */

const state = {
  view: 'dashboard',
  catalogue: [],
  moduleId: null,
  module: null,
  progress: {},
  stats: {},
  streak: 0,
  voices: [],
  defaultVoice: 'Puck',
  tab: 'concepts',
  expanded: new Set(),
};

/* ------------------------------------------------------------------ */
/* Sidebar + routing                                                   */
/* ------------------------------------------------------------------ */

function renderSidebar() {
  const nav = $('#nav');
  const items = [
    { id: 'dashboard', ico: '◧', label: 'Dashboard' },
    { id: 'studio', ico: '◉', label: 'Live Coach Studio' },
    { id: 'tutor', ico: '◆', label: 'Ask the Tutor' },
  ];
  nav.innerHTML = '';
  items.forEach(i => {
    nav.appendChild(el('button', {
      class: `nav-item ${state.view === i.id ? 'active' : ''}`,
      onclick: () => navigate(i.id),
    }, el('span', { class: 'ico' }, i.ico), el('span', {}, i.label)));
  });

  nav.appendChild(el('div', { class: 'nav-sep' }, 'Curriculum'));
  state.catalogue.forEach(m => {
    const p = state.progress[m.id]?.percent || 0;
    nav.appendChild(el('button', {
      class: `nav-item ${state.view === 'module' && state.moduleId === m.id ? 'active' : ''}`,
      onclick: () => navigate('module', m.id),
    },
      el('span', { class: 'ico', style: { color: p >= 100 ? 'var(--green)' : 'var(--fg-3)' } }, p >= 100 ? '✓' : String(m.number).padStart(2, '0')),
      el('span', { style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.title.split(':')[0]),
    ));
  });
}

async function navigate(view, arg) {
  state.view = view;
  if (view === 'module') {
    state.moduleId = arg;
    await loadModule(arg);
  }
  renderSidebar();
  render();
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function viewDashboard() {
  const s = state.stats;
  const wrap = el('div', {});

  wrap.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: '18px' } },
    statTile('Modules completed', `${s.modulesCompleted || 0}/${state.catalogue.length}`, 'of the 12-module program', 'acc'),
    statTile('Practice sessions', s.sessionCount || 0, `avg score ${s.avgSessionScore || 0}`, s.avgSessionScore >= 75 ? 'good' : 'warn'),
    statTile('Assessment avg', s.avgAssessment || 0, `${s.assessmentCount || 0} submitted`, s.avgAssessment >= 70 ? 'good' : ''),
    statTile('Current streak', `${state.streak}d`, 'consecutive days of practice', state.streak > 0 ? 'good' : ''),
  ));

  // Progress table
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, 'Curriculum progress'));
  if (!state.catalogue.length) {
    card.appendChild(el('div', { class: 'empty' }, el('div', { class: 'big' }, '◎'), 'No modules loaded.'));
  } else {
    const table = el('table', {});
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, '#'), el('th', {}, 'Module'), el('th', {}, 'Level'),
      el('th', {}, 'Duration'), el('th', {}, 'Progress'), el('th', {}, 'Score'))));
    const tb = el('tbody', {});
    state.catalogue.forEach(m => {
      const p = state.progress[m.id] || { percent: 0, lastScore: 0 };
      tb.appendChild(el('tr', { style: { cursor: 'pointer' }, onclick: () => navigate('module', m.id) },
        el('td', { style: { fontFamily: 'var(--mono)', color: 'var(--fg-3)' } }, String(m.number).padStart(2, '0')),
        el('td', { style: { color: 'var(--fg)', fontWeight: '600' } }, m.title),
        el('td', {}, el('span', { class: `pill ${m.level}` }, m.level)),
        el('td', {}, `${m.durationMinutes}m`),
        el('td', { style: { width: '150px' } },
          el('div', { class: 'progress-bar' }, el('div', { style: { width: `${p.percent}%` } })),
          el('div', { style: { fontSize: '11px', color: 'var(--fg-3)', marginTop: '3px' } }, `${p.percent}%`)),
        el('td', { style: { fontFamily: 'var(--mono)' } }, p.lastScore ? `${p.lastScore}` : '-'),
      ));
    });
    table.appendChild(tb);
    card.appendChild(table);
  }
  wrap.appendChild(card);

  // Recent sessions
  const sc = el('div', { class: 'card' });
  sc.appendChild(el('h3', {}, 'Recent practice'));
  api('/api/sessions').then(sessions => {
    if (!sessions.length) {
      sc.appendChild(el('div', { class: 'empty' },
        el('div', { class: 'big' }, '◉'),
        'No recorded sessions yet.',
        el('div', { style: { marginTop: '14px' } },
          el('button', { class: 'btn btn-primary', onclick: () => navigate('studio') }, 'Open the Live Coach Studio'))));
      return;
    }
    const t = el('table', {});
    t.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'When'), el('th', {}, 'Module'), el('th', {}, 'Kind'),
      el('th', {}, 'WPM'), el('th', {}, 'Score'))));
    const tb = el('tbody', {});
    sessions.slice(0, 8).forEach(s => {
      tb.appendChild(el('tr', {},
        el('td', {}, fmtDate(s.createdAt)),
        el('td', {}, s.moduleId || '-'),
        el('td', {}, s.kind || 'practice'),
        el('td', { style: { fontFamily: 'var(--mono)' } }, s.wpm || '-'),
        el('td', { style: { fontFamily: 'var(--mono)', color: scoreColor(s.overall) } }, s.overall || '-'),
      ));
    });
    t.appendChild(tb);
    sc.appendChild(t);
  }).catch(e => sc.appendChild(el('div', { class: 'empty' }, e.message)));
  wrap.appendChild(sc);

  // Dimension trends
  const tr = el('div', { class: 'card' });
  tr.appendChild(el('h3', {}, 'Dimension trends'));
  tr.appendChild(el('div', { style: { fontSize: '12.5px', color: 'var(--fg-3)', marginBottom: '14px' } },
    'Every recorded take scored on the same seven dimensions. This is the only honest way to know whether you are actually improving.'));
  api('/api/dashboard').then(d => {
    const trends = d.trends || [];
    if (trends.length < 2) {
      tr.appendChild(el('div', { class: 'empty' },
        el('div', { class: 'big' }, '◔'),
        'Record at least two takes to see a trend.'));
    } else {
      const dims = [
        ['overall', 'Overall', 'var(--accent)'],
        ['pace', 'Pace', 'var(--accent-2)'],
        ['clarity', 'Clarity', 'var(--green)'],
        ['delivery', 'Delivery', 'var(--violet)'],
        ['pitch', 'Pitch', 'var(--amber)'],
        ['pauseControl', 'Pause', '#fb923c'],
        ['vocabulary', 'Vocabulary', '#60a5fa'],
        ['structure', 'Structure', '#f472b6'],
      ];
      const grid = el('div', { class: 'grid grid-2' });
      dims.forEach(([key, label, color]) => {
        const vals = trends.map(t => t[key]).filter(v => typeof v === 'number');
        if (!vals.length) return;
        const first = vals[0], last = vals[vals.length - 1];
        const delta = last - first;
        const card = el('div', { style: { background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '13px 15px' } });
        card.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '9px' } },
          el('span', { style: { fontSize: '12.5px', color: 'var(--fg-2)', fontWeight: '600' } }, label),
          el('span', {
            style: {
              fontSize: '12px', fontWeight: '700',
              color: delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--rose)' : 'var(--fg-3)',
            },
          }, delta === 0 ? '—' : (delta > 0 ? `+${delta}` : `${delta}`))));
        card.appendChild(sparkline(vals, color));
        card.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--fg-3)', marginTop: '5px', fontFamily: 'var(--mono)' } },
          el('span', {}, `${first}`), el('span', {}, `${last}`)));
        grid.appendChild(card);
      });
      tr.appendChild(grid);
    }
  }).catch(() => {});
  wrap.appendChild(tr);

  return wrap;
}

/** Inline SVG sparkline for a series of 0-100 scores. */
function sparkline(vals, color) {
  const W = 260, H = 42, pad = 3;
  if (vals.length < 2) return el('div', { style: { height: `${H}px` } });
  const min = Math.min(...vals, 0), max = Math.max(...vals, 100);
  const span = Math.max(1, max - min);
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / span) * (H - pad * 2);
    return [x, y];
  });
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${H - pad} L${pts[0][0].toFixed(1)},${H - pad} Z`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', `${H}`);
  svg.style.display = 'block';
  svg.innerHTML = `
    <path d="${area}" fill="${color}" opacity="0.10"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.8" fill="${color}"/>`;
  return svg;
}

const scoreColor = (n) => !n ? 'var(--fg-3)' : n >= 80 ? 'var(--green)' : n >= 60 ? 'var(--amber)' : 'var(--rose)';

function statTile(k, v, d, cls = '') {
  return el('div', { class: `stat ${cls}` },
    el('div', { class: 'k' }, k),
    el('div', { class: 'v' }, String(v)),
    el('div', { class: 'd' }, d));
}

/* ------------------------------------------------------------------ */
/* Module player                                                       */
/* ------------------------------------------------------------------ */

async function loadModule(id) {
  const data = await api(`/api/modules/${id}`);
  state.module = data.module;
  state.progress[id] = data.progress;
  state.tab = 'concepts';
  state.expanded = new Set();
}

function viewModule() {
  const m = state.module;
  const p = state.progress[state.moduleId] || {};
  const wrap = el('div', { class: 'player' });
  const main = el('div', {});
  const side = el('div', {});

  /* ---- header ---- */
  const head = el('div', { class: 'card' });
  head.appendChild(el('div', { style: { display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' } },
    el('span', { class: `pill ${m.level}` }, m.level),
    el('span', { class: 'pill' }, `${m.durationMinutes} min`),
    el('span', { class: 'pill' }, `Module ${m.number} of 12`),
  ));
  head.appendChild(el('h2', { style: { fontSize: '23px', fontWeight: '700', letterSpacing: '-.01em', marginBottom: '4px' } }, m.title));
  head.appendChild(el('div', { style: { color: 'var(--fg-3)', fontSize: '14.5px', marginBottom: '14px' } }, m.subtitle));
  head.appendChild(el('div', { style: { fontSize: '14.5px', color: 'var(--fg-2)', lineHeight: '1.7', marginBottom: '16px' } }, m.abstract));

  head.appendChild(el('div', { style: { background: 'var(--bg-2)', borderLeft: '3px solid var(--accent)', padding: '11px 14px', borderRadius: '0 8px 8px 0', marginBottom: '16px' } },
    el('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--fg-3)', fontWeight: '700', marginBottom: '3px' } }, 'Outcome'),
    el('div', { style: { fontSize: '14px', color: 'var(--fg)' } }, m.outcome)));

  head.appendChild(el('h3', { style: { fontSize: '13px', marginBottom: '9px' } }, 'Learning objectives'));
  head.appendChild(el('ul', { class: 'criteria' }, ...m.objectives.map(o => el('li', {}, o))));
  main.appendChild(head);

  /* ---- tabs ---- */
  const tabs = el('div', { class: 'tabs' });
  const tabDefs = [
    ['concepts', `Concepts (${m.concepts.length})`],
    ['frameworks', `Frameworks (${m.frameworks.length})`],
    ['exercises', `Exercises (${m.exercises.length})`],
    ['scenarios', `Scenarios (${m.scenarios.length})`],
    ['assessment', 'Assessment'],
    ['terms', `Key terms (${m.keyTerms.length})`],
    ['reading', `Reading (${m.readingList.length})`],
  ];
  tabDefs.forEach(([id, label]) => {
    tabs.appendChild(el('button', { class: `tab ${state.tab === id ? 'active' : ''}`, onclick: () => { state.tab = id; render(); } }, label));
  });
  main.appendChild(tabs);

  /* ---- tab bodies ---- */
  if (state.tab === 'concepts') main.appendChild(...m.concepts.map(c => conceptCard(c, m)));
  else if (state.tab === 'frameworks') main.appendChild(...m.frameworks.map(f => frameworkCard(f)));
  else if (state.tab === 'exercises') main.appendChild(...m.exercises.map(e => exerciseCard(e, m)));
  else if (state.tab === 'scenarios') main.appendChild(...m.scenarios.map(s => scenarioCard(s, m)));
  else if (state.tab === 'assessment') main.appendChild(assessmentCard(m));
  else if (state.tab === 'terms') main.appendChild(termsCard(m));
  else if (state.tab === 'reading') main.appendChild(readingCard(m));

  /* ---- side panel ---- */
  side.appendChild(progressCard(m, p));
  side.appendChild(coachCard(m));

  wrap.appendChild(main);
  wrap.appendChild(side);
  return wrap;
}

function conceptCard(c, m) {
  const open = state.expanded.has(c.id);
  const body = el('div', { class: 'concept-body', style: open ? {} : { display: 'none' } });

  body.appendChild(el('div', { class: 'diagram-wrap' },
    el('img', {
      class: 'diagram', id: `img-${c.id}`,
      alt: `Diagram: ${c.title}`,
      loading: 'lazy',
      style: { display: 'none' },
      onerror: (e) => {
        e.target.style.display = 'none';
      },
    }),
    el('button', {
      class: 'gen-btn',
      onclick: async (e) => {
        const btn = e.target;
        btn.disabled = true; btn.innerHTML = '<span class="spin"></span> generating...';
        try {
          const out = await api('/api/images/generate', { method: 'POST', body: { moduleId: m.id, conceptId: c.id } });
          const img = $(`#img-${c.id}`);
          img.style.display = '';
          img.src = out.url + '?t=' + Date.now();
          btn.textContent = 'Regenerate';
        } catch (err) {
          toast(err.message, 'err');
          btn.textContent = 'Retry';
        } finally { btn.disabled = false; }
      },
    }, 'Generate diagram'),
  ));

  // If a diagram was already generated for this concept, show it immediately.
  api(`/api/images/existing?moduleId=${m.id}&conceptId=${c.id}`).then(r => {
    if (r?.url) {
      const img = $(`#img-${c.id}`);
      if (img) { img.style.display = ''; img.src = r.url; }
      const btn = $(`#img-${c.id}`)?.parentElement?.querySelector('.gen-btn');
      if (btn) btn.textContent = 'Regenerate';
    }
  }).catch(() => { /* no diagram yet */ });

  body.appendChild(el('div', { html: md(c.detail) }));

  if (c.principles?.length) {
    body.appendChild(el('h3', { style: { fontSize: '13px', marginTop: '18px', marginBottom: '8px', color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.1em' } }, 'Principles'));
    body.appendChild(el('ul', { class: 'principles' }, ...c.principles.map(p => el('li', {}, p))));
  }

  if (c.pitfalls?.length) {
    body.appendChild(el('h3', { style: { fontSize: '13px', marginTop: '18px', marginBottom: '8px', color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.1em' } }, 'Common failures'));
    c.pitfalls.forEach(p => {
      body.appendChild(el('div', { class: 'pitfall' },
        el('div', { class: 'f' }, p.failure),
        el('div', { class: 'x' }, p.fix)));
    });
  }

  const done = (state.progress[state.moduleId]?.concepts || []).includes(c.id);
  body.appendChild(el('button', {
    class: `btn btn-sm ${done ? 'btn-ghost' : 'btn-primary'}`,
    style: { marginTop: '16px' },
    onclick: () => toggleConcept(c.id, done),
  }, done ? '✓ Completed - undo' : 'Mark as complete'));

  return el('div', { class: 'concept' },
    el('div', {
      class: 'concept-head',
      onclick: () => { state.expanded.has(c.id) ? state.expanded.delete(c.id) : state.expanded.add(c.id); render(); },
    },
      el('span', { style: { color: 'var(--accent)', fontSize: '13px' } }, open ? '▾' : '▸'),
      el('h4', {}, c.title),
      el('span', { style: { fontSize: '12px', color: 'var(--fg-3)', maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.summary),
    ),
    body);
}

async function toggleConcept(cid, wasDone) {
  const id = state.moduleId;
  const cur = state.progress[id]?.concepts || [];
  const next = wasDone ? cur.filter(x => x !== cid) : [...cur, cid];
  const p = await api(`/api/progress/${id}`, { method: 'POST', body: { concepts: next } });
  state.progress[id] = p;
  toast(wasDone ? 'Marked as not done' : 'Concept complete', 'ok');
  render();
}

function frameworkCard(f) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '11px', marginBottom: '6px' } },
    el('h3', { style: { marginBottom: '0', fontSize: '16px' } }, f.name)));
  card.appendChild(el('div', { style: { fontSize: '14px', color: 'var(--fg-2)', marginBottom: '14px' } }, f.summary));
  card.appendChild(el('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--fg-3)', fontWeight: '700', marginBottom: '7px' } }, 'Steps'));
  f.steps.forEach((s, i) => {
    card.appendChild(el('div', { class: 'frame-step' },
      el('div', { class: 'frame-num' }, String(i + 1)),
      el('div', { style: { fontSize: '14px', color: 'var(--fg-2)', lineHeight: '1.65' } }, s)));
  });
  if (f.whenToUse) {
    card.appendChild(el('div', { style: { marginTop: '14px', padding: '11px 13px', background: 'var(--bg-2)', borderRadius: '8px', fontSize: '13.5px', color: 'var(--fg-2)' } },
      el('strong', { style: { color: 'var(--fg)' } }, 'When to use: '), f.whenToUse));
  }
  if (f.example) {
    card.appendChild(el('div', { style: { marginTop: '10px', padding: '11px 13px', background: 'var(--bg-2)', borderLeft: '3px solid var(--accent-2)', borderRadius: '0 8px 8px 0', fontSize: '13.5px', color: 'var(--fg-2)' } },
      el('strong', { style: { color: 'var(--fg)' } }, 'Example: '), f.example));
  }
  return card;
}

function exerciseCard(e, m) {
  const card = el('div', { class: 'exercise' });
  const done = (state.progress[state.moduleId]?.exercises || []).includes(e.id);
  const typeColor = { drill: 'var(--fg-3)', recorded: 'var(--accent-2)', realWorld: 'var(--amber)', analytical: 'var(--violet)', reflection: 'var(--fg-3)' };

  card.appendChild(el('div', { class: 'exercise-head' },
    el('h4', {}, e.title),
    el('span', { class: 'pill', style: { color: typeColor[e.type] || 'var(--fg-3)', borderColor: (typeColor[e.type] || 'var(--line-2)') + '66' } }, e.type)));

  card.appendChild(el('div', { class: 'exercise-meta' },
    el('span', { class: 'pill' }, `${e.durationMinutes} min`),
    el('span', { class: 'pill' }, e.deliverable),
    done ? el('span', { class: 'pill', style: { color: 'var(--green)', borderColor: 'rgba(74,222,128,.4)' } }, '✓ done') : null));

  card.appendChild(el('div', { class: 'exercise-instructions' }, e.instructions));

  card.appendChild(el('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--fg-3)', fontWeight: '700', margin: '4px 0 6px' } }, 'Success criteria'));
  card.appendChild(el('ul', { class: 'criteria' }, ...e.successCriteria.map(c => el('li', {}, c))));

  card.appendChild(el('div', { style: { display: 'flex', gap: '9px', marginTop: '14px', flexWrap: 'wrap' } },
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: () => startStudio(m, e),
    }, '◉ Practise with live coach'),
    el('button', {
      class: `btn btn-sm ${done ? 'btn-ghost' : ''}`,
      onclick: () => toggleExercise(e.id, done),
    }, done ? '✓ Marked done - undo' : 'Mark done'),
  ));
  return card;
}

async function toggleExercise(eid, wasDone) {
  const id = state.moduleId;
  const cur = state.progress[id]?.exercises || [];
  const next = wasDone ? cur.filter(x => x !== eid) : [...cur, eid];
  const p = await api(`/api/progress/${id}`, { method: 'POST', body: { exercises: next } });
  state.progress[id] = p;
  render();
}

function scenarioCard(s, m) {
  const card = el('div', { class: 'scenario' });
  card.appendChild(el('h4', { style: { fontSize: '15px', fontWeight: '650', marginBottom: '6px' } }, s.title));
  card.appendChild(el('div', { class: 'setting' }, s.setting));
  card.appendChild(el('div', { style: { fontSize: '14px', color: 'var(--fg)', marginBottom: '12px' } }, s.challenge));

  card.appendChild(el('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--fg-3)', fontWeight: '700', marginBottom: '7px' } }, 'Your objectives'));
  card.appendChild(el('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '14px' } },
    ...s.objectives.map(o => el('span', { class: 'chip' }, o))));

  card.appendChild(el('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--fg-3)', fontWeight: '700', marginBottom: '8px' } }, 'How do you respond?'));

  s.options.forEach((o, i) => {
    const btn = el('button', { class: 'option', onclick: () => revealOption(card, s, o, i, m) }, o.text);
    card.appendChild(btn);
  });
  return card;
}

async function revealOption(card, s, o, i, m) {
  $$('.option', card).forEach(b => { b.classList.add('revealed'); b.onclick = null; });
  const btn = $$('.option', card)[i];
  btn.classList.add(o.rating);
  btn.innerHTML = `${escapeHtml(o.text)}<span class="rating ${o.rating}">${o.rating}</span>`;

  const fb = el('div', { style: { marginTop: '10px', padding: '13px 15px', background: 'var(--bg-2)', borderLeft: '3px solid var(--accent)', borderRadius: '0 8px 8px 0', fontSize: '13.5px', color: 'var(--fg-2)' } },
    el('div', { style: { fontWeight: '650', color: 'var(--fg)', marginBottom: '5px' } }, 'Coach feedback'),
    o.feedback);
  card.appendChild(fb);

  if (s.coachingNote) {
    card.appendChild(el('div', { style: { marginTop: '9px', fontSize: '13px', color: 'var(--fg-3)', fontStyle: 'italic' } }, s.coachingNote));
  }

  try {
    await api(`/api/scenarios/${m.id}/${s.id}/respond`, {
      method: 'POST',
      body: { optionIndex: i, optionText: o.text, rating: o.rating, feedback: o.feedback },
    });
    const cur = state.progress[m.id]?.scenarios || [];
    if (!cur.includes(s.id)) {
      const p = await api(`/api/progress/${m.id}`, { method: 'POST', body: { scenarios: [...cur, s.id] } });
      state.progress[m.id] = p;
    }
  } catch (e) { toast(e.message, 'err'); }
}

function assessmentCard(m) {
  const card = el('div', { class: 'card' });
  const a = m.assessment;
  card.appendChild(el('h3', {}, a.title));
  card.appendChild(el('div', { style: { fontSize: '14px', color: 'var(--fg-2)', marginBottom: '16px' } }, a.brief));

  card.appendChild(el('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--fg-3)', fontWeight: '700', marginBottom: '9px' } }, 'Rubric'));
  const t = el('table', {});
  t.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, 'Dimension'), el('th', {}, 'Weight'), el('th', {}, 'Excellent'), el('th', {}, 'Adequate'), el('th', {}, 'Poor'))));
  const tb = el('tbody', {});
  a.rubric.forEach(r => {
    tb.appendChild(el('tr', {},
      el('td', { style: { color: 'var(--fg)', fontWeight: '600' } }, r.dimension),
      el('td', { style: { fontFamily: 'var(--mono)' } }, `${r.weight}%`),
      el('td', { style: { fontSize: '12.5px' } }, r.excellent),
      el('td', { style: { fontSize: '12.5px' } }, r.adequate),
      el('td', { style: { fontSize: '12.5px' } }, r.poor)));
  });
  t.appendChild(tb);
  card.appendChild(t);
  card.appendChild(el('div', { style: { marginTop: '12px', fontSize: '13px', color: 'var(--fg-3)' } }, `Pass mark: ${a.passMark}/100`));

  const ta = el('textarea', {
    style: {
      width: '100%', minHeight: '170px', background: 'var(--bg-2)', border: '1px solid var(--line)',
      borderRadius: '8px', padding: '13px 15px', fontSize: '14px', lineHeight: '1.65', resize: 'vertical',
    },
    placeholder: 'Write your response to the brief. Be specific and concrete - the grader is looking for behaviour, not intentions.',
  });
  const out = el('div', { style: { marginTop: '14px' } });

  const submit = el('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      if (!ta.value.trim()) return toast('Write a response first', 'err');
      submit.disabled = true;
      submit.innerHTML = '<span class="spin"></span> Grading...';
      out.innerHTML = '';
      try {
        const r = await api(`/api/assessments/${m.id}/submit`, { method: 'POST', body: { submission: ta.value } });
        const g = r.graded;
        out.appendChild(el('div', { class: 'grid grid-2' },
          el('div', { class: 'stat ' + (r.passed ? 'good' : 'bad') },
            el('div', { class: 'k' }, 'Total score'),
            el('div', { class: 'v' }, g.total ?? '-'),
            el('div', { class: 'd' }, r.passed ? 'Passed' : `Below pass mark of ${m.assessment.passMark}`)),
          el('div', { class: 'stat' },
            el('div', { class: 'k' }, 'Result'),
            el('div', { class: 'v', style: { fontSize: '20px' } }, r.passed ? 'PASS' : 'RETRY'),
            el('div', { class: 'd' }, g.summary?.slice(0, 60) || '')),
        ));
        const t2 = el('table', { style: { marginTop: '14px' } });
        t2.appendChild(el('thead', {}, el('tr', {}, el('th', {}, 'Dimension'), el('th', {}, 'Score'), el('th', {}, 'Comment'))));
        const tb2 = el('tbody', {});
        (g.scores || []).forEach(s => {
          tb2.appendChild(el('tr', {},
            el('td', { style: { color: 'var(--fg)', fontWeight: '600' } }, s.dimension),
            el('td', { style: { fontFamily: 'var(--mono)', color: scoreColor(s.score) } }, s.score),
            el('td', { style: { fontSize: '12.5px' } }, s.comment)));
        });
        t2.appendChild(tb2);
        out.appendChild(t2);
        if (g.nextStep) {
          out.appendChild(el('div', { class: 'note info', style: { marginTop: '12px' } },
            el('span', { class: 'dim' }, 'Next'), el('span', {}, g.nextStep)));
        }
        toast(r.passed ? 'Assessment passed' : 'Below pass mark - revise and resubmit', r.passed ? 'ok' : 'err');
      } catch (e) {
        toast(e.message, 'err');
      } finally {
        submit.disabled = false;
        submit.textContent = 'Submit for grading';
      }
    },
  }, 'Submit for grading');

  card.appendChild(el('h3', { style: { marginTop: '22px' } }, 'Your response'));
  card.appendChild(ta);
  card.appendChild(el('div', { style: { marginTop: '12px' } }, submit));
  card.appendChild(out);
  return card;
}

function termsCard(m) {
  const card = el('div', { class: 'card' });
  m.keyTerms.forEach(t => {
    card.appendChild(el('div', { style: { padding: '11px 0', borderBottom: '1px solid var(--bg-2)' } },
      el('div', { style: { fontWeight: '650', fontSize: '14px', color: 'var(--fg)', marginBottom: '3px' } }, t.term),
      el('div', { style: { fontSize: '13.5px', color: 'var(--fg-2)' } }, t.definition)));
  });
  return card;
}

function readingCard(m) {
  const card = el('div', { class: 'card' });
  m.readingList.forEach(r => {
    card.appendChild(el('div', { style: { padding: '12px 0', borderBottom: '1px solid var(--bg-2)' } },
      el('div', { style: { fontWeight: '650', fontSize: '14.5px' } }, r.title),
      el('div', { style: { fontSize: '13px', color: 'var(--fg-3)', marginBottom: '5px' } }, `by ${r.author}`),
      el('div', { style: { fontSize: '13.5px', color: 'var(--fg-2)' } }, r.why)));
  });
  return card;
}

function progressCard(m, p) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, 'Your progress'));
  const pct = p.percent || 0;
  card.appendChild(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' } },
    el('div', { style: { fontSize: '30px', fontWeight: '700', color: 'var(--accent)' } }, `${pct}%`),
    el('div', { style: { fontSize: '12.5px', color: 'var(--fg-3)' } }, p.completedAt ? 'completed' : 'in progress')));
  card.appendChild(el('div', { class: 'progress-bar', style: { marginBottom: '16px' } }, el('div', { style: { width: `${pct}%` } })));

  const rows = [
    ['Concepts', (p.concepts || []).length, m.concepts.length],
    ['Exercises', (p.exercises || []).length, m.exercises.length],
    ['Scenarios', (p.scenarios || []).length, m.scenarios.length],
  ];
  rows.forEach(([k, a, b]) => {
    card.appendChild(el('div', { style: { marginBottom: '11px' } },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' } },
        el('span', { style: { color: 'var(--fg-2)' } }, k),
        el('span', { style: { fontFamily: 'var(--mono)', color: 'var(--fg-3)' } }, `${a}/${b}`)),
      el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: { width: `${b ? (a / b) * 100 : 0}%`, background: a === b ? 'var(--green)' : 'var(--accent-2)' } }))));
  });

  if (m.masteryChecklist?.length) {
    card.appendChild(el('h3', { style: { marginTop: '20px', fontSize: '13px' } }, 'Mastery checklist'));
    card.appendChild(el('ul', { class: 'criteria' }, ...m.masteryChecklist.map(c => el('li', {}, c))));
  }
  return card;
}

function coachCard(m) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, 'Coach'));
  card.appendChild(el('div', { style: { fontSize: '13.5px', color: 'var(--fg-2)', marginBottom: '14px', lineHeight: '1.65' } },
    'The live coach hears your voice, not just your words. It can hear pace, pauses, pitch, and volume, and it pushes back in real time.'));
  card.appendChild(el('button', {
    class: 'btn btn-primary', style: { width: '100%' },
    onclick: () => startStudio(m, m.exercises[0]),
  }, '◉ Open the live studio'));
  card.appendChild(el('button', {
    class: 'btn btn-ghost', style: { width: '100%', marginTop: '8px' },
    onclick: () => { state.tutorModule = m.id; navigate('tutor'); },
  }, '◆ Ask the tutor about this module'));
  return card;
}

/* ------------------------------------------------------------------ */
/* Live studio                                                         */
/* ------------------------------------------------------------------ */

const studio = {
  ws: null, module: null, exercise: null, scenario: null,
  stream: null, audioCtx: null, source: null, proc: null,
  playing: false, buffer: [], bufferBytes: 0,
  words: [], liveWords: [], recording: false, recStart: 0, recStartMs: 0,
  // Voice-activity tracking: speech segments detected from the mic energy
  // envelope, used to align the model's transcript to word timings.
  voice: { active: false, last: 0, segStart: 0, segStartOffset: 0, endOffset: 0, segments: [] },
  // Transcript text captured per turn, in order.
  turns: [],
};

async function startStudio(m, exercise) {
  state.pendingModule = m;
  state.pendingExercise = exercise;
  navigate('studio');
}

async function viewStudio() {
  const wrap = el('div', { class: 'studio' });
  const main = el('div', {});
  const side = el('div', {});

  // Default to the current module (or the first catalogue entry) so the studio
  // is always usable, even when opened directly from the sidebar. The catalogue
  // only carries summary fields, so load the full module to get its exercises.
  if (!state.pendingModule) {
    const target = state.module
      || (state.catalogue.find(m => m.id === state.moduleId) || state.catalogue[0] || null);
    if (target) {
      try {
        const d = await api(`/api/modules/${target.id}`);
        state.pendingModule = d.module;
      } catch { state.pendingModule = target; }
    }
  }
  if (!state.pendingExercise && state.pendingModule) {
    state.pendingExercise = state.pendingModule.exercises?.[0] || null;
  }

  const m = state.pendingModule || state.module;
  const ex = state.pendingExercise;

  /* ---- stage ---- */
  const stage = el('div', { class: 'stage' });
  const ring = el('div', { class: 'mic-ring', id: 'micRing' }, '🎙');
  stage.appendChild(ring);
  stage.appendChild(el('div', { id: 'studioStatus', style: { fontSize: '13.5px', color: 'var(--fg-2)', marginBottom: '6px' } }, 'Ready when you are.'));
  stage.appendChild(el('div', { id: 'studioMeta', style: { fontSize: '12.5px', color: 'var(--fg-3)' } },
    ex ? `${ex.title} · ${ex.durationMinutes} min` : 'Free practice'));
  stage.appendChild(el('div', { style: { display: 'flex', gap: '9px', justifyContent: 'center', marginTop: '18px', flexWrap: 'wrap' } },
    el('button', { class: 'btn btn-primary btn-lg', id: 'btnConnect', onclick: () => connectLive() }, '◉ Start live session'),
    el('button', { class: 'btn', id: 'btnRecord', onclick: () => toggleRecord(), disabled: true }, '● Record a take'),
    el('button', { class: 'btn btn-ghost', id: 'btnStop', onclick: () => stopLive(), disabled: true }, 'Stop'),
  ));
  main.appendChild(stage);

  /* ---- transcript ---- */
  main.appendChild(el('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--fg-3)', fontWeight: '700', margin: '18px 0 8px' } }, 'Live transcript'));
  main.appendChild(el('div', { class: 'transcript', id: 'transcript' },
    el('div', { class: 'tline coach' }, el('span', { class: 'who' }, 'Coach'),
      el('span', { class: 'txt' }, 'Start the session and I will open with your exercise brief.'))));

  /* ---- metrics panel ---- */
  main.appendChild(el('div', { id: 'metricsPanel', style: { marginTop: '18px' } }));
  wrap.appendChild(main);

  /* ---- side: exercise brief + controls ---- */
  if (ex) {
    const b = el('div', { class: 'card' });
    b.appendChild(el('h3', {}, ex.title));
    b.appendChild(el('div', { style: { fontSize: '13.5px', color: 'var(--fg-2)', lineHeight: '1.7', marginBottom: '14px' } }, ex.instructions));
    b.appendChild(el('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--fg-3)', fontWeight: '700', marginBottom: '7px' } }, 'Success criteria'));
    b.appendChild(el('ul', { class: 'criteria' }, ...ex.successCriteria.map(c => el('li', {}, c))));
    side.appendChild(b);
  }

  const vc = el('div', { class: 'card' });
  vc.appendChild(el('h3', {}, 'Session settings'));
  const sel = el('select', { id: 'studioVoice', style: { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: '8px', padding: '9px 11px', marginBottom: '12px' } },
    ...(state.voices.length ? state.voices : ['Puck']).map(v => el('option', { value: v, selected: v === state.defaultVoice }, v)));
  vc.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--fg-3)', marginBottom: '5px' } }, 'Coach voice'));
  vc.appendChild(sel);
  vc.appendChild(el('div', { style: { fontSize: '11.5px', color: 'var(--fg-3)', lineHeight: '1.6', marginBottom: '14px' } },
    'The coach speaks in real time. Use headphones to prevent the coach hearing itself.'));

  vc.appendChild(el('div', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.11em', color: 'var(--fg-3)', fontWeight: '700', marginBottom: '7px' } }, 'Coach controls'));
  const instr = el('textarea', {
    id: 'coachNote',
    style: { width: '100%', minHeight: '80px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', resize: 'vertical' },
    placeholder: 'e.g. Focus only on my opening 30 seconds',
  });
  vc.appendChild(instr);
  vc.appendChild(el('button', {
    class: 'btn btn-sm', style: { marginTop: '8px', width: '100%' },
    onclick: () => {
      const v = instr.value.trim();
      if (!v) return toast('Write a note for the coach first', 'err');
      sendWs({ type: 'updateInstruction', instruction: v });
      instr.value = '';
      toast('Note sent to the coach', 'ok');
    },
  }, 'Send note to coach'));
  side.appendChild(vc);
  wrap.appendChild(side);
  return wrap;
}

function sendWs(obj) {
  if (studio.ws && studio.ws.readyState === WebSocket.OPEN) {
    studio.ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

async function connectLive() {
  const m = state.pendingModule || state.module;
  const ex = state.pendingExercise;

  // Build the coach instruction server-side so the browser never sees the key.
  let instruction, opening;
  try {
    const r = await api('/api/live/instruction', {
      method: 'POST',
      body: { moduleId: m?.id, exerciseId: ex?.id, opening: ex?.liveCoachPrompt },
    });
    instruction = r.instruction;
    opening = r.opening;
  } catch (e) {
    return toast('Could not prepare the coach: ' + e.message, 'err');
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/live`);
  studio.ws = ws;
  setStudioStatus('Connecting to the coach...', 'wait');

  // Start the mic now so the coach can hear the learner as soon as it opens.
  // The coach's own audio is played through the speakers, so headphones are
  // strongly recommended to avoid the coach hearing itself.
  startMic().catch(e => {
    setStudioStatus('Microphone blocked: ' + e.message, 'err');
    toast('Microphone blocked - the coach can hear you only if you allow it.', 'err');
  });

  ws.onopen = () => {
    setStudioStatus('Session opening...', 'wait');
    sendWs({ type: 'start', systemInstruction: instruction, opening, voice: $('#studioVoice')?.value || state.defaultVoice });
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case 'ready':
        setStudioStatus('Live. Speak now.', 'live');
        $('#btnConnect').disabled = true;
        $('#btnStop').disabled = false;
        $('#btnRecord').disabled = false;
        break;
      case 'connected':
        setStudioStatus('Live. Speak now.', 'live');
        break;
      case 'audio':
        window.__oratorAudioChunks = (window.__oratorAudioChunks || 0) + 1;
        playCoachAudio(msg.pcm);
        break;
      case 'transcript':
        addTranscriptLine(msg.role, msg.text);
        if (msg.role === 'user') {
          // Accumulate the learner's own words for the metrics pass.
          if (!studio.userTurnText) studio.userTurnText = '';
          studio.userTurnText += ' ' + msg.text;
        }
        break;
      case 'error':
        setStudioStatus('Error: ' + msg.message, 'err');
        toast(msg.message, 'err');
        break;
      case 'closed':
      case 'stopped':
        setStudioStatus('Session ended.', 'off');
        $('#btnConnect').disabled = false;
        $('#btnStop').disabled = true;
        break;
    }
  };

  ws.onerror = () => { setStudioStatus('Connection error.', 'err'); };
  ws.onclose = () => {
    $('#btnConnect').disabled = false;
    $('#btnStop').disabled = true;
    stopMic();
  };
}

function setStudioStatus(text, kind) {
  const s = $('#studioStatus');
  if (!s) return;
  s.textContent = text;
  const ring = $('#micRing');
  if (ring) ring.classList.toggle('live', kind === 'live');
  const dot = $('#studioDot');
  if (dot) dot.className = 'dot ' + (kind === 'live' ? 'live' : kind === 'err' ? 'err' : kind === 'off' ? '' : 'ok');
}

let transcriptNodes = {};
function addTranscriptLine(role, text) {
  const box = $('#transcript');
  if (!box) return;
  const key = role;
  if (!transcriptNodes[key]) {
    const node = el('div', { class: `tline ${role}` },
      el('span', { class: 'who' }, role === 'coach' ? 'Coach' : role === 'user' ? 'You' : role),
      el('span', { class: 'txt' }, ''));
    box.appendChild(node);
    transcriptNodes[key] = node;
  }
  $('.txt', transcriptNodes[key]).textContent += text;
  box.scrollTop = box.scrollHeight;
}

/* ---- playback of coach audio (24 kHz PCM) ---- */
let playCtx = null;
let nextPlayTime = 0;
function playCoachAudio(b64) {
  try {
    if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (playCtx.state === 'suspended') playCtx.resume();
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(buf);
    const buf2 = playCtx.createBuffer(1, pcm.length, 24000);
    const ch = buf2.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = playCtx.createBufferSource();
    src.buffer = buf2;
    src.connect(playCtx.destination);
    if (nextPlayTime < playCtx.currentTime) nextPlayTime = playCtx.currentTime;
    src.start(nextPlayTime);
    nextPlayTime += buf2.duration;
  } catch (e) { /* audio playback is best-effort */ }
}

/* ---- microphone capture + recording ---- */
async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
  });
  studio.stream = stream;
  studio.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const src = studio.audioCtx.createMediaStreamSource(stream);
  studio.source = src;
  studio.proc = studio.audioCtx.createScriptProcessor(4096, 1, 1);
  studio.proc.onaudioprocess = (e) => {
    if (!studio.ws || studio.ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    // downsample 48k -> 16k
    const ratio = Math.floor(input.length / 8000) || 1;
    const outLen = Math.floor(input.length / ratio);
    const out = new Int16Array(outLen);
    let sum = 0;
    for (let i = 0; i < outLen; i++) {
      let s = 0;
      for (let j = 0; j < ratio; j++) s += input[i * ratio + j] || 0;
      out[i] = Math.max(-32768, Math.min(32767, Math.round((s / ratio) * 32767)));
      sum += s * s;
    }
    let bin = '';
    const bytes = new Uint8Array(out.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    sendWs({ type: 'audio', pcm: btoa(bin), mimeType: 'audio/pcm;rate=16000' });

    // Voice-activity tracking: we need speech segment boundaries so we can
    // align the model's input transcript to word-level timings. The Live API
    // returns transcript TEXT but not word timings, so we time the speech
    // ourselves from the energy envelope and distribute words across segments.
    const now = performance.now() / 1000;
    const rms = Math.sqrt(sum / (outLen * ratio * ratio));
    const chunkSec = outLen / 16000;
    if (rms > 0.012) {
      if (!studio.voice.active) {
        studio.voice.active = true;
        studio.voice.segStart = now - chunkSec;
        studio.voice.segStartOffset = studio.recStartMs ? (now - studio.recStartMs) : now;
      }
      studio.voice.last = now;
      studio.voice.endOffset = studio.recStartMs ? (now - studio.recStartMs) : now;
    } else if (studio.voice.active && now - studio.voice.last > 0.35) {
      studio.voice.active = false;
      studio.voice.segments.push({
        start: studio.voice.segStartOffset,
        end: studio.voice.endOffset,
      });
    }

    if (studio.recording) {
      studio.buffer.push(out);
      studio.bufferBytes += out.length * 2;
    }
  };
  src.connect(studio.proc);
  // Route to a muted gain node so the mic is not fed back to the speakers.
  const mute = studio.audioCtx.createGain();
  mute.gain.value = 0;
  studio.proc.connect(mute);
  mute.connect(studio.audioCtx.destination);
}

function stopMic() {
  try { studio.proc?.disconnect(); } catch { /* noop */ }
  try { studio.source?.disconnect(); } catch { /* noop */ }
  studio.stream?.getTracks().forEach(t => t.stop());
  studio.stream = null; studio.proc = null; studio.source = null;
}

async function toggleRecord() {
  const btn = $('#btnRecord');
  if (!studio.recording) {
    if (!studio.stream) {
      try { await startMic(); } catch (e) { return toast('Microphone blocked: ' + e.message, 'err'); }
    }
    studio.recording = true;
    studio.buffer = []; studio.bufferBytes = 0;
    studio.recStart = Date.now();
    studio.recStartMs = performance.now();
    // Reset the voice-activity tracker so segment offsets are relative to this take.
    studio.voice = { active: false, last: 0, segStart: 0, segStartOffset: 0, endOffset: 0, segments: [] };
    studio.userTurnText = '';
    btn.textContent = '■ Stop recording';
    btn.classList.add('btn-danger');
    toast('Recording. Speak, then press stop to analyse.', 'ok');
  } else {
    studio.recording = false;
    btn.textContent = '● Record a take';
    btn.classList.remove('btn-danger');
    await analyseTake();
  }
}

async function analyseTake() {
  const panel = $('#metricsPanel');
  panel.innerHTML = '';
  panel.appendChild(el('div', { class: 'card' },
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      el('span', { class: 'spin' }), 'Analysing your take...')));

  // Concatenate recorded PCM
  let total = 0;
  studio.buffer.forEach(b => { total += b.length; });
  const pcm = new Int16Array(total);
  let off = 0;
  studio.buffer.forEach(b => { pcm.set(b, off); off += b.length; });
  studio.buffer = []; studio.bufferBytes = 0;

  const transcript = (studio.userTurnText || '').trim();
  const durationSec = (Date.now() - studio.recStart) / 1000;

  // Build word-level timings. The Live API gives transcript text but not word
  // timings, so we distribute the words across the speech segments we detected
  // from the microphone energy envelope. This is what makes pause analysis
  // possible: a gap in the detected speech IS the pause.
  const segments = studio.voice.segments.slice();
  const words = buildWordTimings(transcript, segments, durationSec);

  try {
    const r = await api('/api/sessions', {
      method: 'POST',
      body: {
        moduleId: state.pendingModule?.id || state.moduleId,
        exerciseId: state.pendingExercise?.id,
        kind: 'live',
        transcript,
        words,
        pcmBase64: b64FromInt16(pcm),
        sampleRate: 16000,
        durationSec,
      },
    });
    renderMetrics(panel, r, words, segments);
    // Ask the tutor for a written debrief
    try {
      const d = await api('/api/debrief', {
        method: 'POST',
        body: { sessionId: r.id, moduleId: state.pendingModule?.id || state.moduleId, exerciseId: state.pendingExercise?.id },
      });
      const deb = d.debrief;
      if (deb && deb.headline) {
        panel.appendChild(el('div', { class: 'card' },
          el('h3', {}, 'Coach debrief'),
          el('div', { style: { fontSize: '15px', fontWeight: '650', color: 'var(--accent)', marginBottom: '11px' } }, deb.headline),
          deb.strength ? el('div', { class: 'note info' }, el('span', { class: 'dim' }, 'Works'), el('span', {}, deb.strength)) : null,
          deb.primaryFix ? el('div', { class: 'note high' }, el('span', { class: 'dim' }, 'Fix first'), el('span', {}, deb.primaryFix)) : null,
          deb.secondaryFix ? el('div', { class: 'note medium' }, el('span', { class: 'dim' }, 'Then'), el('span', {}, deb.secondaryFix)) : null,
          deb.quote ? el('div', { style: { marginTop: '12px', padding: '11px 14px', background: 'var(--bg-2)', borderLeft: '3px solid var(--violet)', borderRadius: '0 8px 8px 0', fontSize: '13.5px', fontStyle: 'italic', color: 'var(--fg-2)' } }, `"${deb.quote}"`) : null,
          deb.drill ? el('div', { style: { marginTop: '12px', fontSize: '13.5px', color: 'var(--fg-2)' } },
            el('strong', { style: { color: 'var(--fg)' } }, 'Drill: '), deb.drill) : null,
        ));
      }
    } catch { /* debrief is optional */ }
  } catch (e) {
    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'card' }, el('div', { class: 'note high' }, el('span', { class: 'dim' }, 'Error'), el('span', {}, e.message))));
  }
}

function b64FromInt16(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.length * 2);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Distribute transcript words across detected speech segments to produce
 * word-level timings.
 *
 * The Live API streams transcript text but not word timings. Without timings
 * the metrics engine cannot measure pauses - and a pause is exactly what a
 * coach needs to see. We detect speech segments locally from the microphone
 * energy envelope, then spread the words across those segments at a constant
 * speaking rate. Gaps between segments become real pauses in the timeline.
 */
function buildWordTimings(transcript, segments, durationSec) {
  const tokens = (transcript || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  if (!segments || segments.length === 0) {
    // No detected speech: fall back to an even spread over the take.
    const per = (durationSec || tokens.length * 0.35) / tokens.length;
    return tokens.map((word, i) => ({
      word,
      start: i * per,
      end: i * per + per * 0.75,
    }));
  }

  // Total speech time, and per-segment duration.
  const durs = segments.map(s => Math.max(0.05, s.end - s.start));
  const totalSpeech = durs.reduce((a, b) => a + b, 0);

  // Distribute tokens proportional to segment length, so a long segment gets
  // proportionally more words. Use the LARGEST REMAINING share each round
  // rather than a fixed slice, so a zero-length segment cannot swallow a
  // disproportionate number of words and starve later segments.
  const words = [];
  let tokenIdx = 0;
  let remaining = tokens.length;
  segments.forEach((seg, si) => {
    if (remaining <= 0) return;
    const isLast = si === segments.length - 1;
    const share = isLast
      ? remaining
      : Math.min(remaining, Math.max(1, Math.round((durs[si] / totalSpeech) * tokens.length)));
    const take = tokens.slice(tokenIdx, tokenIdx + share);
    tokenIdx += share;
    remaining -= share;
    if (!take.length) return;
    const per = durs[si] / take.length;
    take.forEach((word, wi) => {
      words.push({
        word,
        start: seg.start + wi * per,
        end: seg.start + wi * per + per * 0.75,
      });
    });
  });
  // Any words that did not fit (rounding) go at the end.
  for (; tokenIdx < tokens.length; tokenIdx++) {
    const last = words[words.length - 1];
    const start = last ? last.end + 0.1 : 0;
    words.push({ word: tokens[tokenIdx], start, end: start + 0.25 });
  }
  return words;
}

function renderMetrics(panel, r, words, segments) {
  const m = r.metrics;
  panel.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, 'Take analysis'));

  const dims = [
    ['Overall', m.scores.overall, ''],
    ['Pace', m.scores.pace, `${m.wpm} wpm`],
    ['Clarity', m.scores.clarity, `${m.fillers.per100}/100w fillers`],
    ['Delivery', m.scores.delivery, m.volume ? `${m.volume.dynamicRangeDb} dB range` : '-'],
    ['Pitch', m.scores.pitch, m.pitch ? `${m.pitch.medianF0} Hz, ${m.pitch.rangeSemitones} st` : '-'],
    ['Pause control', m.scores.pauseControl, `${m.pauses.powerPauses} power pauses`],
    ['Vocabulary', m.scores.vocabulary, `TTR ${m.language.typeTokenRatio}`],
    ['Structure', m.scores.structure, `${m.language.contrastMarkers} contrast markers`],
  ];
  const grid = el('div', { class: 'metric-grid' });
  dims.forEach(([k, v, s]) => {
    grid.appendChild(el('div', { class: 'metric' },
      el('div', { class: 'k' }, k),
      el('div', { class: 'v', style: { color: scoreColor(v) } }, v ?? '-'),
      el('div', { class: 's' }, s)));
  });
  card.appendChild(grid);

  if (r.coach?.length) {
    card.appendChild(el('h3', { style: { marginTop: '20px' } }, 'What to fix'));
    r.coach.forEach(n => {
      card.appendChild(el('div', { class: `note ${n.severity}` },
        el('span', { class: 'dim' }, n.dimension),
        el('span', {}, n.note)));
    });
  }

  // Pause timeline - the most actionable single view for a speaker.
  const tl = m.pauses?.timeline || [];
  if (tl.length) {
    card.appendChild(el('h3', { style: { marginTop: '20px' } }, 'Pause map'));
    card.appendChild(el('div', { style: { fontSize: '12.5px', color: 'var(--fg-3)', marginBottom: '9px' } },
      'Every gap over 120 ms. The long ones are either your best moments or your worst.'));
    const maxMs = Math.max(...tl.map(t => t.ms));
    tl.slice(0, 12).forEach(t => {
      const pct = Math.max(2, (t.ms / maxMs) * 100);
      card.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' } },
        el('span', { style: { fontSize: '11.5px', fontFamily: 'var(--mono)', color: 'var(--fg-3)', width: '54px', textAlign: 'right' } }, `${t.ms}ms`),
        el('div', { style: { flex: '1', height: '7px', background: 'var(--bg-3)', borderRadius: '4px', overflow: 'hidden' } },
          el('div', { style: { width: `${pct}%`, height: '100%', background: t.ms >= 700 ? 'var(--green)' : t.ms >= 400 ? 'var(--amber)' : 'var(--fg-3)' } })),
        el('span', { style: { fontSize: '11.5px', color: 'var(--fg-3)', flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          `"${t.before}" → "${t.after}"`)));
    });
  }

  if (words?.length) {
    card.appendChild(el('div', { style: { marginTop: '14px', fontSize: '11.5px', color: 'var(--fg-3)' } },
      `Analysed ${words.length} timed words across ${segments?.length || 0} detected speech segments.`));
  }
  panel.appendChild(card);
}

function stopLive() {
  sendWs({ type: 'stop' });
  try { studio.ws?.close(); } catch { /* noop */ }
  studio.ws = null;
  stopMic();
  setStudioStatus('Session ended.', 'off');
  $('#btnConnect').disabled = false;
  $('#btnStop').disabled = true;
}

/* ------------------------------------------------------------------ */
/* Tutor chat                                                          */
/* ------------------------------------------------------------------ */

const chat = { log: [], busy: false };

function viewTutor() {
  const wrap = el('div', { class: 'chat-wrap' });
  const log = el('div', { class: 'chat-log', id: 'chatLog' });

  const hi = el('div', { style: { maxWidth: '860px', marginBottom: '24px' } },
    el('div', { style: { fontSize: '22px', fontWeight: '700', marginBottom: '8px' } }, 'Ask the tutor'),
    el('div', { style: { fontSize: '14.5px', color: 'var(--fg-2)', lineHeight: '1.7' } },
      'The tutor knows your curriculum, your progress, and your measured metrics. Ask it anything: why a talk failed, how to handle a hostile question, what to work on next. It will tell you the truth.'));
  log.appendChild(hi);

  if (chat.log.length === 0) {
    log.appendChild(el('div', { style: { marginTop: '20px', display: 'flex', gap: '9px', flexWrap: 'wrap' } },
      ...[
        'Why do my talks lose the room in the first 90 seconds?',
        'Give me a drill for pausing before a key line.',
        'How do I answer a hostile question without getting defensive?',
        'What should I work on first based on my scores?',
      ].map(q => el('button', {
        class: 'chip',
        onclick: () => { $('#chatInput').value = q; sendChat(); },
      }, q))));
  }

  chat.log.forEach(m => log.appendChild(chatMsgNode(m)));
  wrap.appendChild(log);

  const inputWrap = el('div', { class: 'chat-input' });
  const ta = el('textarea', {
    id: 'chatInput', rows: '1', placeholder: 'Ask about your delivery, your next drill, or a specific scenario...',
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } },
  });
  inputWrap.appendChild(ta);
  inputWrap.appendChild(el('button', { class: 'btn btn-primary', id: 'chatSend', onclick: () => sendChat() }, 'Send'));
  wrap.appendChild(inputWrap);
  return wrap;
}

function chatMsgNode(m) {
  return el('div', { class: `chat-msg ${m.role}` },
    el('div', { class: 'role' }, m.role === 'user' ? 'You' : 'Tutor'),
    el('div', { class: 'bubble', html: m.role === 'user' ? escapeHtml(m.text) : md(m.text) }));
}

async function sendChat() {
  const ta = $('#chatInput');
  const prompt = ta.value.trim();
  if (!prompt || chat.busy) return;
  ta.value = '';
  chat.log.push({ role: 'user', text: prompt });

  const log = $('#chatLog');
  log.appendChild(chatMsgNode({ role: 'user', text: prompt }));
  const respNode = el('div', { class: 'chat-msg model' },
    el('div', { class: 'role' }, 'Tutor'),
    el('div', { class: 'bubble', id: 'streamBubble', 'data-streaming': 'true' }, '<span class="spin"></span>'));
  log.appendChild(respNode);
  log.scrollTop = log.scrollHeight;
  chat.busy = true;
  $('#chatSend').disabled = true;

  const bubble = $('#streamBubble');
  let acc = '';

  try {
    const res = await fetch('/api/tutor/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, moduleId: state.tutorModule || state.moduleId }),
    });
    if (!res.ok || !res.body) throw new Error(`Tutor request failed (${res.status})`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let obj;
        try { obj = JSON.parse(payload); } catch { continue; }
        if (obj.text) {
          acc += obj.text;
          bubble.innerHTML = md(acc);
          log.scrollTop = log.scrollHeight;
        } else if (obj.error) {
          bubble.innerHTML = `<p style="color:var(--rose)">${escapeHtml(obj.error)}</p>`;
        }
      }
    }
  } catch (e) {
    bubble.innerHTML = `<p style="color:var(--rose)">${escapeHtml(e.message)}</p>`;
  } finally {
    bubble.dataset.streaming = 'false';
    chat.log.push({ role: 'assistant', text: acc || '(no response)' });
    chat.busy = false;
    $('#chatSend').disabled = false;
    ta.focus();
  }
}

/* ------------------------------------------------------------------ */
/* Render + boot                                                       */
/* ------------------------------------------------------------------ */

async function render() {
  const main = $('#view');
  main.innerHTML = '';
  let title = 'Dashboard';
  if (state.view === 'module') { title = state.module?.title || 'Module'; main.appendChild(viewModule()); }
  else if (state.view === 'studio') { title = 'Live Coach Studio'; main.appendChild(await viewStudio()); }
  else if (state.view === 'tutor') { title = 'Ask the Tutor'; main.appendChild(viewTutor()); }
  else { title = 'Dashboard'; main.appendChild(viewDashboard()); }
  $('#pageTitle').textContent = title;
}

async function boot() {
  try {
    const health = await api('/api/health');
    state.voices = health.voices || ['Puck'];
    state.defaultVoice = health.defaultVoice || 'Puck';

    const cat = await api('/api/catalogue');
    state.catalogue = cat.modules;
    state.stats = cat.stats;
    state.streak = cat.streak?.streak || 0;
    state.progress = Object.fromEntries(cat.modules.map(m => [m.id, m.progress]).filter(([, v]) => v));

    renderSidebar();
    render();

    $('#streakVal').textContent = state.streak;
    $('#modelVal').textContent = health.models.live;
  } catch (e) {
    $('#view').appendChild(el('div', { class: 'empty' },
      el('div', { class: 'big' }, '⚠'),
      'Could not reach the ORATOR server.',
      el('div', { style: { marginTop: '10px', color: 'var(--fg-3)' } }, e.message)));
  }
}

document.addEventListener('DOMContentLoaded', boot);
