
# Hold’em & SHOT – PWA Starter

This is a production-ready PWA scaffold tailored to your spec:

- **Quick Match** with 8s fallback to **AI** when matchmaking doesn't resolve
- **Create / Join Room** stubs wired for your Render backend
- **Offline-first**: app shell cached, HTML network-first with offline fallback
- iOS-friendly (prevents input zoom by using 16px+ inputs and viewport hints)

## Deploy (GitHub Pages + Render)

1) **Frontend (this repo)**
- Push these files to a public GitHub repo
- Enable **GitHub Pages** (root or `/docs`)

2) **Backend (Render)**
- Create a web service on Render and expose endpoints:
  - `GET /health` → 200 OK JSON
  - `POST /matchmake` → `{ roomId }` when matched
  - `POST /rooms` → `{ code }`
  - `POST /rooms/:code/join` → 200 OK if joined

3) **Point API_BASE**
- In `app.js`, set `API_BASE` to your Render URL.

4) **PWA install test**
- Visit the site on Chrome/Edge mobile/desktop → "Install app" prompt or Add to Home Screen.

## Notes
- Service worker uses **cache-busting** via versioned `CACHE` key. Bump it on release.
- To avoid iOS zoom on inputs, font-size is ≥16px.
