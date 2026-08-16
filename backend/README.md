# Roku Substack companion backend

Express app for Substack email OTP / cookie paste, device pairing, and a Roku catalog feed.

## Local setup

1. `.env` from `.env.example` with `SESSION_SIGNING_KEY`, `COOKIE_ENCRYPTION_KEY`, and `GCP_PROJECT_ID=roku-502821`
2. Application Default Credentials for Firestore (named database `roku-substack`):

```bash
gcloud auth application-default login
gcloud config set project roku-502821
```

3. Run:

```bash
npm install
npm run dev
```

Local pairing and catalog routes need the named Firestore database (apply `infra/` first) plus Application Default Credentials. Catalog responses are cached for `CACHE_TTL_MS` (default 15 minutes). Archive fetches are serialized with `SUBSTACK_REQUEST_DELAY_MS` (default 250ms) and capped by `ARCHIVE_LIMIT`.

## Tests

Firestore is mocked — no GCP required:

```bash
npm test              # vitest --coverage; fails below 80% lines
npm run test:watch
npm run test:coverage # HTML report in coverage/
```

Coverage HTML is written to `coverage/`. `src/index.ts` (listen bootstrap) is excluded, matching roku-photos.

## Web flow

1. Open the Roku channel — it shows a QR code and a 6-character backup
2. Scan the QR (or open `/login?code=XXXXXX`)
3. Request a login code on [substack.com/sign-in](https://substack.com/sign-in), then enter email + code on the companion (Cloud Run cannot send Substack emails)
4. The companion auto-claims the TV. Cookie paste (`substack.sid`) is the fallback if verify fails

## Roku API

| Step | Call |
| --- | --- |
| Start pairing | `POST /api/pair/start` → `{ code, expiresAt, claimUrl, qrUrl }` |
| QR image | `GET /api/pair/qr.png?code=XXXXXX` → PNG of `claimUrl` |
| Poll | `GET /api/pair/status?code=XXXXXX` → `{ status }` or `{ status: "linked", deviceToken }` |
| Claim (web) | `POST /api/pair/claim` `{ "code": "XXXXXX" }` (browser session) |
| Home rows | `GET /api/home` with `Authorization: Bearer <deviceToken>` |
| Search | `GET /api/search?q=` — playable posts from the cached home archives |
| Author posts | `GET /api/publications/:id/posts` |
| Play | `GET /api/posts/:id/play` → `{ url, streamFormat, title }` (`hls` or `mp3`) |

Home JSON shape:

```json
{
  "recentVideo": [{ "id": "10:1", "kind": "video", "title": "…", "playable": true }],
  "recentAudio": [{ "id": "10:2", "kind": "audio", "title": "…", "playable": true }],
  "subscriptions": [{ "id": "10", "kind": "publication", "title": "Atlas" }]
}
```

Play IDs are `publicationId:postId`. The companion resolves HLS via Substack `/api/v1/video/upload/{id}/src?type=hls` at request time (signed CDN URLs expire). Audio uses `podcast_url`.

Catalog responses are cached in Firestore for `CACHE_TTL_MS` (default 15 minutes). Archive fetches are serialized with `SUBSTACK_REQUEST_DELAY_MS` (default 250ms) and capped by `ARCHIVE_LIMIT`.

## Manual pairing smoke test (no Roku yet)

```bash
# 1) Start a pairing code (Roku does this; QR encodes /login?code=)
curl -s -X POST http://localhost:8080/api/pair/start

# 2) Open /login?code=XXXXXX, request a Substack code at substack.com/sign-in,
#    then enter email + OTP (or paste substack.sid on /cookie)

# 3) Poll until linked
curl -s 'http://localhost:8080/api/pair/status?code=XXXXXX'

# 4) Fetch home with the deviceToken from step 3
curl -s -H "Authorization: Bearer DEVICE_TOKEN" http://localhost:8080/api/home
```
