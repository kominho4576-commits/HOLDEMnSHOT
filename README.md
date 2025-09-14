# Hold'em&SHOT — PWA + Node WebSocket (v2)

- Keep-Alive: WebSocket ping(20s) + optional HTTP warm-up(60s)
- Footer 문구 정리(슬리더 텍스트 제거)

## 배포 메모
GitHub Pages + Render(WebSocket). 필요 시 index.html 상단에:
```html
<script>window.HS_SERVER_URL='wss://holdemshot.onrender.com';</script>
```
