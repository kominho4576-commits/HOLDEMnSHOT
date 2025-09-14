# Hold'em&SHOT — PWA + Node WebSocket

> 1v1 Texas Hold'em + 러시안룰렛. Quick Match(8초) 후 AI 자동 매칭, 조커 효과, 교환/Ready 게이팅.

## 구조

```
holdemshot_pwa/
 ├─ index.html        # PWA 클라이언트(홈/연결/룸/게임 + 러시안룰렛 캔버스)
 ├─ client.js
 ├─ manifest.json
 ├─ sw.js
 ├─ icons/
 │    ├─ icon-192.png
 │    └─ icon-512.png
 ├─ server.js         # Node WebSocket 서버(rooms, quick, AI, 라운드/교환/쇼다운/러시안룰렛)
 ├─ package.json
 └─ README.md
```

## 배포

### 1) GitHub Pages (클라이언트)
- 레포 루트에 위 파일들 업로드
- Settings → Pages → Branch: `main` / root 선택
- `index.html`, `client.js`, `manifest.json`, `sw.js`, `icons/*` 포함

### 2) Render (서버)
- 새 Web Service → `Node` → Start Command: `node server.js`
- 포트 환경변수는 Render 기본 지원 (PORT)
- 배포 후 `wss://YOUR-RENDER.onrender.com` 주소 획득

### 3) 클라이언트에서 서버 주소 지정 (옵션)
- GitHub Pages 도메인이 서버가 아니라면, `index.html` 위쪽에 다음 스니펫 추가:

```html
<script>
  window.HS_SERVER_URL = 'wss://YOUR-RENDER.onrender.com';
</script>
```

## 게임 규칙 반영
- 카드: 54장(조커 2)
- 각 페이즈별(Flop/Turn/River) **양쪽 모두 Ready** 시 진행
- 각자 **0~2장 교환** 가능
- 쇼다운 후 승패 → 패자는 러시안룰렛
- 조커: **패자가 조커 보유 시 면제**, **승자가 조커 보유 시 상대 총알 +1**
- 러시안룰렛: 게임 시작 시 선택한 **1~3발**, 무작위 슬롯. `BANG!`이면 즉사로 게임 종료, `SAFE`면 다음 라운드

## 로컬 테스트
```bash
# 1) 서버
npm i
node server.js

# 2) 클라이언트
# VSCode Live Server 또는 간단한 HTTP 서버로 ./ 를 서빙
# (service worker 사용 시 file:// 직접 열기 X)
```

## 참고
- 포커 평가는 7장 중 베스트 5장 조합을 찾는 간단한 랭커 내장.
- 조커는 표준 규칙 외 카드이므로 평가에서 제외(밸런싱 편의).
