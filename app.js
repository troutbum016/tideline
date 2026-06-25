/* Tideline — a local-first fishing journal.
   All data lives in localStorage on this device. No server, no tracking. */

(() => {
  'use strict';

  const STORE_KEY = 'tideline.sessions.v1';
  const app = document.getElementById('app');

  /* ---------- storage ---------- */
  const load = () => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  };
  const save = (s) => localStorage.setItem(STORE_KEY, JSON.stringify(s));
  let sessions = load();

  /* ---------- helpers ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  const TIME_BUCKETS = [
    { key: 'Dawn', from: 4, to: 7 },
    { key: 'Morning', from: 7, to: 11 },
    { key: 'Midday', from: 11, to: 14 },
    { key: 'Afternoon', from: 14, to: 17 },
    { key: 'Evening', from: 17, to: 21 },
    { key: 'Night', from: 21, to: 28 },
  ];
  const timeOfDay = (hhmm) => {
    if (!hhmm) return '';
    let h = parseInt(hhmm.split(':')[0], 10);
    if (h < 4) h += 24;
    const b = TIME_BUCKETS.find((b) => h >= b.from && h < b.to);
    return b ? b.key : '';
  };

  const fmtDate = (d) => {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const toast = (msg) => {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2200);
  };

  const TIDES = ['', 'Incoming', 'High slack', 'Outgoing', 'Low slack'];
  const MOONS = ['', 'New', 'Waxing', 'Full', 'Waning'];
  const PRESSURES = ['', 'Rising', 'Steady', 'Falling'];

  /* ---------- state ---------- */
  let view = 'log';
  let editingId = null;
  let formType = 'fly';
  let journalQuery = '';
  let journalFilter = 'all';

  /* ============================================================
     LOG / EDIT FORM
  ============================================================ */
  function blankSession() {
    return {
      id: null, type: 'fly', date: new Date().toISOString().slice(0, 10), time: '', hours: '',
      location: '', water: '',
      weather: { condition: '', airTemp: '', waterTemp: '', wind: '', pressure: '', flow: '', hatch: '', tide: '', moon: '' },
      rig: {}, flies: [], catches: [], reflection: '',
    };
  }

  function flyRow(f = {}) {
    return `<div class="repeat-row flies-row">
      <input class="r-name" placeholder="Fly / lure" value="${esc(f.name)}" />
      <input class="r-size" placeholder="Size / color" value="${esc(f.size)}" />
      <button type="button" class="rm" aria-label="remove">&times;</button>
    </div>`;
  }

  function catchBlock(c = {}) {
    return `<div class="catch-block">
      <div class="repeat-row catch-row">
        <input class="c-species" placeholder="Species" value="${esc(c.species)}" />
        <input class="c-length" type="number" inputmode="decimal" step="0.1" placeholder="Length (in)" value="${esc(c.length)}" />
        <input class="c-weight" type="number" inputmode="decimal" step="0.1" placeholder="Weight (lb)" value="${esc(c.weight)}" />
      </div>
      <div class="catch-extra">
        <label class="field" style="flex:1">
          <input class="c-hit" list="hit-options" placeholder="Caught on (fly / lure)" value="${esc(c.hit)}" />
        </label>
        <span class="inline-check"><input type="checkbox" class="c-released" ${c.released ? 'checked' : ''}/> released</span>
        <button type="button" class="rm" aria-label="remove">&times;</button>
      </div>
    </div>`;
  }

  function rigFields(type, rig = {}) {
    if (type === 'fly') {
      return `<div class="grid cols-3">
          <label class="field">Rod weight<input id="rig-rod" placeholder="5wt" value="${esc(rig.rod)}" /></label>
          <label class="field">Line<input id="rig-line" placeholder="WF floating" value="${esc(rig.line)}" /></label>
          <label class="field">Leader / Tippet<input id="rig-leader" placeholder="9ft 5X" value="${esc(rig.leader)}" /></label>
        </div>
        <label class="field" style="margin-top:14px">Presentation
          <input id="rig-method" placeholder="Dry / nymph / streamer / dropper" value="${esc(rig.method)}" /></label>`;
    }
    return `<div class="grid cols-3">
        <label class="field">Rod<input id="rig-rod" placeholder="7ft MH" value="${esc(rig.rod)}" /></label>
        <label class="field">Reel<input id="rig-reel" placeholder="4000 spin" value="${esc(rig.reel)}" /></label>
        <label class="field">Line<input id="rig-line" placeholder="20lb braid" value="${esc(rig.line)}" /></label>
      </div>
      <label class="field" style="margin-top:14px">Rig / setup
        <input id="rig-method" placeholder="Carolina rig / popping cork / jig" value="${esc(rig.method)}" /></label>`;
  }

  function weatherExtra(type, w = {}) {
    if (type === 'fly') {
      return `<div class="grid cols-2" style="margin-top:14px">
        <label class="field">Flow (CFS)<input id="w-flow" type="number" inputmode="numeric" placeholder="250" value="${esc(w.flow)}" /></label>
        <label class="field">Hatch / bait<input id="w-hatch" placeholder="BWO #18 emergers" value="${esc(w.hatch)}" /></label>
      </div>`;
    }
    return `<div class="grid cols-2" style="margin-top:14px">
      <label class="field">Tide<select id="w-tide">${TIDES.map((t) => `<option ${w.tide === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field">Moon phase<select id="w-moon">${MOONS.map((m) => `<option ${w.moon === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    </div>`;
  }

  function renderLog(existing) {
    const s = existing || blankSession();
    formType = s.type;
    const fliesTitle = () => (formType === 'fly' ? 'Flies' : 'Lures / bait');

    app.innerHTML = `
      <h2 class="view-title">${editingId ? 'Edit session' : 'Log a session'}</h2>
      <p class="view-sub">Capture conditions while they're fresh — the patterns surface later.</p>

      <form id="session-form">
        <div class="panel">
          <h3>Basics</h3>
          <div class="seg" id="type-seg" style="margin-bottom:16px">
            <button type="button" data-type="fly" class="${s.type === 'fly' ? 'active' : ''}">Fly</button>
            <button type="button" data-type="saltwater" class="${s.type === 'saltwater' ? 'active' : ''}">Saltwater</button>
          </div>
          <div class="grid cols-3">
            <label class="field">Date<input id="f-date" type="date" value="${esc(s.date)}" required /></label>
            <label class="field">Start time<input id="f-time" type="time" value="${esc(s.time)}" /></label>
            <label class="field">Hours fished<input id="f-hours" type="number" inputmode="decimal" step="0.5" placeholder="3" value="${esc(s.hours)}" /></label>
          </div>
          <div class="grid cols-2" style="margin-top:14px">
            <label class="field">Location<input id="f-location" placeholder="Madison River — Raynolds Pass" value="${esc(s.location)}" /></label>
            <label class="field">Water body<input id="f-water" placeholder="River / flat / surf / reef" value="${esc(s.water)}" /></label>
          </div>
        </div>

        <div class="panel">
          <h3>Weather &amp; water</h3>
          <div class="grid cols-3">
            <label class="field">Conditions<input id="w-condition" placeholder="Overcast" value="${esc(s.weather.condition)}" /></label>
            <label class="field">Air °F<input id="w-air" type="number" inputmode="numeric" placeholder="62" value="${esc(s.weather.airTemp)}" /></label>
            <label class="field">Water °F<input id="w-water" type="number" inputmode="numeric" placeholder="54" value="${esc(s.weather.waterTemp)}" /></label>
            <label class="field">Wind<input id="w-wind" placeholder="SW 8mph" value="${esc(s.weather.wind)}" /></label>
            <label class="field">Pressure<select id="w-pressure">${PRESSURES.map((p) => `<option ${s.weather.pressure === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          </div>
          <div id="weather-extra">${weatherExtra(s.type, s.weather)}</div>
        </div>

        <div class="panel">
          <h3>Tackle &amp; rig</h3>
          <div id="rig-fields">${rigFields(s.type, s.rig)}</div>
        </div>

        <div class="panel">
          <h3 id="flies-title">${fliesTitle()}</h3>
          <div id="flies-list">${(s.flies.length ? s.flies : [{}]).map(flyRow).join('')}</div>
          <button type="button" class="add-link" id="add-fly">+ add another</button>
        </div>

        <div class="panel">
          <h3>Catch log</h3>
          <datalist id="hit-options"></datalist>
          <div id="catch-list">${s.catches.map(catchBlock).join('')}</div>
          <button type="button" class="add-link" id="add-catch">+ add a catch</button>
          <p class="hint">No fish? Leave it empty — skunked days teach too. Tag what each fish hit to learn your best patterns.</p>
        </div>

        <div class="panel">
          <h3>Reflection</h3>
          <p class="hint" style="margin:-8px 0 12px">What worked, what you'd change, how it felt.</p>
          <textarea id="f-reflection" placeholder="Fish keyed on emergers in the riffle. Waited too long to switch — next time change flies after 15 min of refusals...">${esc(s.reflection)}</textarea>
        </div>

        <div class="btn-row">
          <button type="submit" class="btn">${editingId ? 'Save changes' : 'Save session'}</button>
          ${editingId ? '<button type="button" class="btn ghost" id="cancel-edit">Cancel</button>' : ''}
        </div>
      </form>`;

    wireForm(s);
    refreshHitOptions();
  }

  function refreshHitOptions() {
    const dl = document.getElementById('hit-options');
    if (!dl) return;
    const names = [...document.querySelectorAll('#flies-list .r-name')]
      .map((i) => i.value.trim()).filter(Boolean);
    dl.innerHTML = [...new Set(names)].map((n) => `<option value="${esc(n)}"></option>`).join('');
  }

  function wireForm(s) {
    const form = document.getElementById('session-form');

    document.getElementById('type-seg').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-type]');
      if (!btn) return;
      formType = btn.dataset.type;
      document.querySelectorAll('#type-seg button').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('rig-fields').innerHTML = rigFields(formType, readRig());
      document.getElementById('weather-extra').innerHTML = weatherExtra(formType, readWeatherExtra());
      document.getElementById('flies-title').textContent = formType === 'fly' ? 'Flies' : 'Lures / bait';
    });

    document.getElementById('add-fly').addEventListener('click', () => {
      document.getElementById('flies-list').insertAdjacentHTML('beforeend', flyRow());
    });
    document.getElementById('add-catch').addEventListener('click', () => {
      document.getElementById('catch-list').insertAdjacentHTML('beforeend', catchBlock());
    });

    app.addEventListener('input', (e) => {
      if (e.target.classList.contains('r-name')) refreshHitOptions();
    });
    app.addEventListener('click', (e) => {
      if (e.target.classList.contains('rm')) {
        const block = e.target.closest('.catch-block') || e.target.closest('.repeat-row');
        block.remove();
      }
    });

    if (editingId) {
      document.getElementById('cancel-edit').addEventListener('click', () => { editingId = null; renderLog(); });
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); saveFromForm(s.id); });
  }

  const val = (id) => (document.getElementById(id)?.value || '').trim();
  function readRig() {
    return { rod: val('rig-rod'), reel: val('rig-reel'), line: val('rig-line'), leader: val('rig-leader'), method: val('rig-method') };
  }
  function readWeatherExtra() {
    return { flow: val('w-flow'), hatch: val('w-hatch'), tide: val('w-tide'), moon: val('w-moon') };
  }

  function saveFromForm(id) {
    const flies = [...document.querySelectorAll('#flies-list .repeat-row')]
      .map((r) => ({ name: r.querySelector('.r-name').value.trim(), size: r.querySelector('.r-size').value.trim() }))
      .filter((f) => f.name);

    const catches = [...document.querySelectorAll('#catch-list .catch-block')]
      .map((b) => ({
        species: b.querySelector('.c-species').value.trim(),
        length: b.querySelector('.c-length').value.trim(),
        weight: b.querySelector('.c-weight').value.trim(),
        hit: b.querySelector('.c-hit').value.trim(),
        released: b.querySelector('.c-released').checked,
      }))
      .filter((c) => c.species || c.length || c.weight || c.hit);

    const ex = readWeatherExtra();
    const session = {
      id: id || uid(),
      type: formType,
      date: val('f-date'), time: val('f-time'), hours: val('f-hours'),
      location: val('f-location'), water: val('f-water'),
      weather: {
        condition: val('w-condition'), airTemp: val('w-air'), waterTemp: val('w-water'),
        wind: val('w-wind'), pressure: val('w-pressure'),
        flow: ex.flow, hatch: ex.hatch, tide: ex.tide, moon: ex.moon,
      },
      rig: readRig(), flies, catches, reflection: val('f-reflection'),
    };

    if (id) {
      sessions[sessions.findIndex((x) => x.id === id)] = session;
      toast('Session updated');
    } else {
      sessions.unshift(session);
      toast('Session logged');
    }
    save(sessions);
    editingId = null;
    switchView('journal');
  }

  /* ============================================================
     JOURNAL
  ============================================================ */
  function renderJournal() {
    if (!sessions.length) {
      app.innerHTML = emptyState('No sessions yet', 'Log your first day on the water to start your journal.');
      return;
    }
    app.innerHTML = `
      <h2 class="view-title">Journal</h2>
      <p class="view-sub">${sessions.length} session${sessions.length > 1 ? 's' : ''} logged.</p>
      <div class="toolbar">
        <input id="j-search" placeholder="Search location, species, fly…" value="${esc(journalQuery)}" />
        <select id="j-filter">
          ${[['all', 'All types'], ['fly', 'Fly'], ['saltwater', 'Saltwater']].map(([v, l]) =>
            `<option value="${v}" ${journalFilter === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div id="journal-list"></div>`;

    const search = document.getElementById('j-search');
    search.addEventListener('input', () => { journalQuery = search.value; renderJournalList(); });
    document.getElementById('j-filter').addEventListener('change', (e) => { journalFilter = e.target.value; renderJournalList(); });
    renderJournalList();
  }

  function matchesQuery(s, q) {
    if (!q) return true;
    const hay = [s.location, s.water, s.type, s.reflection,
      ...s.flies.map((f) => f.name),
      ...s.catches.map((c) => `${c.species} ${c.hit}`)].join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function renderJournalList() {
    const list = document.getElementById('journal-list');
    const items = sessions
      .filter((s) => journalFilter === 'all' || s.type === journalFilter)
      .filter((s) => matchesQuery(s, journalQuery))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

    if (!items.length) {
      list.innerHTML = `<p class="muted" style="padding:20px 0">No sessions match.</p>`;
      return;
    }
    list.innerHTML = items.map(entryCard).join('');
    list.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => { editingId = b.dataset.edit; switchView('log', sessions.find((s) => s.id === editingId)); }));
    list.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        if (confirm('Delete this session? This cannot be undone.')) {
          sessions = sessions.filter((s) => s.id !== b.dataset.del);
          save(sessions); toast('Session deleted'); renderJournalList();
        }
      }));
  }

  function entryCard(s) {
    const w = s.weather;
    const flyChips = s.flies.map((f) =>
      `<span class="chip">${esc(f.name)}${f.size ? ` <span class="muted">${esc(f.size)}</span>` : ''}</span>`).join('');
    const catchChips = s.catches.map((c) => {
      const dims = [c.length && `${esc(c.length)}"`, c.weight && `${esc(c.weight)}lb`].filter(Boolean).join(', ');
      const on = c.hit ? ` · ${esc(c.hit)}` : '';
      return `<span class="chip catch">${esc(c.species || 'Fish')}${dims ? ` — ${dims}` : ''}${on}${c.released ? ' · released' : ''}</span>`;
    }).join('');

    const wx = [w.condition, w.airTemp && `${esc(w.airTemp)}°F air`, w.waterTemp && `${esc(w.waterTemp)}°F water`,
      w.wind && `wind ${esc(w.wind)}`, w.pressure && `${esc(w.pressure)} pressure`,
      w.flow && `${esc(w.flow)} cfs`, w.tide, w.moon && `${esc(w.moon)} moon`, w.hatch]
      .filter(Boolean).map(esc).join(' · ');
    const rig = [s.rig.rod, s.rig.method, s.rig.line].filter(Boolean).map(esc).join(' · ');
    const meta = [fmtDate(s.date), s.time && `${esc(s.time)}${timeOfDay(s.time) ? ` (${timeOfDay(s.time)})` : ''}`,
      s.hours && `${esc(s.hours)}h`].filter(Boolean).join(' · ');

    return `<article class="entry">
      <div class="entry-head">
        <div>
          <p class="entry-title">${esc(s.location || s.water || 'Untitled session')}</p>
          <p class="entry-meta">${meta}</p>
        </div>
        <span class="badge ${s.type === 'fly' ? 'fly' : 'salt'}">${s.type === 'fly' ? 'Fly' : 'Saltwater'}</span>
      </div>
      ${wx ? `<p class="entry-meta" style="margin-top:10px">${wx}</p>` : ''}
      ${rig ? `<p class="entry-meta" style="margin-top:4px">${rig}</p>` : ''}
      ${flyChips ? `<div class="chips">${flyChips}</div>` : ''}
      ${catchChips ? `<div class="chips">${catchChips}</div>` : `<p class="entry-meta" style="margin-top:10px">No fish recorded.</p>`}
      ${s.reflection ? `<div class="entry-reflection">${esc(s.reflection)}</div>` : ''}
      <div class="entry-actions">
        <button class="btn ghost sm" data-edit="${s.id}">Edit</button>
        <button class="btn warn sm" data-del="${s.id}">Delete</button>
      </div>
    </article>`;
  }

  /* ============================================================
     INSIGHTS  (effectiveness, not just frequency)
  ============================================================ */
  // sum of fish, keyed by a per-session attribute
  function fishBySession(keyFn, filter = () => true) {
    const m = new Map();
    sessions.filter(filter).forEach((s) => {
      const k = keyFn(s);
      if (!k) return;
      m.set(k, (m.get(k) || 0) + s.catches.length);
    });
    return [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  }
  // count of catches, keyed by a per-catch attribute
  function fishByCatch(keyFn) {
    const m = new Map();
    sessions.forEach((s) => s.catches.forEach((c) => {
      const k = keyFn(c, s);
      if (!k) return;
      m.set(k, (m.get(k) || 0) + 1);
    }));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  function barList(pairs, unit = '') {
    if (!pairs.length) return '<p class="muted">Not enough data yet.</p>';
    const max = pairs[0][1] || 1;
    return `<div class="bar-list">${pairs.slice(0, 8).map(([label, n]) => `
      <div class="bar-item">
        <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.max(5, (n / max) * 100)}%"></span></span>
        <span class="bar-val">${n}${unit}</span>
      </div>`).join('')}</div>`;
  }

  function renderInsights() {
    if (!sessions.length) {
      app.innerHTML = emptyState('No insights yet', 'Log a few sessions and patterns in your fishing surface here.');
      return;
    }

    const totalFish = sessions.reduce((n, s) => n + s.catches.length, 0);
    const productive = sessions.filter((s) => s.catches.length > 0).length;
    const catchRate = Math.round((productive / sessions.length) * 100);

    const totalHours = sessions.reduce((n, s) => n + num(s.hours), 0);
    const fishInHourSessions = sessions.filter((s) => num(s.hours) > 0).reduce((n, s) => n + s.catches.length, 0);
    const perHour = totalHours > 0 ? (fishInHourSessions / totalHours) : null;

    let biggest = null;
    sessions.forEach((s) => s.catches.forEach((c) => {
      const score = num(c.weight) * 100 + num(c.length);
      if (score > 0 && (!biggest || score > biggest.score)) biggest = { ...c, score };
    }));

    const effFlies = fishByCatch((c) => c.hit);
    const spots = fishBySession((s) => s.location || s.water);
    const tod = fishBySession((s) => timeOfDay(s.time));
    const pressure = fishBySession((s) => s.weather.pressure);
    const conditions = fishBySession((s) => s.weather.condition);
    const tide = fishBySession((s) => s.weather.tide, (s) => s.type === 'saltwater');
    const rigs = fishBySession((s) => s.rig.method);
    const species = fishByCatch((c) => c.species);

    const top = (arr) => (arr.length ? arr[0] : null);
    const working = [];
    const tEff = top(effFlies); if (tEff) working.push(['Top pattern', `<strong>${esc(tEff[0])}</strong> — ${tEff[1]} fish`]);
    const tSpot = top(spots); if (tSpot) working.push(['Best spot', `<strong>${esc(tSpot[0])}</strong> — ${tSpot[1]} fish`]);
    const tTod = top(tod); if (tTod) working.push(['Best time', `<strong>${esc(tTod[0])}</strong> — ${tTod[1]} fish`]);
    const tTide = top(tide); if (tTide) working.push(['Best tide', `<strong>${esc(tTide[0])}</strong> — ${tTide[1]} fish`]);
    const tPres = top(pressure); if (tPres) working.push(['Best pressure', `<strong>${esc(tPres[0])}</strong> — ${tPres[1]} fish`]);
    if (perHour !== null) working.push(['Catch rate', `<strong>${perHour.toFixed(1)}</strong> fish / hour`]);

    app.innerHTML = `
      <h2 class="view-title">Insights</h2>
      <p class="view-sub">What the water has been teaching you.</p>

      <div class="stat-grid">
        <div class="stat"><div class="num">${sessions.length}</div><div class="lbl">Sessions</div></div>
        <div class="stat"><div class="num">${totalFish}</div><div class="lbl">Fish landed</div></div>
        <div class="stat"><div class="num">${catchRate}%</div><div class="lbl">Days with a catch</div></div>
        <div class="stat"><div class="num">${perHour !== null ? perHour.toFixed(1) : '—'}</div><div class="lbl">Fish per hour</div></div>
        <div class="stat"><div class="num">${biggest ? `${biggest.weight || biggest.length}${biggest.weight ? 'lb' : '"'}` : '—'}</div><div class="lbl">Personal best${biggest && biggest.species ? ` · ${esc(biggest.species)}` : ''}</div></div>
      </div>

      ${working.length ? `<div class="panel">
        <h3>What's working</h3>
        <div class="working">${working.map(([k, v]) => `<div class="working-item"><span class="k">${k}</span><span>${v}</span></div>`).join('')}</div>
      </div>` : ''}

      <div class="grid cols-2">
        <div class="panel"><h3>Most effective flies &amp; lures</h3>${barList(effFlies, ' fish')}
          <p class="hint">Ranked by fish actually caught on each — tag “caught on” when you log.</p></div>
        <div class="panel"><h3>Most productive spots</h3>${barList(spots, ' fish')}</div>
        <div class="panel"><h3>Best time of day</h3>${barList(tod, ' fish')}</div>
        <div class="panel"><h3>Species caught</h3>${barList(species, '')}</div>
        ${tide.length ? `<div class="panel"><h3>Best tide (saltwater)</h3>${barList(tide, ' fish')}</div>` : ''}
        <div class="panel"><h3>Pressure that produces</h3>${barList(pressure, ' fish')}</div>
        <div class="panel"><h3>Conditions that produce</h3>${barList(conditions, ' fish')}</div>
        <div class="panel"><h3>Most productive rigs</h3>${barList(rigs, ' fish')}</div>
      </div>`;
  }

  /* ============================================================
     REFLECTIVE POND
  ============================================================ */
  const PROMPTS = [
    'When did you feel most in tune with the water today?',
    'What did the fish teach you that you didn\'t know this morning?',
    'What would you do differently in the first hour next time?',
    'Which small detail — a seam, a shadow, a tide line — mattered most?',
    'What are you grateful for from this session, fish or no fish?',
  ];

  function renderPond() {
    const reflections = sessions.filter((s) => s.reflection).sort((a, b) => b.date.localeCompare(a.date));
    const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

    app.innerHTML = `
      <h2 class="view-title">Reflective Pond</h2>
      <p class="view-sub">Still water. Look back, and let the sessions settle.</p>
      <div class="pond">
        <p class="pond-prompt">${esc(prompt)}</p>
        <p class="muted" style="font-size:14px;margin:0">Reflections you write while logging gather here. Revisit them before your next trip — your past self is often your best guide.</p>
      </div>
      ${reflections.length
        ? `<div class="panel">${reflections.map((s) => `
            <div class="reflection-card">
              <div class="reflection-date">${fmtDate(s.date)} · ${esc(s.location || s.water || 'On the water')}
                <span class="badge ${s.type === 'fly' ? 'fly' : 'salt'}">${s.type === 'fly' ? 'Fly' : 'Saltwater'}</span></div>
              <div class="reflection-text">${esc(s.reflection)}</div>
            </div>`).join('')}</div>`
        : emptyState('Calm water', 'Add a reflection when you log a session and it will surface here.')}`;
  }

  /* ============================================================
     BACKUP
  ============================================================ */
  function renderBackup() {
    app.innerHTML = `
      <h2 class="view-title">Backup &amp; data</h2>
      <p class="view-sub">Your journal lives only in this browser. Export regularly so you never lose a season.</p>
      <div class="panel">
        <h3>Export</h3>
        <p class="hint" style="margin-top:-8px">Download all ${sessions.length} session${sessions.length === 1 ? '' : 's'}.</p>
        <div class="btn-row"><button class="btn" id="export-json">Download JSON</button><button class="btn ghost" id="export-csv">Download CSV</button></div>
      </div>
      <div class="panel">
        <h3>Import</h3>
        <p class="hint" style="margin-top:-8px">Load a previously exported JSON file. This <strong>replaces</strong> your current data.</p>
        <input type="file" id="import-file" accept="application/json" style="margin-top:8px" />
      </div>
      <div class="panel">
        <h3>Danger zone</h3>
        <div class="btn-row"><button class="btn warn" id="wipe-btn">Erase all data</button></div>
      </div>`;

    document.getElementById('export-json').addEventListener('click', () => {
      downloadFile(JSON.stringify(sessions, null, 2), `tideline-backup-${today()}.json`, 'application/json');
      toast('JSON downloaded');
    });
    document.getElementById('export-csv').addEventListener('click', () => {
      downloadFile(toCSV(sessions), `tideline-${today()}.csv`, 'text/csv');
      toast('CSV downloaded');
    });
    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data)) throw new Error('bad');
          if (!confirm(`Import ${data.length} sessions? This replaces your current journal.`)) return;
          sessions = data; save(sessions); toast('Journal imported'); switchView('journal');
        } catch { alert('That file could not be read as a Tideline backup.'); }
      };
      reader.readAsText(file);
    });
    document.getElementById('wipe-btn').addEventListener('click', () => {
      if (confirm('Erase ALL sessions permanently? Consider exporting a backup first.')) {
        sessions = []; save(sessions); toast('All data erased'); renderBackup();
      }
    });
  }

  const today = () => new Date().toISOString().slice(0, 10);
  function downloadFile(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  function toCSV(data) {
    const cols = ['date', 'time', 'hours', 'type', 'location', 'water', 'condition', 'airTemp', 'waterTemp',
      'wind', 'pressure', 'flow', 'hatch', 'tide', 'moon', 'rod', 'reel', 'line', 'leader', 'method',
      'flies', 'species', 'length', 'weight', 'released', 'caughtOn', 'reflection'];
    const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const base = (s) => ({
      date: s.date, time: s.time, hours: s.hours, type: s.type, location: s.location, water: s.water,
      condition: s.weather.condition, airTemp: s.weather.airTemp, waterTemp: s.weather.waterTemp,
      wind: s.weather.wind, pressure: s.weather.pressure, flow: s.weather.flow, hatch: s.weather.hatch,
      tide: s.weather.tide, moon: s.weather.moon, rod: s.rig.rod, reel: s.rig.reel, line: s.rig.line,
      leader: s.rig.leader, method: s.rig.method, flies: s.flies.map((f) => f.name).join('; '),
      species: '', length: '', weight: '', released: '', caughtOn: '', reflection: s.reflection,
    });
    const rows = [];
    data.forEach((s) => {
      if (!s.catches.length) { rows.push(base(s)); return; }
      s.catches.forEach((c) => rows.push({ ...base(s),
        species: c.species, length: c.length, weight: c.weight, released: c.released ? 'yes' : 'no', caughtOn: c.hit }));
    });
    return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
  }

  /* ---------- shared ---------- */
  function emptyState(title, sub) {
    return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`;
  }

  /* ============================================================
     ROUTER
  ============================================================ */
  function switchView(v, payload) {
    view = v;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    window.scrollTo({ top: 0 });
    if (v === 'log') renderLog(payload);
    else if (v === 'journal') renderJournal();
    else if (v === 'insights') renderInsights();
    else if (v === 'pond') renderPond();
    else if (v === 'backup') renderBackup();
  }

  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    if (btn.dataset.view !== 'log') editingId = null;
    switchView(btn.dataset.view);
  });

  switchView('log');
})();
