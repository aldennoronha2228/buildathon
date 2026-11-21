# SaudaSakshi — From Verbal Agreements to Verified Payments

A mobile-first web app that turns spoken verbal work agreements into structured, verified payment contracts — with advance/balance milestones, Cashfree payment links, and balance-due alarms.

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | React 18, Vite, Tailwind CSS 3, React Router 6 |
| Backend  | Node.js, Express 4 |
| Database | SQLite (better-sqlite3, file-based — zero config) |

## Project layout

```
saudasakshi-app/
├── client/            # React app (Vite)
│   └── src/
│       ├── components/  # Shell, Sidebar, Header, modals, banner, toast
│       ├── screens/     # VoiceStep, ConfirmStep, PayStep, History, Settings
│       ├── state/       # App-wide context store
│       └── lib/         # Formatting, language detection
├── server/            # Express API + static file server
│   └── src/
│       ├── api.js       # REST routes
│       ├── db.js        # SQLite schema, queries
│       └── lib/parse.js # Amount parsing + Unicode language detection
└── Dockerfile
```

## Run locally

Requires Node 18+.

```bash
npm install            # installs client + server workspaces
npm run build          # build the React client
npm start              # start API + static server on http://localhost:8080
```

Or for development with hot reload (two processes):

```bash
npm run dev            # server on :8080, Vite dev server on :5173 (proxies /api)
```

Open http://localhost:8080 (production) or http://localhost:5173 (dev).

## API overview

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET    | `/api/health` | Liveness check |
| GET    | `/api/agreements` | List all agreements |
| GET    | `/api/agreements/:id` | One agreement (with confirmations) |
| POST   | `/api/agreements` | Extract terms through Sarvam LLM and persist an agreement |
| PATCH  | `/api/agreements/:id` | Edit terms, customer contact, and alarm settings |
| POST   | `/api/agreements/:id/confirm` | Dual-party confirmation (`{party: "contractor"|"customer"}`) |
| POST   | `/api/agreements/:id/payments` | Create payment intent (`{stage: "ADVANCE"|"BALANCE"}`) |
| POST   | `/api/agreements/:id/snooze` | Snooze alarm by +1 day |
| GET    | `/api/alarms` | Pending balance alarms (+ `dueToday`) |
| GET/PUT| `/api/settings` | Business profile |
| POST   | `/api/transcribe` | Transcribe raw audio through Sarvam STT |
| GET    | `/api/payments/:intentId/status` | Reconcile a Cashfree payment link |
| POST   | `/api/webhooks/cashfree` | Verify and process Cashfree payment-link webhooks |

## Integrations: Sarvam AI + Cashfree

Voice transcription requires a Sarvam API key. Payment links require Cashfree credentials. Copy `.env.example` → `.env` (or set env vars in your host) and restart. All third-party keys are used **server-side only** — the browser never sees them.

### Sarvam AI — speech-to-text + LLM term extraction

| Env var | Default | Effect |
|---|---|---|
| `SARVAM_API_KEY` | — | Enables real mic transcription and agreement term extraction. Agreement creation returns a configuration error when it is missing. |
| `SARVAM_STT_MODEL` | `saaras:v4` | STT model; sent to Sarvam’s `/speech-to-text` endpoint in `transcribe` mode |
| `SARVAM_LLM_MODEL` | `sarvam-105b` | Chat model used for term extraction through `/v2/chat/completions` |
| `SARVAM_BASE` | `https://api.sarvam.ai` | API base URL |

Flow: browser records the mic with `MediaRecorder` → raw audio posts to `/api/transcribe` → server forwards multipart audio to Sarvam STT → transcript returns to the client. `POST /api/agreements` sends that text to Sarvam LLM and persists validated terms. The backend does not infer missing amounts or silently fall back to regex parsing. If the LLM is not configured or returns invalid terms, the API responds with an error and creates no agreement. Customer name, phone, and due date are optional record fields; a valid customer phone is required to request a Cashfree payment link.

### Cashfree — payment links, webhooks, reconciliation

| Env var | Default | Effect |
|---|---|---|
| `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` | — | Both are required to create real Cashfree Payment Links. When missing, payment-link creation returns `503`; no simulated payment is created. |
| `CASHFREE_ENV` | `sandbox` | `sandbox` → `https://sandbox.cashfree.com`, `production` → `https://api.cashfree.com` |
| `CASHFREE_API_VERSION` | `2023-08-01` | `x-api-version` header |
| `PUBLIC_BASE_URL` | request host | Base URL used for webhook `notify_url` + `return_url` |

Set the webhook URL in the Cashfree dashboard to:

```
https://<your-domain>/api/webhooks/cashfree
```

Settlement arrives two ways (both supported simultaneously):

1. **Webhook (preferred)** — `POST /api/webhooks/cashfree` verifies the timestamp and raw body signature before processing a paid link event.
2. **Status polling** — the client auto-polls `GET /api/payments/:intentId/status` every 4 s while an unsettled live intent is on screen; a manual "I've Paid — Check Status" button is also shown.

Both paths converge on the same idempotent `markIntentPaid()` settle routine that advances the agreement (`PENDING → ADVANCE_PAID → COMPLETED`) and clears the alarm when fully paid.

## Deploy

### Single server (Render / Railway / Fly / any VPS)

```bash
npm install && npm run build && npm start   # PORT env var respected (default 8080)
```

The Express server serves both the API and the built React app from one process/port.

### Docker

```bash
docker build -t saudasakshi .
docker run -p 8080:8080 saudasakshi
```

### Static frontend + separate API (e.g. Vercel + Render)

Deploy `client/` as a static site (`npm run build` → `client/dist`), and `server/` as a Node service. Set the client's fetch base to the API URL (edit `client/src/api.js`).

## Notes

- SQLite DB lives at `server/data/saudasakshi.db` (created with an empty agreements list). Delete the file for a factory reset.
- Monochrome design language: white = verified/paid, dim zinc outline = pending. No status colors.
