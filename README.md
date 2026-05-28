# SensorWeb

Dashboard for live + historical temperature/humidity readings from a grow-tent sensor. Self-contained Node HTTP server that serves a single HTML page and proxies REST calls to an upstream readings API.

## Repository layout

```
.
├── web-server.js          Node HTTP server: serves the dashboard HTML and proxies /api/tent/readings*
├── uptime.py              CLI report of sensor uptime over a chosen window
├── package.json           npm scripts (`dev` runs the server with .env loaded)
├── Dockerfile             node:22-alpine container
├── docker-compose.yml     Joins the external `web` Docker network as `sensor-web`
├── .env / .env.example    `API_URL=...` for the upstream readings endpoint
└── .github/workflows/
    └── deploy.yml         Builds & pushes ghcr.io/shipi1/sensor-web on push to master,
                            then pokes Watchtower on the VPS to redeploy
```

There is no `node_modules` in source — the server uses only `http` and `https` from the Node stdlib.

## Architecture

```
                  ┌──────────────────────────────────────┐
                  │   browser (single HTML page)         │
                  │                                      │
   wss:// ◀──────▶│  WebSocket live readings             │
                  │                                      │
   /api/tent/...  │  fetch() against same origin         │
                  └──────────────────────────┬───────────┘
                                             │
                          (production)       │       (local dev)
                                             ▼
                  ┌──────────────────────────────────────┐
                  │   reverse proxy on the public host   │   web-server.js on :3001
                  │   → backend Rust API directly        │   → forwards to API_URL
                  └──────────────────────────────────────┘
                                             │
                                             ▼
                  ┌──────────────────────────────────────┐
                  │   upstream readings API (Rust)       │
                  │   GET /…/readings  (raw, newest-first)│
                  │   GET /…/readings/history (10-min buckets)│
                  └──────────────────────────────────────┘
```

- **In production:** the dashboard is served from the public host, so frontend `fetch('/api/tent/readings…')` calls go straight to whatever the reverse proxy routes to the Rust backend. The Node proxy in [web-server.js](web-server.js) is **not on the hot path** in prod.
- **In local dev:** the same relative fetches hit `localhost:3001`, which is the Node server itself — it then proxies them to `API_URL` from `.env`.
- **Live WebSocket** always connects directly to the production WS endpoint (hardcoded in [web-server.js](web-server.js)), regardless of where the page is served, so live readings work locally too.

## Running locally

```bash
npm run dev
```

This runs `node --env-file=.env web-server.js`. Open <http://localhost:3001>.

Requires a `.env` (see `.env.example`):

```env
API_URL=https://<your-host>/api/tent/readings
```

The path you put in `API_URL` is treated as the **base readings endpoint**:
- `/api/tent/readings` → `${API_URL}?…`
- `/api/tent/readings/history` → `${API_URL}/history?…`

## Server-side proxy

[web-server.js](web-server.js) only handles three things:

| Path | Behaviour |
|---|---|
| `/api/tent/readings` | Forwards query string to `API_URL?...`. Default `limit=100000` if not provided. |
| `/api/tent/readings/history` | Forwards query string to `API_URL/history?...`. |
| anything else | Returns the inline HTML page. |

Errors from the upstream fetch return `502` with a JSON error body.

## Frontend (the inline HTML)

The page is one big template literal in [web-server.js](web-server.js) so there's no static file to serve. Everything (CSS, JS, monitor markup) lives inside it.

### Live readings — shared WebSocket

A single shared `WebSocket` connection (URL hardcoded in [web-server.js](web-server.js)) is opened across all monitors via a `wsListeners` set. Each monitor subscribes; if the monitor has a `sensorId`, it filters incoming messages by `msg.data.sensor_id`. Monitors with no `sensorId` accept every message (back-compat for the current single-stream behaviour).

The socket auto-reconnects every 3s on close.

### `createMonitor({ sensorId, label, defaults })` factory

Each monitor is built dynamically and appended to `#monitors`. Per-monitor state lives in the factory closure:

- card with live temp/hum/status
- two Chart.js line charts (temp + humidity, time-axis)
- "good zone" min/max inputs per chart
- subscription to the shared WS
- its own REST fetches scoped via `?sensor_id=…` when set

To add a second monitor, edit the bootstrap array in [web-server.js](web-server.js):

```js
const monitors = [
  createMonitor({ label: '🍄 Grow Tent Monitor' }),
  createMonitor({ sensorId: 'second-sensor-id', label: 'Other Tent' }),
];
```

The new monitor will inherit the global time range and share the WebSocket. The backend must support `?sensor_id=…` on both REST endpoints, and WS messages must carry a `sensor_id` field for filtering to work.

### Good-zone controls

Each chart has min/max number inputs (e.g. "Good zone: [20] – [27] °C"). Setting both draws a translucent green band with dashed boundary lines; values outside are shaded faintly red. Leaving either blank, or setting `max ≤ min`, hides the band.

Defaults: temperature **20–27 °C**, humidity **85–95 %** (mushroom-fruiting range).

Values persist in `localStorage` under `goodZone:<sensorId | 'default'>`, so each monitor remembers its own zones independently.

### Time-range selector

Six buttons drive a global `activeRange`: `30m`, `1h`, `6h` (default), `24h`, `7d`, `All`. Selecting one calls `loadHistory(activeRange)` on every monitor.

Two endpoints are used depending on range:

| Range | Endpoint | Data shape |
|---|---|---|
| `30m`, `1h` | `/api/tent/readings` | raw readings (one entry per 30 s) |
| `6h`, `24h`, `7d`, `All` | `/api/tent/readings/history` | 10-minute buckets `{ bucket, count, temperature, humidity }` |

The threshold is `USE_HISTORY_THRESHOLD = 3600000` ms.

The DOM also auto-refreshes every 5 minutes via `setInterval(refreshAll, 5 * 60 * 1000)`.

### Uptime %

Displayed next to "● connected", e.g. `● connected · 94.3% uptime (6h)`. Recomputed every time the range changes.

| Mode | Formula |
|---|---|
| Raw (`30m`, `1h`) | `data.length / (rangeSec / 30)` |
| Bucketed (`6h`+) | `Σ bucket.count / (expectedBuckets × 20)` where `expectedBuckets = ceil(rangeSec / 600)` |
| `All` | Bucketed, with `windowSec = now − oldestBucket` |

Always clamped at 100 %. Cross-check against `py uptime.py 6h` — totals match within ~0.2 pp (timing skew + the CLI extending its expected range slightly past "now").

## `uptime.py` CLI

Standalone Python script that hits the production `/history` endpoint and prints hourly uptime in a table:

```bash
py uptime.py            # all-time
py uptime.py 6h         # last 6h (also: 30m, 1h, 24h, 7d, all)
```

Constants match the frontend: `BUCKET_STEP = 600`, `EXPECTED_PER_BUCKET = 20` (one reading every 30 s). Walks every expected 10-minute slot, sums received vs expected, marks `< low` below 90 % and `<<< OFFLINE` below 10 %.

Requires `requests` (`pip install requests`).

## Deployment

GitHub Actions workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. On push to `master`, builds a multi-arch image (`linux/amd64`, `linux/arm64`).
2. Pushes to `ghcr.io/shipi1/sensor-web:latest`.
3. `curl`s `http://${VPS_IP}:8081/v1/update` with `WATCHTOWER_TOKEN`, which makes Watchtower on the VPS pull the new image and restart the `sensor-web` container.

On the VPS, [docker-compose.yml](docker-compose.yml) runs the container on port `3001` and attaches it to the external `web` Docker network — that network is where the reverse proxy lives and routes public traffic to it.

Required GHA secrets: `GITHUB_TOKEN` (built-in), `WATCHTOWER_TOKEN`, `VPS_IP`.

## Known caveats

- **WS URL is hardcoded** in [web-server.js:169](web-server.js:169). Local dev still uses prod for live readings; there's no `WS_URL` env knob.
- **WS payloads don't yet include `sensor_id`** — the routing filter is in place client-side, but until backend messages carry the field, a second monitor with `sensorId` set will see no live updates (charts still work — history is per-sensor via REST).
- **`/api/tent/readings` default `limit=100000`** is large; if the upstream API is slow for big windows, consider lowering this in [web-server.js:16](web-server.js:16).
- **No tests.** `npm test` exits non-zero by design.
