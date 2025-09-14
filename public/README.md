
# Hold’em & SHOT – Fullstack (Single Render Service)

This project runs **both** the PWA frontend and the matchmaking API on one Express server.

## Deploy on Render
1) New → **Web Service**
2) Repo/Upload this folder
3) **Build Command:** `npm install`
4) **Start Command:** `npm start`
5) After deploy: open the URL → PWA loads, API available at same origin.

## Endpoints
- `GET /health`
- `POST /matchmake { nickname }` → pairs users within 8s or returns `{ ai:true }`
- `POST /rooms` → `{ code, roomId }`
- `POST /rooms/:code/join` → 200 with `{ roomId }`

PWA static files are served from `/public`. Service worker caches the app shell.
