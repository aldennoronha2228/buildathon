# Build: SaudaSakshi transcript -> agreement demo (deploy to existing AWS Lambda)

You are in ~/hackathon/saudasakshi-engine (a fresh folder, NOT the blurr repo; never touch ~/StudioProjects/blurr except reading one env value below).
AWS CLI is logged in (account 416338227256). Region ap-south-1.
Existing Lambda: `saudasakshi-engine` (nodejs20.x, handler index.handler, role saudasakshi-lambda-role), public Function URL:
https://hbdbo7fzhqpji6npunwokvrabq0ptjfs.lambda-url.ap-south-1.on.aws/

## Goal
A single Lambda (ESM, Node 20, no frameworks, use built-in fetch and @aws-sdk v3 which is in the runtime) that:
1. `GET /` serves a clean, good-looking single-page HTML UI (inline CSS/JS, Tailwind via CDN ok). Title "SaudaSakshi". A big textarea "Paste the conversation transcript" with 2 sample buttons that fill it:
   - Hindi house painting: homeowner and painter agree full house painting for ₹60,000, photos of every room as proof, location must match, deadline 10 days, address "Flat 302, Green Glen Layout, Bellandur, Bengaluru".
   - Hinglish CA deal: client asks CA to file FY25-26 ITR for ₹3,000, proof is the ITR-V acknowledgement (no deadline mentioned, so it should be flagged as missing).
   A "Create agreement" button. Then shows "Drafting agreement..." with a spinner and polls `GET /agreements/{id}` every 2s (up to 3 min). When done, renders: status badge, parties, scope list, price + escrow box ("₹X held in escrow, released when ..."), deadline, location, proof required, verification checks, missing terms (highlighted amber with the question to ask), agreement text with tabs English / local language, and a collapsible "Why" reasoning list. Also show which writer produced it (field `writer`).
2. `POST /agreements` body {transcript} -> creates id (crypto.randomUUID), stores item {id, status:"pending", transcript, created_at, cb_token} in DynamoDB table `saudasakshi-agreements` (pk `id`). Then:
   - If env GROKBOT_WEBHOOK_URL is set: POST JSON {id, transcript, callback_url: "<FUNCTION_URL>agreements/<id>/callback?t=<cb_token>"} to it, with header from env GROKBOT_WEBHOOK_AUTH_HEADER (default "Authorization") = value env GROKBOT_WEBHOOK_KEY (send as-is). Mark writer:"grokbot". If that POST fails, fall back to Sarvam.
   - Else (or fallback): call Sarvam synchronously-in-background is NOT possible on Lambda, so just call Sarvam inline before responding (it takes ~10-30s; set Lambda timeout to 90s). writer:"sarvam-105b".
   Return {id}.
3. `POST /agreements/{id}/callback?t=TOKEN` -> verify token matches stored cb_token (else 403), store the posted JSON as `agreement`, status "done". Return {ok:true}.
4. `GET /agreements/{id}` -> {id, status, writer, agreement?} (never return transcript tokens).
5. `POST /webhooks/cashfree` -> log body, return 200 (placeholder).

## Sarvam call
POST https://api.sarvam.ai/v1/chat/completions, header `api-subscription-key: $SARVAM_API_KEY`, model "sarvam-105b". It is a reasoning model: answer is in choices[0].message.content (reasoning_content is separate); give max_tokens 4000. System prompt: write the agreement JSON with exactly this schema, from the transcript only, never inventing values, full escrow (no advance), missing terms listed with a question in the speakers' language:
{"id","status":"drafted"|"needs_info","language","parties":{"provider":{"name","role"},"client":{"name","role"}},"work_type":"physical"|"professional"|"digital","scope":[],"price_inr","escrow":{"amount_inr","release_condition"},"deadline","location","proof_required":[],"verification_checks":[],"if_late_or_disputed","refund_rule","missing_terms":[{"term","question"}],"agreement_text":{"en","local"},"reasoning":[]}
Parse JSON robustly (strip ``` fences, take first {...last }).

## Infra (do it with AWS CLI)
- Create DynamoDB table `saudasakshi-agreements` (PAY_PER_REQUEST, pk id S) in ap-south-1 if missing.
- Add an inline policy to role saudasakshi-lambda-role allowing dynamodb:GetItem/PutItem/UpdateItem on that table only.
- Set Lambda env SARVAM_API_KEY by reading the SARVAM_API_KEY line from /home/panda/StudioProjects/blurr/server/.env in a shell variable. NEVER print, echo, log, or write the key to any file or to output. Use `aws lambda update-function-configuration --environment` built via a temp JSON file you delete immediately (chmod 600), or similar. Preserve any existing GROKBOT_* env vars if present. Timeout 90, memory 512.
- Zip and `aws lambda update-function-code`. Wait for update to finish.
- Test: curl GET / (expects HTML), POST /agreements with the Hindi sample, then GET /agreements/{id}; confirm an agreement came back. Fix until it works.

Do not create any other AWS resources. Do not commit anywhere. Write a short README.md. At the end print: test results summary (no secrets).
