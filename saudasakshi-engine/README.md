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
| POST | `/agreements/{id}/callback?t=TOKEN` | grokbot webhook target; token must match, stores the agreement, marks `done`, creates the escrow link |
| GET | `/agreements/{id}` | `{id, status, writer, agreement?, payment?, provider_bank?}` — never returns the transcript or callback token |
| GET | `/agreements/{id}/payment` | Refreshes the Cashfree link; `PAID` moves the agreement to `in_escrow` |
| POST | `/providers` | Secure ID bank check → provider record (`X-User-Id` required) |
| GET | `/providers/me` | Caller's provider record, account masked to last 4 |
| POST | `/webhooks/cashfree` | HMAC-verified Cashfree webhook; `PAYMENT_LINK_EVENT` + `PAID` → `in_escrow` |
| GET | `/health` | Liveness check |

`status` is `pending` until a writer lands, then `done` (→ `accepted` when both parties sign,
→ `in_escrow` once Cashfree confirms the escrow payment).

## Cashfree (sandbox only)

Base `https://sandbox.cashfree.com` (`CASHFREE_ENV=sandbox`).

**Provider sign-up.** `POST /providers` calls Secure ID
`POST /verification/bank-account/sync` with `{bank_account, ifsc, name, phone}` and stores the
verdict under `id = provider#<uid>` in the same table (no new table). Only `••••<last4>` is ever
returned or rendered. When Cashfree answers with an error — Secure ID is not enabled on these
sandbox keys, so it returns `404 api_error` — the record is stored `verified:false`,
`verification_status:"verification_unavailable"` with Cashfree's own message, and the UI shows an
amber "Bank check unavailable (sandbox)" panel. No result is ever faked. Set
`CASHFREE_VRS_CLIENT_ID` / `CASHFREE_VRS_SECRET` to use dedicated Secure ID credentials; otherwise
the PG keys are used.

**Escrow links.** When an agreement becomes `done` with `price_inr > 0`, a Payment Link is created
via `POST /pg/links` (`x-api-version: 2023-08-01`): `link_id ss_<id12>_<ts>`, amount = the full
price, `link_notify` off, `link_notes.agreement_id`. It is stored as `payment {link_id, link_url,
amount, status}` and is idempotent — the claim is a conditional write of `payment.link_id`, so the
grokbot callback, the Sarvam inline path, a webhook and a refresh can never mint two links.
Agreements drafted before this existed get one lazily on first read.

**Webhook.** `x-webhook-signature` is verified as base64 HMAC-SHA256 of
`x-webhook-timestamp + rawBody` with `CASHFREE_PG_SECRET`; unsigned or wrong signatures get 401.
`PAYMENT_LINK_EVENT` with `link_status: PAID` moves the agreement to `in_escrow`.

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

DynamoDB table `saudasakshi-agreements` (ap-south-1, on-demand, pk `id`). Agreement items carry
`id, status, transcript, created_at, cb_token, writer`, `agreement_json` once done, and
`payment` once an escrow link exists. Provider profiles live in the same table under
`id = provider#<uid>`, so no new table is needed.
The Lambda role has an inline policy allowing only `GetItem`/`PutItem`/`UpdateItem`/`Scan` on
that table.

## Environment variables

| Name | Purpose |
| --- | --- |
| `SARVAM_API_KEY` | Sarvam API key (secret, stored only in Lambda config) |
| `GROKBOT_WEBHOOK_URL` / `_KEY` / `_AUTH_HEADER` | Optional async writer |
| `AGREEMENTS_TABLE` | Defaults to `saudasakshi-agreements` |
| `FUNCTION_URL` | Origin for the callback URL and the payment `return_url` |
| `CASHFREE_APP_ID` / `CASHFREE_PG_SECRET` | Cashfree PG keys (secret; used for links and webhook HMAC) |
| `CASHFREE_ENV` | `sandbox` (default) or `production` |
| `CASHFREE_VRS_CLIENT_ID` / `CASHFREE_VRS_SECRET` | Optional dedicated Secure ID credentials |

## Local checks

```bash
node tests/api-test.mjs        # live API contract
node tests/identity-test.mjs   # auth, scoping, accept flow
node tests/providers-test.mjs  # Secure ID honesty, masking, 401
node tests/payment-test.mjs    # real sandbox link, idempotency, webhook
node tests/ui-smoke.mjs        # headless browser walkthrough (needs playwright + CHROME_PATH)
SARVAM_API_KEY=... node tests/fallback-test.mjs   # forces the Sarvam fallback path
```

`tests/payment-test.mjs` reads `CASHFREE_PG_SECRET` from the environment to sign a webhook;
it skips only that check when the variable is absent.

## Deploy

```bash
zip -q deploy.zip index.mjs index.html package.json
aws lambda update-function-code --function-name saudasakshi-engine \
  --region ap-south-1 --zip-file fileb://deploy.zip
```

`@aws-sdk/client-dynamodb` is provided by the Node 20 runtime, so it is not bundled.

## Notes

- Cashfree is sandbox only: test money, no real payouts or settlement.
- Escrow release (paying the provider out) is not implemented; funding is where this stops.
- The transcript is kept in DynamoDB only to serve the draft and is never returned by the API.
- The UI holds the user ID in memory and asks on every visit; it is never written to localStorage.
