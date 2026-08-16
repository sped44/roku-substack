# Roku channel (SceneGraph)

Sideloadable channel that pairs with the companion backend and browses Substack video/audio.

## Prerequisites

1. Companion API running and reachable from the TV (LAN or Cloud Run HTTPS).
2. Edit [`components/MainScene.xml`](components/MainScene.xml) `apiBaseUrl` default, e.g. `http://192.168.1.42:8080` or your Cloud Run URL.
3. Backend must listen on `0.0.0.0` (not only localhost) so the Roku can reach a laptop. After pairing, the URL is stored in the registry.
4. Enable [developer mode](https://developer.roku.com/docs/developer-program/getting-started/developer-account.md) on the Roku.

## Build / install

From repo root (reads `ROKU_IP` / `ROKU_PASS` from `backend/.env`):

```bash
make package    # zip only
make sideload   # zip + install
```

Or from `channel/`:

```bash
./sideload.sh
./sideload.sh install   # also loads ../backend/.env
```

## Flow

1. Channel starts → `POST /api/pair/start` → shows QR + 6-character code
2. Phone scans QR → companion `/login?code=XXXXXX`
3. Request a Substack login code on substack.com, enter it on the companion (auto-claims the TV)
4. Channel polls until linked, stores `device_token` in registry section `roku_substack`
5. Fetches `/api/home` and shows rows: Search, Recent video, Recent audio, Your subscriptions
6. OK on **Search** (or the Search remote key) opens a keyboard with typing and mic; results come from `/api/search`
7. OK on **Paid: shown / hidden** hides `only_paid` video and audio (saved in the registry)
8. OK on a post plays HLS/MP3; OK on a subscription opens that author’s posts
9. Back leaves the player, search results, or author grid; **\*** (Options) clears pairing

## Notes

- YouTube-only and written posts are omitted from author pages (they have no TV stream).
- Text posts are not rendered (no HTML article view).
- If home is empty, confirm the companion has a valid Substack session and that you subscribe to publications with native video or podcast audio.
