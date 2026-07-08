# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tideline is a **local-first fishing journal PWA** for fly and saltwater fishing — vanilla HTML/CSS/JS with **no build step, no dependencies, no backend**. All data lives in `localStorage` on the user's device. Deployed to GitHub Pages (`troutbum016/tideline`), installed on iPhone via Safari as an offline home-screen app.

## Run & deploy

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```
A service worker requires `http(s)://` — opening `index.html` as `file://` won't register it (offline/install won't work).

There are no tests, linter, or build. Edit the source files directly; reload the browser.

**Deploy = `git push` to `main`** (GitHub Pages serves the repo root). After changing any cached asset, **bump the `CACHE` const in `service-worker.js`** (e.g. `tideline-v1` → `tideline-v2`) or installed clients keep serving stale files.

All asset paths are **relative** (`./app.js`, `icons/...`) so the app works under the `/tideline/` Pages subpath. Keep them relative.

## Architecture

Five files do everything; there is no framework.

- **`index.html`** — static shell: header with `#tabs` nav, an empty `<main id="app">`, a `#toast` div, and inline service-worker registration. Contains all the PWA/iOS meta tags.
- **`app.js`** — the entire app, one IIFE. Each tab is a `renderX()` function that **replaces `app.innerHTML`** with a template string, then wires event listeners on the freshly-created nodes. `switchView(view, payload)` is the router (called by tab clicks and after saves). State lives in module-scoped vars (`view`, `editingId`, `formType`, `journalQuery`, `journalFilter`) — there is no virtual DOM or reactivity; re-render by calling the render function again.
- **`styles.css`** — warm-light minimalist "tide table & field ledger" theme. All colors are CSS vars in `:root` (primary tide-teal `#2E6E73`, fly-signal terracotta `#C65A4A`, bg `#F4EFE6`). Flat surfaces, hairline borders, no gradients/shadows. `.grid.cols-2/cols-3` collapse to one column under 640px. Inputs use `font-size:16px` to stop iOS zoom-on-focus; `env(safe-area-inset-*)` handles the notch. Non-Basics Log-form panels are native `<details class="panel">` with a `.panel-sum` summary of filled values.
- **`service-worker.js`** — offline app-shell cache. Navigations are network-first → cached `index.html`; **cross-origin GETs (weather/flow APIs) are ignored entirely — never cache live data**; other same-origin GETs are cache-first → network. Precaches the asset list in `ASSETS`.
- **`manifest.json`** + **`icons/`** — PWA manifest and icons. `icons/icon.svg` is the source; PNGs are generated from it.

### Data model

One key: `localStorage['tideline.sessions.v1']` → a JSON array of session objects (newest first). Shape:

```js
session = { id, type:'fly'|'saltwater', date, time, hours, location, water,
  weather:{condition,airTemp,waterTemp,wind,pressure,flow,hatch,tide,moon},
  rig:{rod,reel,line,leader,method}, flies:[{name,size}],
  catches:[{species,length,weight,released,hit}], reflection,
  coords:{lat,lon}|null }   // set by "Use current conditions"; never rendered
```

`normalizeSession(raw)` fills defaults for any missing keys — it runs in `load()` and on import (`mergeSessions`), so old backups always stay loadable. When adding a session field, add its default there too. Import **merges** by id (imported wins); it never deletes.

`hit` = the fly/lure that caught that fish ("caught on"). This field is the backbone of Insights — **changing it breaks effectiveness analytics**. Fields are stored as trimmed strings (numbers included); coerce with the `num()` helper when computing.

### Insights are effectiveness-based, not frequency-based

This is the app's core idea. Insights rank by **fish actually landed**, not how often something was used. Two tally helpers drive everything in `renderInsights()`:
- `fishBySession(keyFn, filter)` — sums `catches.length` per session attribute (best spot, time of day, tide, pressure, rig).
- `fishByCatch(keyFn)` — counts individual catches per catch attribute (top fly via `c.hit`, species).

Time of day comes from `timeOfDay(hhmm)`, which buckets into Dawn/Morning/Midday/Afternoon/Evening/Night (`TIME_BUCKETS`). Saltwater-only insights (tide) are gated by a `filter`.

### Type-aware forms

`type` (`fly` vs `saltwater`) swaps parts of the Log form: `rigFields()` (fly: rod weight/line/leader/presentation; salt: rod/reel/line/rig) and `weatherExtra()` (fly: flow/hatch; salt: tide/moon selects). The `#type-seg` toggle re-renders just those sub-sections in place. The "caught on" `<datalist id="hit-options">` is populated by `refreshHitOptions()` from the flies the user entered plus past sessions' patterns.

### Automation & suggestions

- **Datalists are derived, not stored**: `buildSuggestions()` scans `sessions` at render time for past locations/waters/species/flies/rig values; `renderLog()` emits `<datalist id="dl-*">` blocks inside the form.
- **"Use current conditions"** (`wireConditionsButton()`): geolocation → Open-Meteo (weather, keyless) + USGS NWIS (streamflow, fly only, nearest gauge in a ±0.15° box) via `Promise.allSettled`. Every failure path is a quiet toast; manual entry always works offline. Coords are stashed in `formCoords` and saved on the session.
- **Moon phase** is computed locally in `moonPhase(date)` (synodic-month math, no network) and preselected for saltwater; `autoMoon` tracks the suggestion so a manual pick is never clobbered on date change.
- **Prefill**: `prefillFrom(session)` copies type/location/water/rig/flies into a fresh session (new id on save) — used by Journal "Log again" and the form's "Repeat last setup" link.

## Conventions

- **Always escape user data with `esc()`** when interpolating into template-string HTML — it's the only XSS guard, since everything is `innerHTML`.
- After mutating `sessions`, call `save(sessions)` to persist.
- Regenerating icons: `icons/icon.svg` is the source of truth; render to PNG with headless Chrome and resize with macOS `sips` (no ImageMagick/rsvg in this environment). `curl` is unavailable in the sandbox shell — use `python3 urllib.request` to poll the live URL.
- **Photos are deliberately not implemented** — they'd need IndexedDB (localStorage is too small for images), so don't shoehorn them into the current model.
