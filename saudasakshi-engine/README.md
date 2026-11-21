# SaudaSakshi

Turn a messy WhatsApp-style conversation into a written agreement with escrow, proof
checks and the questions still left to ask.

One AWS Lambda (`nodejs20.x`, ESM, no frameworks) serving both the UI and the API.
Live at <https://hbdbo7fzhqpji6npunwokvrabq0ptjfs.lambda-url.ap-south-1.on.aws/>.

## What it does

Paste a transcript of an informal Indian service deal. SaudaSakshi returns:

- **parties** — provider and client, with roles
- **scope** — line-item list of the work
- **price + escrow** — full amount held in escrow, released only on a stated condition; never an advance
- **deadline, location, proof required, verification checks**
- **missing terms** — anything not stated, each with a question to ask in the speakers' language
- **agreement text** — English and local-language versions
- **reasoning** — where each fact came from, and what was left out
- **writer** — which model drafted it (`grokbot` or `sarvam-105b`)

## Routes

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/` | Single-page UI (inline CSS/JS) |
| POST | `/agreements` | `{transcript}` → `{id}`. Dispatches to grokbot if configured, else drafts inline with Sarvam |
| POST | `/agreements/{id}/callback?t=TOKEN` | grokbot webhook target; token must match, stores the agreement, marks `done` |
| GET | `/agreements/{id}` | `{id, status, writer, agreement?}` — never returns the transcript or callback token |
| POST | `/webhooks/cashfree` | Placeholder: logs the body, returns 200 |
| GET | `/health` | Liveness check |

`status` is `pending` until a writer lands, then `done`.

## Drafting paths

1. **grokbot (async).** If `GROKBOT_WEBHOOK_URL` is set, the Lambda POSTs
   `{id, transcript, callback_url}` with the header in `GROKBOT_WEBHOOK_AUTH_HEADER`
   (default `Authorization`) set to `GROKBOT_WEBHOOK_KEY`. The draft comes back on the
   callback URL, which is guarded by a per-agreement random `cb_token`.
2. **Sarvam (inline).** Used when grokbot is unset *or* its POST fails. Returns with the
   agreement already stored. A Lambda cannot reliably fire-and-forget, so this path
   blocks; the function timeout is 90s for that reason.

`sarvam-105b` is a reasoning model and its reasoning tokens count against `max_tokens`.
The first call budgets 4000 tokens as specified; if reasoning consumes the whole budget
and `content` comes back empty, one retry runs with 16000. JSON is parsed defensively
(fences stripped, first `{` to last `}`, trailing-comma repair).

## Storage

DynamoDB table `saudasakshi-agreements` (ap-south-1, on-demand, pk `id`). Items carry
`id, status, transcript, created_at, cb_token, writer`, and `agreement_json` once done.
The Lambda role has an inline policy allowing only `GetItem`/`PutItem`/`UpdateItem` on
that table.

## Environment variables

| Name | Purpose |
| --- | --- |
| `SARVAM_API_KEY` | Sarvam API key (secret, stored only in Lambda config) |
| `GROKBOT_WEBHOOK_URL` / `_KEY` / `_AUTH_HEADER` | Optional async writer |
| `AGREEMENTS_TABLE` | Defaults to `saudasakshi-agreements` |
| `FUNCTION_URL` | Fallback origin for building the callback URL |

## Local checks

```bash
node tests/api-test.mjs      # live API contract
node tests/ui-smoke.mjs      # headless browser walkthrough (needs playwright + CHROME_PATH)
SARVAM_API_KEY=... node tests/fallback-test.mjs   # forces the Sarvam fallback path
```

## Deploy

```bash
zip -q deploy.zip index.mjs index.html package.json
aws lambda update-function-code --function-name saudasakshi-engine \
  --region ap-south-1 --zip-file fileb://deploy.zip
```

`@aws-sdk/client-dynamodb` is provided by the Node 20 runtime, so it is not bundled.

## Notes

- Escrow and payments are placeholders; no money moves and Cashfree is a stub.
- The transcript is kept in DynamoDB only to serve the draft and is never returned by the API.
