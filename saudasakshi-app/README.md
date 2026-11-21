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
| POST   | `/api/agreements` | Create from transcript (parses amounts, detects language) |
| PATCH  | `/api/agreements/:id` | Edit terms / alarm settings (resets confirmations on term edits) |
| POST   | `/api/agreements/:id/confirm` | Dual-party confirmation (`{party: "contractor"|"customer"}`) |
| POST   | `/api/agreements/:id/payments` | Create payment intent (`{stage: "ADVANCE"|"BALANCE"}`) |
| POST   | `/api/agreements/:id/snooze` | Snooze alarm by +1 day |
| GET    | `/api/alarms` | Pending balance alarms (+ `dueToday`) |
| GET/PUT| `/api/settings` | Business profile & voice preferences |

## Integrations: Sarvam AI + Cashfree

Voice transcription requires a Sarvam API key. Payment links require Cashfree credentials. Copy `.env.example` → `.env` (or set env vars in your host) and restart. All third-party keys are used **server-side only** — the browser never sees them.

### Sarvam AI — speech-to-text + LLM term extraction

| Env var | Default | Effect |
|---|---|---|
| `SARVAM_API_KEY` | — | Master switch. When set: real mic → `POST /api/transcribe` → Sarvam STT; transcripts are structured by Sarvam LLM. When empty: voice transcription is unavailable; agreement details can be entered manually. |
| `SARVAM_STT_MODEL` | `saarika:v2.5` | STT model (multilingual kn/hi/ta/en) |
| `SARVAM_LLM_MODEL` | `sarvam-m` | Chat model used for term extraction |
| `SARVAM_BASE` | `https://api.sarvam.ai` | API base URL |

Flow when live: browser records the mic with `MediaRecorder` → raw audio posted to `/api/transcribe` → server forwards to Sarvam (multipart) → transcript comes back → the Sarvam LLM (sarvam-m) extracts a full draft as JSON — `{service, service_regional, customer_name, due_date, total, advance}` — with strict validation (amounts must be sane, due date must be an explicit calendar date within a sane window, customer name only when actually spoken; anything invalid is ignored) → server falls back to the deterministic regex parser if the LLM is unavailable or returns garbage. Language detection is always the local Unicode-script detector (instant + deterministic).

### Cashfree — payment links, webhooks, reconciliation

| Env var | Default | Effect |
|---|---|---|
| `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` | — | Master switch. When set, every milestone creates a **real Cashfree Payment Link**; the "Verify" button becomes a status checker. |
| `CASHFREE_ENV` | `sandbox` | `sandbox` → `https://sandbox.cashfree.com`, `production` → `https://api.cashfree.com` |
| `CASHFREE_API_VERSION` | `2023-08-01` | `x-api-version` header |
| `CASHFREE_WEBHOOK_SECRET` | — | Enables signed webhook settlement (recommended) |
| `PUBLIC_BASE_URL` | request host | Base URL used for webhook `notify_url` + `return_url` |

Set the webhook URL in the Cashfree dashboard to:

```
https://<your-domain>/api/webhooks/cashfree
```

Settlement arrives two ways (both supported simultaneously):

1. **Webhook (preferred)** — `POST /api/webhooks/cashfree` verifies `x-webhook-signature` (base64 HMAC-SHA256 of the raw body) before touching the DB, then marks the intent paid and advances the milestone.
2. **Status polling** — the client auto-polls `GET /api/payments/:intentId/status` every 4 s while an unsettled live intent is on screen; a manual "I've Paid — Check Status" button is also shown.

Both paths converge on the same idempotent `markIntentPaid()` settle routine that advances the agreement (`PENDING → ADVANCE_PAID → COMPLETED`) and clears the alarm when fully paid.

### Extra endpoints added for integrations

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET  | `/api/health` | Includes `capabilities: { sarvamStt, sarvamLlm, cashfree }` |
| POST | `/api/transcribe` | Raw audio in → `{transcript}` out (Sarvam proxy) |
| GET  | `/api/payments/:intentId/status` | Live gateway status + reconciliation |
| POST | `/api/webhooks/cashfree` | Signature-verified settlement webhook |

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
