# Hold’em&SHOT (.io) — PWA + Server (with AI bot)

## 폴더 구조
```
/ (GitHub Pages에 올릴 정적 파일)
  index.html
  client.js
  manifest.json
  sw.js
  /icons
    icon-192.png
    icon-512.png

server.js  # Node.js WebSocket 서버 (Render/Fly/Railway/Glitch 등 배포)
```

## 실행(로컬)
### 서버
```bash
npm i ws
node server.js
```
- 기본 포트: `8080`
- WS 엔드포인트: `ws://localhost:8080/ws`

### 프런트
정적 서버가 필요합니다. (예:)
```bash
npx serve .
# 또는 python -m http.server 5173
```
브라우저에서 `http://localhost:3000` 등의 정적 서버 주소로 접속.

> **WS 자동 연결 규칙**  
> `client.js`는 기본적으로 **동일 도메인 `/ws`** 에 WebSocket을 연결하려고 시도합니다.  
> - 리버스 프록시(nginx, Cloudflare 등)에서 `/ws → 서버의 ws` 로 프록시하면 자동 연결됩니다.  
> - 프록시가 없다면, `index.html`에 아래 스니펫을 추가하여 명시적으로 설정하세요.
>   ```html
>   <script>window.WS_URL = "wss://YOUR-SERVER-DOMAIN/ws";</script>
>   ```

## GitHub Pages 배포(PWA)
- 이 레포지토리의 `index.html`, `client.js`, `manifest.json`, `sw.js`, `icons/`만 커밋 → GitHub Pages 활성화
- Pages는 **정적 호스팅**만 제공하므로 **`server.js`는 별도 호스팅**이 필요합니다.  
  (Render, Railway, Fly.io, Cloudflare(Workers+Durable Objects/WS), Glitch 등)

## 서버 배포(예: Render)
1. 새 Web Service → Node
2. Start Command: `node server.js`
3. 포트 환경변수: Render가 자동으로 설정
4. 배포 후, 프런트의 `WS_URL`을 해당 도메인 `/ws`로 지정

## AI 봇
- 빠른매칭 또는 방 생성 후 **3초 이내**에 상대가 없으면 **서버가 봇을 자동 투입**합니다.
- 교환 페이즈에서 **낮은 싱글 카드부터 최대 2장** 교환(조커는 유지)하는 간단 전략.

## PWA
- `manifest.json`과 `sw.js`가 포함되어 있어 **홈 화면 설치** 가능
- 오프라인 시에는 캐시된 `index.html`을 보여줍니다(서버 기능은 오프라인에서 제한).

## 광고 배너
- 상단 `#banner` 영역은 고정 높이로 예약 (레이아웃 안정)  
- 실제 광고 스크립트는 배포 후 공급사 코드 삽입

## 규칙
- 조커: 패자가 보유시 러시안룰렛 면제 / 승자가 보유시 패자 발사 1회 추가
- 라운드: FLOP → TURN → RIVER마다 교환 페이즈를 거쳐 SHOWDOWN → ROULETTE → 생존/사망 판정
