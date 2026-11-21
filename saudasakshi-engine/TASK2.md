# Task 2: simple client user-ID auth (SaudaSakshi)
Extend the existing app in this folder (index.mjs Lambda + index.html UI, deployed as Lambda `saudasakshi-engine` in ap-south-1, Function URL https://hbdbo7fzhqpji6npunwokvrabq0ptjfs.lambda-url.ap-south-1.on.aws/). Keep all existing behaviour and tests passing.

Goal: very simple client-side identity for a hackathon demo (not real security).
1. UI: if no user ID in localStorage, show a small sign-in card: "Your user ID" (e.g. phone number or handle) + optional display name. Save to localStorage. Show "Signed in as X" with a Sign out link in the header.
2. Every API call sends header `X-User-Id: <uid>` (and `X-User-Name` if set). POST /agreements without X-User-Id -> 401.
3. POST /agreements accepts optional `counterparty_uid` and `my_role` ("client" | "provider"). Store `created_by`, `client_uid`, `provider_uid` on the item (creator fills their role; counterparty fills the other if given).
4. GET /agreements/{id}: return only if X-User-Id is created_by, client_uid or provider_uid; else 403. The grokbot callback route stays token-based and unchanged.
5. New GET /agreements (list): agreements where the caller is creator/client/provider, newest first, minimal fields (id, status, created_at, price_inr, work_type, parties summary). Use a DynamoDB Scan with filter (fine for demo) or add GSIs if quick; do not delete or recreate the existing table or its data.
6. UI: "My agreements" list below the form; click to open. Form gets "My role" toggle and optional "Other party's user ID" field.
7. New route POST /agreements/{id}/accept by client or provider uid: records accepted_by_client / accepted_by_provider; when both, status "accepted". Show Accept button in UI for the signed-in party.
8. Add tests for the above (401 without uid, 403 for stranger, list scoping, accept flow). Deploy, run all tests against the live URL, and report results.
Rules: preserve all existing Lambda env vars (never print any secret values; SARVAM_API_KEY and GROKBOT_WEBHOOK_KEY must stay untouched). No new AWS resources except optional GSIs on saudasakshi-agreements. Do not commit or push anything.
