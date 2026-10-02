# 小鴨影視

A standalone Android TV app and installable web player backed by a stateless relay for `xiaoyakankan.com`.

## Standalone Android TV app

The original Android TV client is in `android-tv-app/`. The current
ready-to-sideload build is available as `xiaoya-tv.apk`.

Start the relay on a computer reachable from the TV, install the APK, and open
**Settings** in the app if the relay is not at the default
`http://10.0.0.105:8787` address. Favourites, history, and playback positions
are stored locally on the TV.

With the local relay running, download the APK directly on the TV from:

```text
http://SERVER_IP:8787/xiaoya-tv.apk
```

It has no accounts, database, cookies, favorites, or server-side watch history. The serverless API only:

1. fetches public catalog/detail HTML;
2. extracts categories, episodes, and HLS sources;
3. proxies HLS manifests, keys, and segments for compatible TV playback.

No account or database is required. The Android app and web player store favourites and playback progress locally on the device.

## Why it is not purely static

The source site does not grant browser CORS access to its HTML pages. A browser-only build therefore cannot read the catalog. The `/api` routes are a small stateless serverless layer; the UI itself is static.

## Local development

Requires Node.js 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Vite proxies API calls to the local service on port `8787`.

Production build:

```bash
pnpm build
pnpm start
```

Then open `http://localhost:8787`.

## OrionTV (recommended)

Use OrionTV's normal API integration rather than its limited Live/M3U mode:

1. Open **Settings** in OrionTV.
2. Set **API Address** to `http://SERVER_IP:8787` (for example `http://10.0.0.105:8787`).
3. Save settings and allow OrionTV to log in automatically; no username or password is needed.
4. Return to the home screen. Catalog browsing, search, episodes, normal seeking, local favorites, and local resume history are available.

The server advertises `localstorage` mode, so OrionTV keeps personal state on-device and the relay remains stateless.

## OrionTV Live/M3U mode (legacy)

Live mode treats every entry as a channel and does not provide title search or seeking. It is retained only as a fallback.

Add a remote M3U playlist using one of these URLs:

```text
http://SERVER_IP:8787/orion.m3u
http://SERVER_IP:8787/api/playlist.m3u?category=10
http://SERVER_IP:8787/api/playlist.m3u?category=11
```

Category `10` is movies and `11` is series. Multiple categories and pages can be combined, for example:

```text
http://SERVER_IP:8787/api/playlist.m3u?categories=10,11,12,13&pages=1
```

Generating a large combined playlist takes longer because every title page must be resolved. For the quickest and most reliable refresh, add movies and series as separate playlists and start with one page.

## Deploy to Cloudflare

Create a Cloudflare account/project, authenticate Wrangler, then run:

```bash
pnpm deploy:cloudflare
```

`wrangler.jsonc` serves the Vite assets and runs `src/worker/index.ts` only for `/api/*`. No D1, KV, R2, or other persistent service is used.

## Deploy to Vercel

Import the repository in Vercel, or use the CLI:

```bash
vercel
```

The static build is served from `dist`, while `api/[...route].ts` provides the stateless API.

## Docker

```bash
docker compose up -d --build
```

Open `http://SERVER_IP:8787` from a device on the same network.

## Operational notes

- Serverless hosts can technically run this workload, but deployment does not imply permission from the source site or hosting provider. Check the source site's terms, applicable rights, and your host's acceptable-use policy.
- The source may block datacenter IP ranges or change its HTML at any time.
- Only use streams you are authorized to access.
- The in-memory metadata cache is opportunistic and can disappear whenever a serverless instance is recycled.
