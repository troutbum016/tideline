# Tideline 🎣

A minimalist, offline-first journal for **fly & saltwater fishing**. Log conditions, tackle,
and catches; reflect on each session; and let the **Insights** surface what's actually working.

- **Local-first** — all data stays in your browser (`localStorage`). No server, no account, no tracking.
- **Installable PWA** — add it to your phone's home screen and use it offline on the water.
- **Effectiveness, not just frequency** — catches are tagged with the fly/lure that hit, so Insights
  rank patterns by fish landed, plus best spot, time of day, tide, and pressure.

## Run locally

Open `index.html` in a browser, or serve it:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

(A service worker is needed for offline install, which requires `http(s)://` — not `file://`.)

## Deploy (GitHub Pages)

```bash
git remote add origin https://github.com/<you>/tideline.git
git push -u origin main
# then: repo Settings → Pages → Build from branch → main / root
```

Your app will be live at `https://<you>.github.io/tideline/`.

## Install on iPhone

Open the URL in **Safari** → Share → **Add to Home Screen**. It then launches full-screen and
works with no signal. (iOS only installs PWAs from Safari, not Chrome.)

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell + PWA meta |
| `styles.css` | Minimalist warm theme |
| `app.js` | All views & logic |
| `manifest.json` | PWA manifest |
| `service-worker.js` | Offline app-shell cache |
| `icons/` | App icons |
