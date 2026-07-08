/* Tideline — a local-first fishing journal.
   All data lives in localStorage on this device. No server, no tracking. */

(() => {
  'use strict';

  const STORE_KEY = 'tideline.sessions.v1';
  const app = document.getElementById('app');

  /* ---------- storage ---------- */
  // Fill in any missing keys so old backups and stored data stay compatible
  // as the model grows (e.g. `coords` added later).
  function normalizeSession(raw) {
    const r = raw || {};
    return {
      id: r.id || uid(),
      type: r.type === 'saltwater' ? 'saltwater' : 'fly',
      date: r.date || '', time: r.time || '', hours: r.hours || '',
      location: r.location || '', water: r.water || '',
      weather: { condition: '', airTemp: '', waterTemp: '', wind: '', pressure: '', flow: '', hatch: '', tide: '', moon: '', ...(r.weather || {}) },
      rig: r.rig || {},
      flies: Array.isArray(r.flies) ? r.flies : [],
      catches: Array.isArray(r.catches) ? r.catches : [],
      reflection: r.reflection || '',
      coords: r.coords && r.coords.lat != null ? { lat: r.coords.lat, lon: r.coords.lon } : null,
    };
  }

  const load = () => {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY));
      return Array.isArray(data) ? data.map(normalizeSession) : [];
    } catch { return []; }
  };
  const save = (s) => localStorage.setItem(STORE_KEY, JSON.stringify(s));

  /* ---------- helpers ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  const nowRounded5 = () => {
    const d = new Date();
    d.setMinutes(Math.round(d.getMinutes() / 5) * 5, 0, 0);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // Moon phase from the date alone — pure math, works offline.
  // Fraction of the synodic month elapsed since a known new moon (2000-01-06 18:14 UTC).
  const SYNODIC = 29.53058867;
  function moonPhase(dateStr) {
    if (!dateStr) return '';
    const t = new Date(dateStr + 'T12:00:00');
    if (isNaN(t)) return '';
    const days = (t - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    const f = (((days % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC;
    if (f < 0.07 || f > 0.93) return 'New';
    if (f >= 0.43 && f <= 0.57) return 'Full';
    return f < 0.5 ? 'Waxing' : 'Waning';
  }

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
  let sessions = load();
  let view = 'log';
  let editingId = null;
  let formType = 'fly';
  let journalQuery = '';
  let journalFilter = 'all';
  let autoMoon = '';      // last auto-suggested moon phase; '' once the user picks one
  let formCoords = null;  // {lat, lon} captured by "Use current conditions"

  /* ============================================================
     LOG / EDIT FORM
  ============================================================ */
  function blankSession() {
    return {
      id: null, type: 'fly', date: new Date().toISOString().slice(0, 10), time: nowRounded5(), hours: '',
      location: '', water: '',
      weather: { condition: '', airTemp: '', waterTemp: '', wind: '', pressure: '', flow: '', hatch: '', tide: '', moon: '' },
      rig: {}, flies: [], catches: [], reflection: '', coords: null,
    };
  }

  // A fresh session carrying over spot + gear from a previous one —
  // anglers revisit the same water with the same setup.
  function prefillFrom(s) {
    return {
      ...blankSession(),
      type: s.type, location: s.location, water: s.water,
      rig: { ...s.rig }, flies: s.flies.map((f) => ({ ...f })),
    };
  }

  /* ---------- derived suggestions ---------- */
  // Datalist suggestions come straight from past sessions (newest first) —
  // nothing extra to store or keep in sync.
  function buildSuggestions() {
    const S = {
      locations: new Set(), waters: new Set(), species: new Set(), flies: new Set(),
      rods: new Set(), reels: new Set(), lines: new Set(), leaders: new Set(),
      methods: new Set(), hatches: new Set(),
    };
    const add = (set, v) => { v = (v || '').trim(); if (v && set.size < 20) set.add(v); };
    sessions.forEach((s) => {
      add(S.locations, s.location); add(S.waters, s.water);
      add(S.rods, s.rig.rod); add(S.reels, s.rig.reel); add(S.lines, s.rig.line);
      add(S.leaders, s.rig.leader); add(S.methods, s.rig.method); add(S.hatches, s.weather.hatch);
      s.flies.forEach((f) => add(S.flies, f.name));
      s.catches.forEach((c) => add(S.species, c.species));
    });
    return Object.fromEntries(Object.entries(S).map(([k, v]) => [k, [...v]]));
  }

  const datalistHTML = (id, values) =>
    `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;

  function flyRow(f = {}) {
    return `<div class="repeat-row flies-row">
      <input class="r-name" aria-label="Fly or lure name" list="dl-fly" placeholder="Fly / lure" value="${esc(f.name)}" />
      <input class="r-size" aria-label="Fly size or color" placeholder="Size / color" value="${esc(f.size)}" />
      <button type="button" class="rm" aria-label="Remove fly">&times;</button>
    </div>`;
  }

  function catchBlock(c = {}) {
    return `<div class="catch-block">
      <div class="repeat-row catch-row">
        <input class="c-species" aria-label="Species" list="dl-species" placeholder="Species" value="${esc(c.species)}" />
        <input class="c-length" aria-label="Length in inches" type="number" inputmode="decimal" step="0.1" placeholder="Length (in)" value="${esc(c.length)}" />
        <input class="c-weight" aria-label="Weight in pounds" type="number" inputmode="decimal" step="0.1" placeholder="Weight (lb)" value="${esc(c.weight)}" />
      </div>
      <div class="catch-extra">
        <label class="field" style="flex:1">
          <input class="c-hit" aria-label="Caught on (fly or lure)" list="hit-options" placeholder="Caught on (fly / lure)" value="${esc(c.hit)}" />
        </label>
        <label class="inline-check"><input type="checkbox" class="c-released" ${c.released ? 'checked' : ''}/> released</label>
        <button type="button" class="rm" aria-label="Remove catch">&times;</button>
      </div>
    </div>`;
  }

  function rigFields(type, rig = {}) {
    if (type === 'fly') {
      return `<div class="grid cols-3">
          <label class="field">Rod weight<input id="rig-rod" list="dl-rod" placeholder="5wt" value="${esc(rig.rod)}" /></label>
          <label class="field">Line<input id="rig-line" list="dl-line" placeholder="WF floating" value="${esc(rig.line)}" /></label>
          <label class="field">Leader / Tippet<input id="rig-leader" list="dl-leader" placeholder="9ft 5X" value="${esc(rig.leader)}" /></label>
        </div>
        <label class="field" style="margin-top:14px">Presentation
          <input id="rig-method" list="dl-method" placeholder="Dry / nymph / streamer / dropper" value="${esc(rig.method)}" /></label>`;
    }
    return `<div class="grid cols-3">
        <label class="field">Rod<input id="rig-rod" list="dl-rod" placeholder="7ft MH" value="${esc(rig.rod)}" /></label>
        <label class="field">Reel<input id="rig-reel" list="dl-reel" placeholder="4000 spin" value="${esc(rig.reel)}" /></label>
        <label class="field">Line<input id="rig-line" list="dl-line" placeholder="20lb braid" value="${esc(rig.line)}" /></label>
      </div>
      <label class="field" style="margin-top:14px">Rig / setup
        <input id="rig-method" list="dl-method" placeholder="Carolina rig / popping cork / jig" value="${esc(rig.method)}" /></label>`;
  }

  function weatherExtra(type, w = {}, date = '') {
    if (type === 'fly') {
      return `<div class="grid cols-2" style="margin-top:14px">
        <label class="field">Flow (CFS)<input id="w-flow" type="number" inputmode="numeric" placeholder="250" value="${esc(w.flow)}" /></label>
        <label class="field">Hatch / bait<input id="w-hatch" list="dl-hatch" placeholder="BWO #18 emergers" value="${esc(w.hatch)}" /></label>
      </div>
      <p class="hint" id="flow-hint" hidden></p>`;
    }
    // Preselect the computed moon phase when none is set; a manual pick sticks.
    let moon = w.moon;
    if (moon) { autoMoon = ''; }
    else { autoMoon = moonPhase(date || new Date().toISOString().slice(0, 10)); moon = autoMoon; }
    return `<div class="grid cols-2" style="margin-top:14px">
      <label class="field">Tide<select id="w-tide">${TIDES.map((t) => `<option ${w.tide === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field">Moon phase<select id="w-moon">${MOONS.map((m) => `<option ${moon === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    </div>`;
  }

  function renderLog(existing) {
    const s = existing || blankSession();
    formType = s.type;
    formCoords = s.coords || null;
    const fliesTitle = () => (formType === 'fly' ? 'Flies' : 'Lures / bait');

    const sug = buildSuggestions();
    const datalists = [
      ['dl-location', sug.locations], ['dl-water', sug.waters], ['dl-species', sug.species],
      ['dl-fly', sug.flies], ['dl-rod', sug.rods], ['dl-reel', sug.reels], ['dl-line', sug.lines],
      ['dl-leader', sug.leaders], ['dl-method', sug.methods], ['dl-hatch', sug.hatches],
    ].map(([id, v]) => datalistHTML(id, v)).join('');

    // Collapsed-panel summaries + open state, computed once at render.
    const w = s.weather;
    const sum = (...parts) => parts.filter(Boolean).join(' · ');
    const wxSum = sum(w.airTemp && `${w.airTemp}°F`, w.condition, w.wind, w.pressure,
      w.waterTemp && `${w.waterTemp}°F water`, w.flow && `${w.flow} cfs`, w.hatch,
      w.tide, w.moon && `${w.moon} moon`);
    const rigSum = sum(s.rig.rod, s.rig.method, s.rig.line);
    const flyCount = s.flies.filter((f) => f.name).length;
    const fliesSum = flyCount ? `${flyCount} pattern${flyCount === 1 ? '' : 's'}` : '';
    const hasWx = Object.values(w).some((v) => v);
    const hasRig = Object.values(s.rig || {}).some((v) => v);

    app.innerHTML = `
      <h2 class="view-title">${editingId ? 'Edit session' : 'Log a session'}</h2>
      <p class="view-sub">Capture conditions while they're fresh — the patterns surface later.</p>

      <form id="session-form">
        ${datalists}
        <div class="panel">
          <h3>Basics</h3>
          <div class="seg" id="type-seg" role="group" aria-label="Session type" style="margin-bottom:16px">
            <button type="button" data-type="fly" class="${s.type === 'fly' ? 'active' : ''}" aria-pressed="${s.type === 'fly'}">Fly</button>
            <button type="button" data-type="saltwater" class="${s.type === 'saltwater' ? 'active' : ''}" aria-pressed="${s.type === 'saltwater'}">Saltwater</button>
          </div>
          ${!editingId && !existing && sessions.length ? '<button type="button" class="add-link" id="repeat-last" style="display:block;margin:-8px 0 12px">↺ Repeat last setup</button>' : ''}
          <div class="grid cols-3">
            <label class="field">Date<input id="f-date" type="date" value="${esc(s.date)}" required /></label>
            <label class="field">Start time<input id="f-time" type="time" value="${esc(s.time)}" /></label>
            <label class="field">Hours fished<input id="f-hours" type="number" inputmode="decimal" step="0.5" placeholder="3" value="${esc(s.hours)}" /></label>
          </div>
          <div class="grid cols-2" style="margin-top:14px">
            <label class="field">Location<input id="f-location" list="dl-location" placeholder="Madison River — Raynolds Pass" value="${esc(s.location)}" /></label>
            <label class="field">Water body<input id="f-water" list="dl-water" placeholder="River / flat / surf / reef" value="${esc(s.water)}" /></label>
          </div>
        </div>

        <details class="panel" ${hasWx ? 'open' : ''}>
          <summary><h3>Weather &amp; water</h3><span class="panel-sum">${esc(wxSum)}</span></summary>
          <button type="button" class="btn ghost sm" id="wx-fill">Use current conditions</button>
          <p class="hint" style="margin:8px 0 16px">Fills weather from your location — online only, everything stays editable.</p>
          <div class="grid cols-3">
            <label class="field">Conditions<input id="w-condition" placeholder="Overcast" value="${esc(s.weather.condition)}" /></label>
            <label class="field">Air °F<input id="w-air" type="number" inputmode="numeric" placeholder="62" value="${esc(s.weather.airTemp)}" /></label>
            <label class="field">Water °F<input id="w-water" type="number" inputmode="numeric" placeholder="54" value="${esc(s.weather.waterTemp)}" /></label>
            <label class="field">Wind<input id="w-wind" placeholder="SW 8mph" value="${esc(s.weather.wind)}" /></label>
            <label class="field">Pressure<select id="w-pressure">${PRESSURES.map((p) => `<option ${s.weather.pressure === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          </div>
          <div id="weather-extra">${weatherExtra(s.type, s.weather, s.date)}</div>
        </details>

        <details class="panel" ${hasRig ? 'open' : ''}>
          <summary><h3>Tackle &amp; rig</h3><span class="panel-sum">${esc(rigSum)}</span></summary>
          <div id="rig-fields">${rigFields(s.type, s.rig)}</div>
        </details>

        <details class="panel" ${flyCount ? 'open' : ''}>
          <summary><h3 id="flies-title">${fliesTitle()}</h3><span class="panel-sum">${esc(fliesSum)}</span></summary>
          <div id="flies-list">${(s.flies.length ? s.flies : [{}]).map(flyRow).join('')}</div>
          <button type="button" class="add-link" id="add-fly">+ add another</button>
        </details>

        <details class="panel" open>
          <summary><h3>Catch log</h3><span class="panel-sum">${s.catches.length ? `${s.catches.length} fish` : ''}</span></summary>
          <datalist id="hit-options"></datalist>
          <div id="catch-list">${s.catches.map(catchBlock).join('')}</div>
          <button type="button" class="add-link" id="add-catch">+ add a catch</button>
          <p class="hint">No fish? Leave it empty — skunked days teach too. Tag what each fish hit to learn your best patterns.</p>
        </details>

        <details class="panel" open>
          <summary><h3>Reflection</h3><span class="panel-sum"></span></summary>
          <p class="hint" style="margin:-8px 0 12px">What worked, what you'd change, how it felt.</p>
          <textarea id="f-reflection" placeholder="Fish keyed on emergers in the riffle. Waited too long to switch — next time change flies after 15 min of refusals…">${esc(s.reflection)}</textarea>
        </details>

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
    // Today's flies first, then patterns from past sessions.
    const names = [...document.querySelectorAll('#flies-list .r-name')]
      .map((i) => i.value.trim()).filter(Boolean);
    dl.innerHTML = [...new Set([...names, ...buildSuggestions().flies])]
      .map((n) => `<option value="${esc(n)}"></option>`).join('');
  }

  function wireForm(s) {
    const form = document.getElementById('session-form');

    document.getElementById('type-seg').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-type]');
      if (!btn) return;
      formType = btn.dataset.type;
      document.querySelectorAll('#type-seg button').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      document.getElementById('rig-fields').innerHTML = rigFields(formType, readRig());
      document.getElementById('weather-extra').innerHTML = weatherExtra(formType, readWeatherExtra(), val('f-date'));
      document.getElementById('flies-title').textContent = formType === 'fly' ? 'Flies' : 'Lures / bait';
    });

    document.getElementById('add-fly').addEventListener('click', () => {
      document.getElementById('flies-list').insertAdjacentHTML('beforeend', flyRow());
    });
    document.getElementById('add-catch').addEventListener('click', () => {
      document.getElementById('catch-list').insertAdjacentHTML('beforeend', catchBlock());
    });

    // Delegate to the form (recreated each render) — listeners on the
    // persistent #app element would accumulate across renders.
    form.addEventListener('input', (e) => {
      if (e.target.classList.contains('r-name')) refreshHitOptions();
    });
    form.addEventListener('click', (e) => {
      if (e.target.classList.contains('rm')) {
        const block = e.target.closest('.catch-block') || e.target.closest('.repeat-row');
        block.remove();
      }
    });

    // Keep the auto-suggested moon phase in step with the date; a manual pick sticks.
    document.getElementById('f-date').addEventListener('change', () => {
      const sel = document.getElementById('w-moon');
      if (sel && autoMoon && sel.value === autoMoon) {
        autoMoon = moonPhase(val('f-date'));
        sel.value = autoMoon;
      }
    });

    const repeat = document.getElementById('repeat-last');
    if (repeat) {
      repeat.addEventListener('click', () => {
        const src = sessions.find((x) => x.type === formType) || sessions[0];
        if (src) { renderLog(prefillFrom(src)); toast('Setup copied from your last session'); }
      });
    }

    wireConditionsButton();

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
      coords: formCoords,
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
     CONDITIONS AUTOFILL  (network — degrades quietly offline)
  ============================================================ */
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('unsupported')); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        reject,
        { timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  function wmoText(code) {
    if (code === 0) return 'Clear';
    if (code <= 2) return 'Partly cloudy';
    if (code === 3) return 'Overcast';
    if (code === 45 || code === 48) return 'Fog';
    if (code >= 51 && code <= 57) return 'Drizzle';
    if (code >= 61 && code <= 67) return 'Rain';
    if (code >= 71 && code <= 77) return 'Snow';
    if (code >= 80 && code <= 82) return 'Showers';
    if (code === 85 || code === 86) return 'Snow showers';
    if (code >= 95) return 'Thunderstorm';
    return '';
  }
  const compass = (deg) =>
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  // Open-Meteo: keyless, CORS-enabled. Pressure trend = now vs ~3h ago.
  async function fetchConditions({ lat, lon }) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl' +
      '&hourly=pressure_msl&past_hours=6&forecast_hours=1' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const d = await res.json();
    const cur = d.current || {};
    const hp = (d.hourly && d.hourly.pressure_msl) || [];
    let pressure = '';
    if (hp.length >= 4 && hp[hp.length - 1] != null && hp[hp.length - 4] != null) {
      const delta = hp[hp.length - 1] - hp[hp.length - 4];
      pressure = delta > 1 ? 'Rising' : delta < -1 ? 'Falling' : 'Steady';
    }
    return {
      airTemp: cur.temperature_2m != null ? String(Math.round(cur.temperature_2m)) : '',
      condition: cur.weather_code != null ? wmoText(cur.weather_code) : '',
      wind: cur.wind_speed_10m != null ? `${compass(cur.wind_direction_10m || 0)} ${Math.round(cur.wind_speed_10m)}mph` : '',
      pressure,
    };
  }

  // USGS instantaneous values: nearest active streamflow gauge within ~10 miles.
  async function fetchFlow({ lat, lon }) {
    const bBox = [(lon - 0.15).toFixed(4), (lat - 0.15).toFixed(4), (lon + 0.15).toFixed(4), (lat + 0.15).toFixed(4)].join(',');
    const res = await fetch(`https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bBox}&parameterCd=00060&siteStatus=active`);
    if (!res.ok) throw new Error(`usgs ${res.status}`);
    const d = await res.json();
    const series = (d.value && d.value.timeSeries) || [];
    let best = null, bestDist = Infinity;
    series.forEach((ts) => {
      const g = ts.sourceInfo && ts.sourceInfo.geoLocation && ts.sourceInfo.geoLocation.geogLocation;
      const v = ts.values && ts.values[0] && ts.values[0].value && ts.values[0].value[0];
      if (!g || !v || v.value == null || Number(v.value) < 0) return; // -999999 = gauge offline
      const dist = (g.latitude - lat) ** 2 + (g.longitude - lon) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = { flow: String(Math.round(Number(v.value))), site: ts.sourceInfo.siteName || '' };
      }
    });
    return best;
  }

  function wireConditionsButton() {
    const btn = document.getElementById('wx-fill');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'Fetching conditions…';
      try {
        const pos = await getPosition();
        formCoords = { lat: +pos.lat.toFixed(4), lon: +pos.lon.toFixed(4) };
        const tasks = [fetchConditions(pos)];
        if (formType === 'fly') tasks.push(fetchFlow(pos));
        const [wx, flow] = await Promise.allSettled(tasks);
        if (wx.status === 'fulfilled') {
          const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
          set('w-air', wx.value.airTemp);
          set('w-condition', wx.value.condition);
          set('w-wind', wx.value.wind);
          set('w-pressure', wx.value.pressure);
        }
        if (flow && flow.status === 'fulfilled' && flow.value) {
          const el = document.getElementById('w-flow');
          if (el && flow.value.flow) el.value = flow.value.flow;
          const hint = document.getElementById('flow-hint');
          if (hint && flow.value.site) { hint.textContent = `Flow from ${flow.value.site}`; hint.hidden = false; }
        }
        toast(wx.status === 'fulfilled'
          ? 'Conditions filled — tweak anything that looks off'
          : 'Weather service unreachable — fill in manually');
      } catch {
        toast('Location unavailable — fill in manually');
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
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
    list.querySelectorAll('[data-again]').forEach((b) =>
      b.addEventListener('click', () => {
        const src = sessions.find((s) => s.id === b.dataset.again);
        if (src) { editingId = null; switchView('log', prefillFrom(src)); toast('Setup copied — new session started'); }
      }));
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
        <button class="btn ghost sm" data-again="${s.id}">Log again</button>
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

    // Heaviest fish wins; among fish with no weight logged, longest wins.
    let biggest = null;
    const better = (a, b) => (num(a.weight) !== num(b.weight)
      ? num(a.weight) > num(b.weight)
      : num(a.length) > num(b.length));
    sessions.forEach((s) => s.catches.forEach((c) => {
      if (num(c.weight) <= 0 && num(c.length) <= 0) return;
      if (!biggest || better(c, biggest)) biggest = c;
    }));
    const bestLabel = biggest
      ? [num(biggest.weight) > 0 && `${esc(biggest.weight)}lb`, num(biggest.length) > 0 && `${esc(biggest.length)}"`]
          .filter(Boolean).join(' · ')
      : '—';

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
        <div class="stat"><div class="num">${bestLabel}</div><div class="lbl">Personal best${biggest && biggest.species ? ` · ${esc(biggest.species)}` : ''}</div></div>
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
        <p class="hint" style="margin-top:-8px">Load a previously exported JSON file. New sessions are added and matching ones updated — nothing is deleted.</p>
        <input type="file" id="import-file" aria-label="Choose a Tideline JSON backup to import" accept="application/json" style="margin-top:8px" />
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
          if (!confirm(`Import ${data.length} session${data.length === 1 ? '' : 's'}? New ones are added, matching ones updated — nothing is deleted.`)) return;
          const { merged, added, updated } = mergeSessions(sessions, data);
          sessions = merged; save(sessions);
          toast(`Imported: ${added} new, ${updated} updated`);
          switchView('journal');
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

  // Dedupe by id (imported version wins — it's a restore), then keep the
  // array newest-first, which the prefill features rely on.
  function mergeSessions(existing, incoming) {
    const map = new Map(existing.map((s) => [s.id, s]));
    let added = 0, updated = 0;
    incoming.forEach((raw) => {
      const s = normalizeSession(raw);
      if (map.has(s.id)) updated++; else added++;
      map.set(s.id, s);
    });
    const merged = [...map.values()]
      .sort((a, b) => ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || '')));
    return { merged, added, updated };
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
      'flies', 'species', 'length', 'weight', 'released', 'caughtOn', 'reflection', 'lat', 'lon'];
    const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const base = (s) => ({
      date: s.date, time: s.time, hours: s.hours, type: s.type, location: s.location, water: s.water,
      condition: s.weather.condition, airTemp: s.weather.airTemp, waterTemp: s.weather.waterTemp,
      wind: s.weather.wind, pressure: s.weather.pressure, flow: s.weather.flow, hatch: s.weather.hatch,
      tide: s.weather.tide, moon: s.weather.moon, rod: s.rig.rod, reel: s.rig.reel, line: s.rig.line,
      leader: s.rig.leader, method: s.rig.method, flies: s.flies.map((f) => f.name).join('; '),
      species: '', length: '', weight: '', released: '', caughtOn: '', reflection: s.reflection,
      lat: s.coords ? s.coords.lat : '', lon: s.coords ? s.coords.lon : '',
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
