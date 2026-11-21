/**
 * SaudaSakshi engine — one Lambda, no frameworks.
 *
 * GET  /                              -> single page UI
 * POST /agreements                    -> {transcript, counterparty_uid?, my_role?} => {id}   (X-User-Id required)
 * GET  /agreements                    -> my agreements, newest first                        (X-User-Id required)
 * POST /agreements/{id}/accept        -> the signed-in party accepts                       (X-User-Id required)
 * POST /agreements/{id}/callback?t=   -> grokbot webhook callback (token auth, no user id)
 * GET  /agreements/{id}               -> {id, status, writer, agreement?, payment?, provider_bank?}
 * POST /providers                     -> Secure ID bank check + provider record            (X-User-Id required)
 * GET  /providers/me                  -> caller's provider record, account masked         (X-User-Id required)
 * GET  /agreements/{id}/payment       -> refresh the Cashfree payment link, PAID => in_escrow
 * POST /webhooks/cashfree             -> Cashfree webhook (HMAC-SHA256 verified)
 */
import { randomUUID, randomBytes, createHmac, timingSafeEqual, publicEncrypt, constants } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const TABLE = process.env.AGREEMENTS_TABLE || "saudasakshi-agreements";
const REGION = process.env.AWS_REGION || "ap-south-1";
const ddb = new DynamoDBClient({ region: REGION });

const GROKBOT_WEBHOOK_URL = process.env.GROKBOT_WEBHOOK_URL || "";
const GROKBOT_WEBHOOK_KEY = process.env.GROKBOT_WEBHOOK_KEY || "";
const GROKBOT_WEBHOOK_AUTH_HEADER =
  process.env.GROKBOT_WEBHOOK_AUTH_HEADER || "Authorization";

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || "";
const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";
const SARVAM_MODEL = "sarvam-105b";

/* Cashfree — sandbox only. Secrets are read from env and never logged or returned. */
const CASHFREE_ENV = (process.env.CASHFREE_ENV || "sandbox").toLowerCase();
const CASHFREE_BASE =
  CASHFREE_ENV === "production" || CASHFREE_ENV === "prod"
    ? "https://api.cashfree.com"
    : "https://sandbox.cashfree.com";
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || "";
const CASHFREE_PG_SECRET = process.env.CASHFREE_PG_SECRET || "";
// Secure ID (VRS) is a separate product with its own credentials. Fall back to the
// PG keys only when no dedicated pair is configured.
const CASHFREE_VRS_CLIENT_ID = process.env.CASHFREE_VRS_CLIENT_ID || CASHFREE_APP_ID;
const CASHFREE_VRS_SECRET = process.env.CASHFREE_VRS_SECRET || CASHFREE_PG_SECRET;
// Secure ID accounts commonly use Public Key 2FA, which requires an
// x-cf-signature header on every call. With IP whitelisting instead, leave this unset.
const CASHFREE_VRS_PUBLIC_KEY = (process.env.CASHFREE_VRS_PUBLIC_KEY || "").replace(/\\n/g, "\n").trim();
const CASHFREE_API_VERSION = "2023-08-01";
const CASHFREE_TIMEOUT_MS = 12000;

const WRITER_GROKBOT = "grokbot";
const WRITER_SARVAM = "sarvam-105b";

let cachedHtml = null;
function pageHtml() {
  if (cachedHtml) return cachedHtml;
  // Loaded lazily so a missing asset can't take the whole function down at init.
  try {
    cachedHtml = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  } catch (err) {
    console.error(JSON.stringify({ evt: "ui_asset_missing", error: String(err?.message || err) }));
    cachedHtml = `<!doctype html><title>SaudaSakshi</title><h1>SaudaSakshi</h1>
<p>The UI asset is missing from this deployment. The API is still up: POST /agreements.</p>`;
  }
  return cachedHtml;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400",
};

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  body: JSON.stringify(obj),
});

const html = (body) => ({
  statusCode: 200,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...CORS },
  body,
});

/* ------------------------------------------------------------------ */
/* DynamoDB helpers                                                    */
/* ------------------------------------------------------------------ */

async function putPending(id, transcript, cbToken, identity) {
  const item = {
    id: { S: id },
    status: { S: "pending" },
    transcript: { S: transcript.slice(0, 30000) },
    created_at: { S: new Date().toISOString() },
    cb_token: { S: cbToken },
  };
  // created_by is set by the API, never by the client.
  if (identity?.uid) item.created_by = { S: identity.uid };
  if (identity?.uid) item.created_by_name = { S: identity.name || identity.uid };
  if (identity?.role === ROLE_CLIENT) {
    item.client_uid = { S: identity.uid };
    if (identity.counterpartyUid) item.provider_uid = { S: identity.counterpartyUid };
  } else if (identity?.role === ROLE_PROVIDER) {
    item.provider_uid = { S: identity.uid };
    if (identity.counterpartyUid) item.client_uid = { S: identity.counterpartyUid };
  }
  if (identity?.role) item.creator_role = { S: identity.role };

  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: item }));
}

async function markWriter(id, writer) {
  await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { id: { S: id } },
      UpdateExpression: "SET #w = :w, updated_at = :u",
      ExpressionAttributeNames: { "#w": "writer" },
      ExpressionAttributeValues: { ":w": { S: writer }, ":u": { S: new Date().toISOString() } },
    })
  );
}

async function markDone(id, agreement, writer) {
  const now = new Date().toISOString();
  const values = {
    ":s": { S: "done" },
    ":a": { S: JSON.stringify(agreement) },
    ":u": { S: now },
    ":e": { S: now },
  };
  let expr = "SET #s = :s, agreement_json = :a, updated_at = :u, completed_at = :e";
  if (writer) {
    expr += ", #w = :w";
    values[":w"] = { S: writer };
  }
  await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { id: { S: id } },
      UpdateExpression: expr,
      ExpressionAttributeNames: { "#s": "status", "#w": "writer" },
      ExpressionAttributeValues: values,
    })
  );
}

async function getItem(id) {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TABLE,
      Key: { id: { S: id } },
      ConsistentRead: true,
    })
  );
  return out.Item || null;
}

// Demo-scale listing: one Scan, filtered server-side to items this uid is a party of.
// Fine for a hackathon table; swap for a GSI if this ever grows.
async function scanForUser(uid) {
  const items = [];
  let startKey;
  do {
    const out = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression:
          "created_by = :u OR client_uid = :u OR provider_uid = :u",
        ExpressionAttributeValues: { ":u": { S: uid } },
        ExclusiveStartKey: startKey,
      })
    );
    for (const it of out.Items || []) items.push(it);
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

function listRow(item) {
  const agreement = parseAgreementJson(item);
  const price = agreement?.price_inr ?? null;
  const row = {
    id: item.id?.S,
    status: item.status?.S || "pending",
    created_at: item.created_at?.S || null,
    price_inr: typeof price === "number" ? price : null,
    work_type: agreement?.work_type ?? null,
    parties: {
      ...partiesSummary(item),
      creator_name: item.created_by_name?.S || item.created_by?.S || null,
      client_name: agreement?.parties?.client?.name ?? null,
      provider_name: agreement?.parties?.provider?.name ?? null,
    },
  };
  if (item.creator_role?.S) row.creator_role = item.creator_role.S;
  if (agreement?.status) row.agreement_status = agreement.status;
  const pay = paymentFor(item);
  if (pay) row.payment_status = pay.status;
  return row;
}

function parseAgreementJson(item) {
  if (!item?.agreement_json?.S) return null;
  try {
    return JSON.parse(item.agreement_json.S);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Sarvam                                                              */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are SaudaSakshi. Convert the transcript of an informal Indian service deal into ONE JSON object. No markdown, no prose.

Rules:
- Use only what is stated. Never invent. Missing value => null (or [] for lists), and add it to missing_terms.
- Payment is FULL ESCROW, no advance. If an advance was demanded, put the full price in escrow and raise the advance as a missing_term.
- money strings like "60 hazaar", "60k", "₹60,000" => 60000 (plain integer, no commas).
- every missing_terms question is written in Hindi only, in Devanagari script, whatever the transcript language.
- agreement_text.en = complete plain-English agreement, numbered clauses (8-16 short clauses). agreement_text.local = the same deal in the transcript's local language (Devanagari for Hindi/Hinglish).
- reasoning = short notes on where each fact came from and what you deliberately left out.
- work_type: "physical" (painting, repair, carpentry, delivery), "professional" (CA, lawyer, consultant), "digital" (design, marketing, code).
- verification_checks = concrete, checkable steps before money is released.
- status "drafted" only if price, scope, proof, deadline and location (when relevant) are all present; else "needs_info".

Keys (exact):
{"id":"draft","status":"drafted"|"needs_info","language":"hi"|"en","parties":{"provider":{"name":string|null,"role":string|null},"client":{"name":string|null,"role":string|null}},"work_type":"physical"|"professional"|"digital","scope":string[],"price_inr":number|null,"escrow":{"amount_inr":number|null,"release_condition":string|null},"deadline":string|null,"location":string|null,"proof_required":string[],"verification_checks":string[],"if_late_or_disputed":string|null,"refund_rule":string|null,"missing_terms":[{"term":string,"question":string}],"agreement_text":{"en":string,"local":string},"reasoning":string[]}

Reply with the JSON object only. Do not explain your reasoning before the JSON.`;

function extractJson(text) {
  if (!text || typeof text !== "string") return null;
  let t = text.trim();
  t = t.replace(/^```(?:json|JSON)?\s*/, "").replace(/\s*```\s*$/, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = t.slice(first, last + 1);
  const attempts = [slice, slice.replace(/,\s*([}\]])/g, "$1")];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      /* next */
    }
  }
  return null;
}

const asArray = (v) =>
  Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && String(x).trim() !== "") : [];
const asText = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const asNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function normalizeAgreement(raw, id) {
  const a = raw && typeof raw === "object" ? raw : {};
  const parties = a.parties && typeof a.parties === "object" ? a.parties : {};
  const p = parties.provider && typeof parties.provider === "object" ? parties.provider : {};
  const c = parties.client && typeof parties.client === "object" ? parties.client : {};
  const escrow = a.escrow && typeof a.escrow === "object" ? a.escrow : {};
  const at = a.agreement_text && typeof a.agreement_text === "object" ? a.agreement_text : {};
  const missing = asArray(a.missing_terms)
    .map((m) =>
      typeof m === "string"
        ? { term: m, question: "कृपया इस शर्त की पुष्टि करें।" }
        : { term: asText(m?.term) || "unspecified term", question: asText(m?.question) || "कृपया इस शर्त की पुष्टि करें।" }
    )
    .filter((m) => m.term);

  const workType = ["physical", "professional", "digital"].includes(a.work_type)
    ? a.work_type
    : "professional";

  // Keep any extra keys the writer sent; only fill/normalise the known ones.
  return {
    ...a,
    id: asText(a.id) || id,
    status: a.status === "drafted" ? "drafted" : "needs_info",
    language: asText(a.language) || "en",
    parties: {
      ...parties,
      provider: { ...p, name: asText(p.name), role: asText(p.role) },
      client: { ...c, name: asText(c.name), role: asText(c.role) },
    },
    work_type: workType,
    scope: asArray(a.scope).map((s) => String(s)),
    price_inr: asNumber(a.price_inr),
    escrow: {
      ...escrow,
      amount_inr: asNumber(escrow.amount_inr) ?? asNumber(a.price_inr),
      release_condition: asText(escrow.release_condition),
    },
    deadline: asText(a.deadline),
    location: asText(a.location),
    proof_required: asArray(a.proof_required).map((s) => String(s)),
    verification_checks: asArray(a.verification_checks).map((s) => String(s)),
    if_late_or_disputed: asText(a.if_late_or_disputed),
    refund_rule: asText(a.refund_rule),
    missing_terms: missing,
    agreement_text: { ...at, en: asText(at.en) || "", local: asText(at.local) || "" },
    reasoning: asArray(a.reasoning).map((s) => String(s)),
  };
}

async function callSarvam(transcript, id) {
  if (!SARVAM_API_KEY) throw new Error("SARVAM_API_KEY is not configured");

  // sarvam-105b is a reasoning model: reasoning tokens are billed against
  // max_tokens. The spec budget is 4000, but if reasoning eats all of it the
  // content comes back empty -> retry once with a larger budget.
  const budgets = [
    { maxTokens: 4000, timeoutMs: 22000 },
    { maxTokens: 16000, timeoutMs: 38000 },
  ];
  let lastErr = null;

  for (const { maxTokens, timeoutMs } of budgets) {
    try {
      const res = await fetch(SARVAM_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-subscription-key": SARVAM_API_KEY,
        },
        body: JSON.stringify({
          model: SARVAM_MODEL,
          temperature: 0,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `TRANSCRIPT:\n${transcript}` },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`Sarvam ${res.status}: ${text.slice(0, 300)}`);

      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new Error("Sarvam returned non-JSON envelope");
      }
      const choice = envelope?.choices?.[0];
      const content = choice?.message?.content;
      const parsed =
        extractJson(typeof content === "string" ? content : "") ||
        extractJson(choice?.message?.reasoning_content || "");
      if (parsed) {
        console.log(
          JSON.stringify({
            evt: "sarvam_ok",
            id,
            max_tokens: maxTokens,
            finish: choice?.finish_reason,
            reasoning_tokens: envelope?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
          })
        );
        return normalizeAgreement(parsed, id);
      }
      lastErr = new Error(
        `Sarvam returned no parseable JSON (finish=${choice?.finish_reason || "?"}, max_tokens=${maxTokens})`
      );
    } catch (err) {
      lastErr = err;
      // auth / quota failures will not improve on retry
      if (/^Sarvam (401|403|429)/.test(String(err?.message || ""))) break;
    }
  }
  throw lastErr || new Error("Sarvam call failed");
}

/* ------------------------------------------------------------------ */
/* Local safety-net draft (only if the model is unreachable)           */
/* ------------------------------------------------------------------ */

function fallbackAgreement(transcript, id, reason) {
  const priceMatch = transcript.match(/(?:₹|rs\.?|inr)\s*([0-9][0-9,]{1,})|([0-9][0-9,]{2,})\s*(?:rupees|rupaye|rs)\b/i);
  const price = priceMatch ? asNumber(priceMatch[1] || priceMatch[2]) : null;
  return normalizeAgreement(
    {
      id: "draft",
      status: "needs_info",
      language: /[\u0900-\u097F]/.test(transcript) ? "hi" : "en",
      parties: { provider: { name: null, role: null }, client: { name: null, role: null } },
      work_type: "professional",
      scope: [],
      price_inr: price,
      escrow: {
        amount_inr: price,
        release_condition: "Only after the client confirms the work and its proof.",
      },
      deadline: null,
      location: null,
      proof_required: [],
      verification_checks: [],
      if_late_or_disputed: null,
      refund_rule: null,
      missing_terms: [
        { term: "scope", question: "कौन-कौन सा काम शामिल है? कृपया पुष्टि करें।" },
        { term: "proof", question: "काम पूरा होने का क्या सबूत होगा? कृपया पुष्टि करें।" },
        { term: "deadline", question: "काम कब तक पूरा होना चाहिए? कृपया पुष्टि करें।" },
      ],
      agreement_text: {
        en: "Draft could not be generated automatically. The transcript has been saved. Please retry.",
        local: "",
      },
      reasoning: [`Automatic drafting failed: ${reason}`],
    },
    id
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function parseQuery(raw) {
  const out = {};
  if (!raw) return out;
  for (const part of String(raw).split("&")) {
    if (!part) continue;
    const [k, v = ""] = part.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Identity (demo-grade, not security)                                 */
/* ------------------------------------------------------------------ */

const ROLE_CLIENT = "client";
const ROLE_PROVIDER = "provider";
const ROLES = [ROLE_CLIENT, ROLE_PROVIDER];
const MAX_UID = 80;

function header(event, name) {
  const headers = event.headers || {};
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === want) {
      const v = headers[key];
      return v === null || v === undefined ? undefined : String(v);
    }
  }
  return undefined;
}

// Trim, drop control chars, cap length. IDs are opaque strings compared exactly.
function cleanId(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s === "" ? null : s.slice(0, MAX_UID);
}

function callerFrom(event) {
  return { uid: cleanId(header(event, "x-user-id")), name: cleanId(header(event, "x-user-name")) };
}

const otherRole = (role) => (role === ROLE_CLIENT ? ROLE_PROVIDER : ROLE_CLIENT);

// The uids an item is visible to. Legacy items (created before identity) have none.
function ownerUids(item) {
  return [item?.created_by?.S, item?.client_uid?.S, item?.provider_uid?.S].filter(
    (v) => typeof v === "string" && v !== ""
  );
}

function canRead(item, uid) {
  return !!uid && ownerUids(item).includes(uid);
}

function partiesSummary(item) {
  const client = item?.client_uid?.S || null;
  const provider = item?.provider_uid?.S || null;
  return { client_uid: client, provider_uid: provider };
}

async function transcribeAudio(event) {
  const uid = (event.headers?.["x-user-id"] || event.headers?.["X-User-Id"] || "").trim();
  if (!uid) return json(401, { error: "X-User-Id header is required" });
  if (!SARVAM_API_KEY) return json(503, { error: "Sarvam is not configured" });
  const body = readBody(event);
  if (!body || typeof body.audio_base64 !== "string") return json(400, { error: "audio_base64 is required" });
  const buf = Buffer.from(body.audio_base64, "base64");
  if (buf.length < 1000) return json(400, { error: "recording too short" });
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/wav" }), "chunk.wav");
  form.append("model", "saarika:v2.5");
  form.append("language_code", "unknown");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST", headers: { "api-subscription-key": SARVAM_API_KEY }, body: form, signal: ctrl.signal,
    });
    const text = await res.text();
    let out; try { out = JSON.parse(text); } catch { out = {}; }
    if (!res.ok) {
      console.log(JSON.stringify({ evt: "transcribe_failed", http: res.status, body: text.slice(0, 300) }));
      return json(502, { error: "Sarvam could not transcribe this audio" });
    }
    console.log(JSON.stringify({ evt: "transcribed", bytes: buf.length, lang: out.language_code || null }));
    return json(200, { transcript: out.transcript || "", language_code: out.language_code || null });
  } catch (err) {
    console.log(JSON.stringify({ evt: "transcribe_error", msg: String(err && err.message) }));
    return json(502, { error: "Sarvam transcription timed out or failed" });
  } finally { clearTimeout(t); }
}

async function speakText(event) {
  const uid = (event.headers?.["x-user-id"] || event.headers?.["X-User-Id"] || "").trim();
  if (!uid) return json(401, { error: "X-User-Id header is required" });
  if (!SARVAM_API_KEY) return json(503, { error: "Sarvam is not configured" });
  const body = readBody(event);
  const text = body && typeof body.text === "string" ? body.text.slice(0, 500) : "";
  if (!text.trim()) return json(400, { error: "text is required" });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "api-subscription-key": SARVAM_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ text, target_language_code: "hi-IN", model: "bulbul:v3" }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let out; try { out = JSON.parse(raw); } catch { out = {}; }
    if (!res.ok || !out.audios || !out.audios[0]) {
      console.log(JSON.stringify({ evt: "tts_failed", http: res.status, body: raw.slice(0, 300) }));
      return json(502, { error: "Sarvam TTS failed" });
    }
    return json(200, { audio_base64: out.audios[0], mime: "audio/wav" });
  } catch (err) {
    return json(502, { error: "Sarvam TTS timed out" });
  } finally { clearTimeout(t); }
}

function readBody(event) {
  if (event.body == null) return null;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function originFor(event) {
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  const host =
    event.headers?.["x-forwarded-host"] ||
    event.headers?.host ||
    event.requestContext?.domainName ||
    "";
  if (host) return `${proto}://${host}`;
  return (process.env.FUNCTION_URL || "").replace(/\/+$/, "");
}

/* ------------------------------------------------------------------ */
/* Cashfree (sandbox)                                                  */
/* ------------------------------------------------------------------ */

// Cashfree Secure ID 2FA (Public Key method): base64(RSA-OAEP-SHA1("<clientId>.<unixSeconds>")).
// Returns null when no public key is configured (IP-whitelist accounts).
function cashfreeSignature() {
  if (!CASHFREE_VRS_PUBLIC_KEY) return null;
  try {
    return publicEncrypt(
      {
        key: CASHFREE_VRS_PUBLIC_KEY,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha1",
      },
      Buffer.from(`${CASHFREE_VRS_CLIENT_ID}.${Math.floor(Date.now() / 1000)}`)
    ).toString("base64");
  } catch (err) {
    console.error(JSON.stringify({ evt: "cashfree_signature_failed", error: String(err?.message || err) }));
    return null;
  }
}

// One HTTP call to Cashfree. Never logs headers or bodies that carry secrets.
async function cashfreeFetch(path, { method = "GET", body, product = "pg" } = {}) {
  const clientId = product === "vrs" ? CASHFREE_VRS_CLIENT_ID : CASHFREE_APP_ID;
  const secret = product === "vrs" ? CASHFREE_VRS_SECRET : CASHFREE_PG_SECRET;
  const headers = {
    "content-type": "application/json",
    "x-client-id": clientId,
    "x-client-secret": secret,
    "x-api-version": CASHFREE_API_VERSION,
  };
  // Secure ID with Public Key 2FA rejects calls without this header.
  if (product === "vrs") {
    const sig = cashfreeSignature();
    if (sig) headers["x-cf-signature"] = sig;
  }
  const res = await fetch(CASHFREE_BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(CASHFREE_TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { ok: res.ok, status: res.status, body: parsed, text };
}

const cashfreeMessage = (r, fallback) => {
  const b = r?.body;
  const msg =
    (b && (b.message || b.error?.message || b.detail)) ||
    (typeof r?.text === "string" ? r.text.slice(0, 300) : "") ||
    fallback;
  return String(msg).slice(0, 300);
};

// Only the last 4 digits ever leave the server.
const last4 = (acct) => String(acct || "").replace(/\s+/g, "").slice(-4);
const maskAccount = (acct) => {
  const l4 = last4(acct);
  return l4 ? `••••${l4}` : null;
};

const PROVIDER_PREFIX = "provider#";
const providerId = (uid) => PROVIDER_PREFIX + uid;

async function getProvider(uid) {
  if (!uid) return null;
  const item = await getItem(providerId(uid));
  if (!item || item.entity?.S !== "provider") return null;
  return item;
}

function providerPublic(item) {
  if (!item) return null;
  const out = {
    uid: item.uid?.S || null,
    full_name: item.full_name?.S || null,
    phone: item.phone?.S || null,
    work_type: item.work_type?.S || null,
    ifsc: item.ifsc?.S || null,
    bank_account_masked: item.bank_account_masked?.S || null,
    bank_account_last4: item.bank_account_last4?.S || null,
    verified: item.verified?.BOOL === true,
    verification_status: item.verification_status?.S || "unknown",
    name_at_bank: item.name_at_bank?.S || null,
    name_match_result: item.name_match_result?.S || null,
    name_match_score: item.name_match_score?.N ? Number(item.name_match_score.N) : null,
    account_status: item.account_status?.S || null,
    message: item.cashfree_message?.S || null,
    created_at: item.created_at?.S || null,
    updated_at: item.updated_at?.S || null,
  };
  return out;
}

// Short badge shape attached to an agreement when the provider has a record.
function providerBadge(item) {
  if (!item) return null;
  return {
    verified: item.verified?.BOOL === true,
    verification_status: item.verification_status?.S || "unknown",
    name_at_bank: item.name_at_bank?.S || null,
    name_match_result: item.name_match_result?.S || null,
    bank_account_masked: item.bank_account_masked?.S || null,
  };
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const WORK_TYPES = ["physical", "professional", "digital"];

function cleanPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const local = digits.length > 10 && digits.startsWith("91") ? digits.slice(-10) : digits;
  return local.length === 10 ? local : null;
}

function cleanAccount(value) {
  const digits = String(value ?? "").replace(/\s+/g, "");
  return /^[0-9]{9,18}$/.test(digits) ? digits : null;
}

// Cashfree Secure ID: POST /verification/bank-account/sync
// Returns a normalised verdict. Any Cashfree failure is surfaced as
// verification_unavailable with their own message — never a fake success.
async function verifyBankAccount({ account, ifsc, name, phone }) {
  let res;
  try {
    res = await cashfreeFetch("/verification/bank-account/sync", {
      method: "POST",
      product: "vrs",
      body: { bank_account: account, ifsc, name, phone },
    });
  } catch (err) {
    return {
      verified: false,
      verification_status: "verification_unavailable",
      message: `Secure ID unreachable: ${String(err?.message || err)}`.slice(0, 300),
    };
  }

  if (!res.ok || !res.body || typeof res.body !== "object") {
    return {
      verified: false,
      verification_status: "verification_unavailable",
      message: cashfreeMessage(res, "Secure ID bank check failed"),
      http_status: res.status,
    };
  }

  const b = res.body;
  const rawMatch = b.name_match_result ? String(b.name_match_result).toUpperCase().trim() : null;
  const accountStatus = (b.account_status ? String(b.account_status) : null)?.toUpperCase() || null;
  const score = b.name_match_score === undefined || b.name_match_score === null ? null : Number(b.name_match_score);
  const nameAtBank = asText(b.name_at_bank) || asText(b.name) || null;

  // Cashfree's real verdicts: DIRECT_MATCH / GOOD_PARTIAL_MATCH /
  // MODERATE_PARTIAL_MATCH / POOR_PARTIAL_MATCH / NO_MATCH, scored 0-100.
  // (Older IPP-style "YES"/"NO" is accepted too.)
  const STRONG = ["DIRECT_MATCH", "GOOD_PARTIAL_MATCH", "YES"];
  const WEAK = ["POOR_PARTIAL_MATCH", "NO_MATCH", "NO"];
  const MODERATE = ["MODERATE_PARTIAL_MATCH", "PARTIAL"];

  let verification_status;
  let verified = false;
  let message = null;

  if (accountStatus && accountStatus !== "VALID") {
    verification_status = "account_invalid";
    message = asText(b.account_status_code) || asText(b.message) || `Account status: ${accountStatus}`;
  } else if (rawMatch && STRONG.includes(rawMatch)) {
    verification_status = "verified";
    verified = true;
  } else if (rawMatch && MODERATE.includes(rawMatch)) {
    // A real match, but not a strong one: verify, and say so on the panel.
    verification_status = "verified";
    verified = true;
    message = `Name matched partially (${rawMatch}${Number.isFinite(score) ? `, score ${score}` : ""}).`;
  } else if (rawMatch && WEAK.includes(rawMatch)) {
    verification_status = "name_mismatch";
    message = `Cashfree scored the name as ${rawMatch}${Number.isFinite(score) ? ` (${score})` : ""}.`;
  } else if (nameAtBank && name && String(nameAtBank).toUpperCase().replace(/[^A-Z]/g, "") === String(name).toUpperCase().replace(/[^A-Z]/g, "")) {
    // Account VALID and the bank's name matches the entered name exactly (normalised).
    verification_status = "verified";
    verified = true;
    message = "Account valid and name at bank matches.";
  } else if (nameAtBank && name) {
    verification_status = "name_mismatch";
    message = `Name at bank (${nameAtBank}) does not match the name entered (${name}).`;
  } else if (nameAtBank) {
    // The account exists and is valid, but Secure ID returned no name verdict.
    // Claiming a match here would be a fake success.
    verification_status = "name_unverified";
    message = "Account found at the bank, but Secure ID did not return a name match.";
  } else {
    verification_status = "unverified";
    message = asText(b.message) || "Secure ID returned no bank details.";
  }

  return {
    verified,
    verification_status,
    name_at_bank: nameAtBank,
    name_match_result: rawMatch,
    name_match_score: Number.isFinite(score) ? score : null,
    account_status: accountStatus,
    bank_name: asText(b.bank_name) || null,
    message,
  };
}

/* ------------------------------------------------------------------ */
/* Payment links                                                       */
/* ------------------------------------------------------------------ */

const RETURN_BASE = (process.env.FUNCTION_URL || "").replace(/\/+$/, "");

function paymentFor(item) {
  const p = item?.payment?.M;
  if (!p) return null;
  const out = {
    link_id: p.link_id?.S || null,
    link_url: p.link_url?.S || null,
    amount: p.amount?.N ? Number(p.amount.N) : null,
    status: p.status?.S || null,
    created_at: p.created_at?.S || null,
    updated_at: p.updated_at?.S || null,
  };
  if (p.error?.S) out.error = p.error.S;
  return out;
}

function linkPurpose(agreement) {
  const scope = asArray(agreement?.scope).map((s) => String(s).trim()).filter(Boolean);
  const summary = scope.slice(0, 3).join(", ") || asText(agreement?.work_type) || "service work";
  return `SaudaSakshi escrow: ${summary}`.slice(0, 500);
}

// Phone for the Cashfree customer record: the client's phone when we know one.
function clientPhone(item, agreement) {
  const candidates = [
    agreement?.parties?.client?.phone,
    agreement?.client_phone,
    cleanPhone(agreement?.parties?.client?.name),
    cleanPhone(item?.client_uid?.S),
    cleanPhone(item?.created_by?.S),
  ];
  for (const c of candidates) {
    const phone = cleanPhone(c);
    if (phone) return phone;
  }
  return "9999999999";
}

function clientName(item, agreement) {
  return (
    asText(agreement?.parties?.client?.name) ||
    asText(item?.created_by_name?.S) ||
    asText(item?.client_uid?.S) ||
    "Client"
  ).slice(0, 100);
}

async function storePayment(id, payment) {
  const now = new Date().toISOString();
  const m = {};
  for (const [k, v] of Object.entries(payment)) {
    if (v === null || v === undefined) continue;
    m[k] = typeof v === "number" ? { N: String(v) } : { S: String(v) };
  }
  await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { id: { S: id } },
      UpdateExpression: "SET payment = :p",
      ExpressionAttributeValues: { ":p": { M: m } },
    })
  );
  return now;
}

// Creates the escrow payment link exactly once per agreement.
//
// The claim is a conditional write of payment.link_id, so two concurrent
// completion paths (grokbot callback + Sarvam inline, or a refresh racing a
// webhook) can never mint two links for the same agreement.
async function ensurePaymentLink(id, agreement) {
  const price = Number(agreement?.price_inr);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!CASHFREE_APP_ID || !CASHFREE_PG_SECRET) {
    console.error(JSON.stringify({ evt: "payment_link_skipped", id, reason: "cashfree_not_configured" }));
    return null;
  }

  const current = await getItem(id);
  if (!current) return null;
  const existing = paymentFor(current);
  if (existing?.link_id) {
    // A link already exists: never create another. If a previous attempt died
    // before the URL was stored, recover it from Cashfree instead.
    if (existing.link_url) return existing;
    // Still in flight in another invocation — do not race it.
    if (existing.status === "CREATING") return null;
    const recovered = await recoverLinkUrl(id, existing);
    if (recovered) return recovered;
    return existing;
  }

  const linkId = `ss_${String(id).slice(0, 12)}_${Date.now()}`;
  const claimedAt = new Date().toISOString();

  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { id: { S: id } },
        UpdateExpression: "SET payment = :p",
        ConditionExpression:
          "attribute_not_exists(payment) OR attribute_not_exists(payment.link_id)",
        ExpressionAttributeValues: {
          ":p": {
            M: {
              link_id: { S: linkId },
              amount: { N: String(price) },
              status: { S: "CREATING" },
              created_at: { S: claimedAt },
            },
          },
        },
      })
    );
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      // Someone else won the race; use their link.
      return paymentFor(await getItem(id));
    }
    throw err;
  }

  const payload = {
    link_id: linkId,
    link_amount: price,
    link_currency: "INR",
    link_purpose: linkPurpose(agreement),
    customer_details: {
      customer_phone: clientPhone(current, agreement),
      customer_name: clientName(current, agreement),
    },
    link_notify: { send_sms: false, send_email: false },
    link_meta: {
      return_url: RETURN_BASE ? `${RETURN_BASE}/?agreement=${encodeURIComponent(id)}` : "",
    },
    link_notes: { agreement_id: id },
  };

  let res;
  try {
    res = await cashfreeFetch("/pg/links", { method: "POST", body: payload });
  } catch (err) {
    await releaseLinkClaim(id, `Payment link call failed: ${String(err?.message || err)}`);
    return null;
  }

  if (!res.ok || !res.body?.link_url) {
    await releaseLinkClaim(id, cashfreeMessage(res, "Cashfree rejected the payment link"));
    return null;
  }

  const payment = {
    link_id: res.body.link_id || linkId,
    link_url: res.body.link_url,
    amount: price,
    status: String(res.body.link_status || "ACTIVE").toUpperCase(),
    created_at: claimedAt,
    updated_at: new Date().toISOString(),
  };
  await storePayment(id, payment);
  console.log(JSON.stringify({ evt: "payment_link_created", id, link_id: payment.link_id, amount: price }));
  return payment;
}

// No link was actually created, so drop the claim and record why.
async function releaseLinkClaim(id, message) {
  const msg = String(message || "payment link failed").slice(0, 300);
  console.error(JSON.stringify({ evt: "payment_link_failed", id, error: msg }));
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { id: { S: id } },
        UpdateExpression: "SET payment.#s = :s, payment.error = :e REMOVE payment.link_id",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": { S: "link_failed" }, ":e": { S: msg } },
      })
    );
  } catch (err) {
    console.error(JSON.stringify({ evt: "payment_release_failed", id, error: String(err?.message || err) }));
  }
}

// A claimed link whose URL never landed: ask Cashfree for it rather than
// creating a second one.
async function recoverLinkUrl(id, payment) {
  try {
    const res = await cashfreeFetch(`/pg/links/${encodeURIComponent(payment.link_id)}`);
    if (!res.ok || !res.body?.link_url) return null;
    const next = {
      ...payment,
      link_url: res.body.link_url,
      status: String(res.body.link_status || payment.status || "ACTIVE").toUpperCase(),
      amount: Number(res.body.link_amount) || payment.amount,
      updated_at: new Date().toISOString(),
    };
    await storePayment(id, next);
    return next;
  } catch {
    return null;
  }
}

async function markInEscrow(id, source) {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { id: { S: id } },
        UpdateExpression: "SET #s = :s, in_escrow_at = :now, updated_at = :now",
        ConditionExpression: "attribute_exists(id) AND #s <> :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": { S: "in_escrow" }, ":now": { S: now } },
      })
    );
  } catch (err) {
    if (err?.name !== "ConditionalCheckFailedException") throw err;
    return false;
  }
  console.log(JSON.stringify({ evt: "in_escrow", id, source }));
  return true;
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

async function createAgreement(event) {
  const caller = callerFrom(event);
  if (!caller.uid) return json(401, { error: "X-User-Id header is required" });

  const body = readBody(event);
  const transcript = typeof body === "string" ? body : asText(body?.transcript);
  if (!transcript || transcript.trim().length < 10) {
    return json(400, { error: "body must be JSON {transcript} with at least 10 characters" });
  }

  const rawRole = cleanId(body?.my_role);
  if (rawRole !== null && !ROLES.includes(rawRole)) {
    return json(400, { error: 'my_role must be "client" or "provider"' });
  }
  const myRole = rawRole || ROLE_CLIENT;

  const counterpartyUid = cleanId(body?.counterparty_uid);
  if (counterpartyUid !== null && counterpartyUid === caller.uid) {
    return json(400, { error: "counterparty_uid cannot be your own user ID" });
  }

  const id = randomUUID();
  const cbToken = randomBytes(24).toString("hex");
  await putPending(id, transcript, cbToken, {
    uid: caller.uid,
    name: caller.name,
    role: myRole,
    counterpartyUid,
  });

  if (GROKBOT_WEBHOOK_URL) {
    const callbackUrl = `${originFor(event)}/agreements/${id}/callback?t=${cbToken}`;
    try {
      const headers = { "content-type": "application/json" };
      if (GROKBOT_WEBHOOK_KEY) headers[GROKBOT_WEBHOOK_AUTH_HEADER] = GROKBOT_WEBHOOK_KEY;
      const res = await fetch(GROKBOT_WEBHOOK_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ id, transcript, callback_url: callbackUrl }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`grokbot webhook ${res.status}`);
      await markWriter(id, WRITER_GROKBOT);
      console.log(JSON.stringify({ evt: "grokbot_dispatched", id, status: res.status }));
      return json(202, { id, status: "pending" });
    } catch (err) {
      console.error(JSON.stringify({ evt: "grokbot_failed", id, error: String(err?.message || err) }));
      // fall through to Sarvam
    }
  }

  // Sarvam inline (Lambda cannot fire-and-forget reliably)
  try {
    const agreement = await callSarvam(transcript, id);
    await markDone(id, agreement, WRITER_SARVAM);
    console.log(JSON.stringify({ evt: "sarvam_done", id, status: agreement.status }));
    await ensurePaymentLink(id, agreement);
    return json(201, { id, status: "done" });
  } catch (err) {
    console.error(JSON.stringify({ evt: "sarvam_failed", id, error: String(err?.message || err) }));
    const agreement = fallbackAgreement(transcript, id, String(err?.message || err));
    await markDone(id, agreement, WRITER_SARVAM);
    await ensurePaymentLink(id, agreement);
    return json(201, { id, status: "done", degraded: true });
  }
}

async function getAgreement(id, event) {
  const caller = callerFrom(event);
  const item = await getItem(id);
  if (!item) return json(404, { error: "not found" });
  if (!caller.uid) return json(401, { error: "X-User-Id header is required" });
  if (!canRead(item, caller.uid)) return json(403, { error: "not a party to this agreement" });

  const out = {
    id: item.id?.S,
    status: item.status?.S || "pending",
    created_by: item.created_by?.S || null,
    creator_role: item.creator_role?.S || null,
    parties: partiesSummary(item),
    accepted_by_client: item.accepted_by_client?.S || null,
    accepted_by_provider: item.accepted_by_provider?.S || null,
    my_role: null,
  };
  if (out.accepted_by_client && out.accepted_by_provider) out.accepted_at = item.accepted_at?.S || null;

  if (item.client_uid?.S === caller.uid) out.my_role = ROLE_CLIENT;
  else if (item.provider_uid?.S === caller.uid) out.my_role = ROLE_PROVIDER;
  else out.my_role = item.creator_role?.S || null;

  const agreement = parseAgreementJson(item);
  if (agreement) out.agreement = agreement;
  if (item.created_at?.S) out.created_at = item.created_at.S;
  if (item.completed_at?.S) out.completed_at = item.completed_at.S;
  if (item.in_escrow_at?.S) out.in_escrow_at = item.in_escrow_at.S;

  const payment = paymentFor(item);

  // Agreements drafted before escrow links existed: backfill once, lazily, for a
  // priced draft. Never mints a second link (ensurePaymentLink is idempotent).
  if (!payment && (item.status?.S === "done" || item.status?.S === "accepted" || item.status?.S === "in_escrow")) {
    const agreementForLink = parseAgreementJson(item);
    if (agreementForLink) {
      try {
        await ensurePaymentLink(id, agreementForLink);
        const fresh = await getItem(id);
        if (fresh) {
          item.payment = fresh.payment;
          item.status = fresh.status;
          out.status = fresh.status?.S || out.status;
        }
      } catch (err) {
        console.error(JSON.stringify({ evt: "payment_backfill_error", id, error: String(err?.message || err) }));
      }
    }
  }

  if (item.payment) out.payment = paymentFor(item);

  // A provider bank badge only ever exposes the masked account.
  if (out.parties.provider_uid) {
    const provider = await getProvider(out.parties.provider_uid);
    if (provider) out.provider_bank = providerBadge(provider);
  }
  if (out.parties.client_uid) {
    try {
      const client = await getProvider(out.parties.client_uid);
      if (client) out.client_bank = providerBadge(client);
    } catch {}
  }

  return json(200, out);
}

async function listAgreements(event) {
  const caller = callerFrom(event);
  if (!caller.uid) return json(401, { error: "X-User-Id header is required" });

  const items = await scanForUser(caller.uid);
  const rows = items
    .filter((it) => canRead(it, caller.uid))
    .map(listRow)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  return json(200, { agreements: rows, count: rows.length });
}

async function acceptAgreement(id, event) {
  const caller = callerFrom(event);
  if (!caller.uid) return json(401, { error: "X-User-Id header is required" });

  const item = await getItem(id);
  if (!item) return json(404, { error: "not found" });
  if (!canRead(item, caller.uid)) return json(403, { error: "not a party to this agreement" });

  const st = item.status?.S;
  if (st !== "done" && st !== "accepted" && st !== "in_escrow") {
    return json(409, { error: "agreement is still being drafted; accept once it is ready" });
  }

  const isClient = item.client_uid?.S === caller.uid;
  const isProvider = item.provider_uid?.S === caller.uid;
  if (!isClient && !isProvider) {
    // The creator of a role-less agreement cannot accept as that role.
    return json(
      409,
      { error: "set your role on the agreement before accepting (POST with my_role)" }
    );
  }

  const now = new Date().toISOString();
  const role = isClient ? ROLE_CLIENT : ROLE_PROVIDER;
  const field = isClient ? "accepted_by_client" : "accepted_by_provider";
  const values = { ":u": { S: caller.uid }, ":now": { S: now } };
  let expr = `SET ${field} = :u, updated_at = :now`;
  // Never downgrade an escrow-funded agreement back to "accepted".
  if (st === "done" && isClient && item.accepted_by_provider?.S) {
    expr += ", #s = :s, accepted_at = :now";
    values[":s"] = { S: "accepted" };
  } else if (st === "done" && isProvider && item.accepted_by_client?.S) {
    expr += ", #s = :s, accepted_at = :now";
    values[":s"] = { S: "accepted" };
  }

  const params = {
    TableName: TABLE,
    Key: { id: { S: id } },
    UpdateExpression: expr,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW",
  };
  if (values[":s"]) params.ExpressionAttributeNames = { "#s": "status" };

  const out = await ddb.send(new UpdateItemCommand(params));
  const updated = out.Attributes || {};

  const client = updated.accepted_by_client?.S || null;
  const provider = updated.accepted_by_provider?.S || null;
  const both = !!(client && provider);
  console.log(JSON.stringify({ evt: "accept", id, role, both, by: caller.uid }));

  return json(200, {
    id,
    accepted_by_client: client,
    accepted_by_provider: provider,
    accepted_by_me: role,
    fully_accepted: both,
    status: updated.status?.S || (both ? "accepted" : item.status?.S || "pending"),
    accepted_at: updated.accepted_at?.S || null,
  });
}


async function receiveCallback(id, token, event) {
  const item = await getItem(id);
  if (!item) return json(404, { error: "not found" });
  if (!token || !item.cb_token?.S || token !== item.cb_token.S) {
    return json(403, { error: "invalid token" });
  }

  const body = readBody(event);
  let payload = body;
  if (payload && typeof payload === "object" && payload.agreement && typeof payload.agreement === "object" && !payload.parties) {
    payload = payload.agreement;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json(400, { error: "callback body must be the agreement JSON object" });
  }

  const writer = item.writer?.S || WRITER_GROKBOT;
  const agreement = normalizeAgreement(payload, id);
  await markDone(id, agreement, writer);
  console.log(JSON.stringify({ evt: "callback_done", id, writer }));
  // Escrow link for a priced, fully drafted agreement (idempotent).
  await ensurePaymentLink(id, agreement);
  return json(200, { ok: true });
}

/* ------------------------------------------------------------------ */
/* Providers (Secure ID bank check)                                    */
/* ------------------------------------------------------------------ */

async function createProvider(event) {
  const caller = callerFrom(event);
  if (!caller.uid) return json(401, { error: "X-User-Id header is required" });

  const body = readBody(event);
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body === "string") {
    return json(400, { error: "body must be a JSON object" });
  }

  const fullName = cleanId(body.full_name ?? body.name)?.slice(0, 120) || null;
  const phone = cleanPhone(body.phone);
  const account = cleanAccount(body.bank_account ?? body.bank_account_number);
  const ifsc = String(body.ifsc ?? "").replace(/\s+/g, "").toUpperCase();
  const workType = cleanId(body.work_type)?.toLowerCase() || null;

  const problems = [];
  if (!fullName || fullName.length < 2) problems.push({ field: "full_name", error: "full name is required" });
  if (!phone) problems.push({ field: "phone", error: "a 10-digit Indian phone number is required" });
  if (!account) problems.push({ field: "bank_account", error: "bank account number must be 9-18 digits" });
  if (!IFSC_RE.test(ifsc)) problems.push({ field: "ifsc", error: "IFSC must look like YESB0000262" });
  if (!workType || !WORK_TYPES.includes(workType)) {
    problems.push({ field: "work_type", error: 'work_type must be "physical", "professional" or "digital"' });
  }
  if (problems.length) return json(400, { error: "invalid provider details", problems });

  const check = await verifyBankAccount({ account, ifsc, name: fullName, phone });

  const now = new Date().toISOString();
  const id = providerId(caller.uid);
  const existing = await getProvider(caller.uid);

  const item = {
    id: { S: id },
    entity: { S: "provider" },
    uid: { S: caller.uid },
    full_name: { S: fullName },
    phone: { S: phone },
    ifsc: { S: ifsc },
    bank_account_masked: { S: maskAccount(account) },
    bank_account_last4: { S: last4(account) },
    work_type: { S: workType },
    verified: { BOOL: check.verified === true },
    verification_status: { S: check.verification_status },
    created_at: { S: existing?.created_at?.S || now },
    updated_at: { S: now },
  };
  if (check.name_at_bank) item.name_at_bank = { S: String(check.name_at_bank).slice(0, 200) };
  if (check.name_match_result) item.name_match_result = { S: check.name_match_result };
  if (Number.isFinite(check.name_match_score)) item.name_match_score = { N: String(check.name_match_score) };
  if (check.account_status) item.account_status = { S: check.account_status };
  if (check.bank_name) item.bank_name = { S: String(check.bank_name).slice(0, 120) };
  if (check.message) item.cashfree_message = { S: String(check.message).slice(0, 300) };

  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: item }));

  console.log(
    JSON.stringify({
      evt: "provider_saved",
      uid: caller.uid,
      verified: item.verified.BOOL,
      verification_status: check.verification_status,
      cashfree_http: check.http_status ?? 200,
    })
  );

  // 201 for a fresh record, 200 when re-verifying an existing one.
  return json(existing ? 200 : 201, { provider: providerPublic(item) });
}

async function getMyProvider(event) {
  const caller = callerFrom(event);
  if (!caller.uid) return json(401, { error: "X-User-Id header is required" });
  const item = await getProvider(caller.uid);
  if (!item) return json(404, { error: "no provider profile for this user ID" });
  return json(200, { provider: providerPublic(item) });
}

/* ------------------------------------------------------------------ */
/* Payment status + webhook                                            */
/* ------------------------------------------------------------------ */

async function getPaymentStatus(id, event) {
  const caller = callerFrom(event);
  if (!caller.uid) return json(401, { error: "X-User-Id header is required" });
  const item = await getItem(id);
  if (!item) return json(404, { error: "not found" });
  if (!canRead(item, caller.uid)) return json(403, { error: "not a party to this agreement" });

  let payment = paymentFor(item);

  if (payment?.link_id && CASHFREE_APP_ID && CASHFREE_PG_SECRET) {
    try {
      const res = await cashfreeFetch(`/pg/links/${encodeURIComponent(payment.link_id)}`);
      if (res.ok && res.body) {
        const remote = String(res.body.link_status || payment.status || "ACTIVE").toUpperCase();
        const paid = Number(res.body.link_amount_paid) || 0;
        const next = {
          ...payment,
          status: remote,
          amount: Number(res.body.link_amount) || payment.amount,
          updated_at: new Date().toISOString(),
        };
        if (paid > 0) next.amount_paid = paid;
        if (remote !== payment.status) await storePayment(id, next);
        payment = next;
        if (remote === "PAID") {
          await markInEscrow(id, "payment_refresh");
          const fresh = await getItem(id);
          if (fresh && fresh.status?.S) item.status = fresh.status;
        }
      } else {
        console.error(
          JSON.stringify({ evt: "payment_refresh_failed", id, status: res.status, error: cashfreeMessage(res, "link fetch failed") })
        );
      }
    } catch (err) {
      console.error(JSON.stringify({ evt: "payment_refresh_error", id, error: String(err?.message || err) }));
    }
  }

  return json(200, {
    id,
    status: item.status?.S || null,
    payment,
  });
}

function verifyCashfreeSignature(event, rawBody) {
  const secret = CASHFREE_PG_SECRET;
  if (!secret) return { ok: false, reason: "webhook_secret_missing" };
  const signature = header(event, "x-webhook-signature");
  const timestamp = header(event, "x-webhook-timestamp");
  if (!signature || !timestamp) return { ok: false, reason: "missing_signature_headers" };

  const expected = createHmac("sha256", secret)
    .update(String(timestamp) + rawBody)
    .digest("base64");
  const got = String(signature).trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return { ok: false, reason: "signature_mismatch" };
  return { ok: timingSafeEqual(a, b), reason: timingSafeEqual(a, b) ? null : "signature_mismatch" };
}

async function receiveCashfreeWebhook(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : typeof event.body === "string"
      ? event.body
      : "";

  const sig = verifyCashfreeSignature(event, rawBody);
  if (!sig.ok) {
    console.error(JSON.stringify({ evt: "cashfree_webhook_rejected", reason: sig.reason }));
    return json(401, { error: "invalid signature" });
  }

  let body = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return json(400, { error: "body must be JSON" });
  }

  const type = body?.type || body?.event_type || null;
  const data = body?.data || body?.payload || {};
  const link = data?.payment_link || data?.link || data?.order || {};
  const linkStatus = String(
    data?.link_status || link?.link_status || data?.payment?.payment_status || ""
  ).toUpperCase();
  const linkId = data?.link_id || link?.link_id || null;
  const agreementId =
    data?.link_notes?.agreement_id ||
    link?.link_notes?.agreement_id ||
    data?.order?.order_tags?.agreement_id ||
    null;

  console.log(JSON.stringify({ evt: "cashfree_webhook", type, link_id: linkId, link_status: linkStatus }));

  if (type === "PAYMENT_LINK_EVENT" && linkStatus === "PAID") {
    const id = agreementId || (linkId ? await findAgreementByLinkId(linkId) : null);
    if (id) {
      const item = await getItem(id);
      if (item) {
        const pay = paymentFor(item);
        if (pay) {
          await storePayment(id, { ...pay, status: "PAID", updated_at: new Date().toISOString() });
        }
        await markInEscrow(id, "webhook");
      }
    }
  }

  return json(200, { ok: true });
}

async function findAgreementByLinkId(linkId) {
  // Demo-scale fallback: the note carries the id, but scan if it was stripped.
  let startKey;
  do {
    const out = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "payment.link_id = :l",
        ExpressionAttributeValues: { ":l": { S: String(linkId) } },
        ExclusiveStartKey: startKey,
      })
    );
    if (out.Items?.length) return out.Items[0].id?.S || null;
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return null;
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export const handler = async (event = {}) => {
  const method = (event.requestContext?.http?.method || event.httpMethod || "GET").toUpperCase();
  const path = event.rawPath || event.path || "/";
  const query = event.queryStringParameters || parseQuery(event.rawQueryString);

  if (method === "OPTIONS") return { statusCode: 204, headers: { ...CORS }, body: "" };

  try {
    if (path === "/" || path === "/index.html") {
      if (method !== "GET" && method !== "HEAD") return json(405, { error: "method not allowed" });
      return html(pageHtml());
    }

    if (path === "/health") return json(200, { ok: true, service: "saudasakshi-engine" });

    if (path === "/agreements" || path === "/agreements/") {
      if (method === "POST") return await createAgreement(event);
      if (method === "GET") return await listAgreements(event);
      return json(405, { error: "method not allowed" });
    }

    const cbMatch = path.match(/^\/agreements\/([^/]+)\/callback\/?$/);
    if (cbMatch) {
      if (method !== "POST") return json(405, { error: "method not allowed" });
      // Token-based, deliberately independent of X-User-Id.
      return await receiveCallback(decodeURIComponent(cbMatch[1]), query.t, event);
    }

    const acceptMatch = path.match(/^\/agreements\/([^/]+)\/accept\/?$/);
    if (acceptMatch) {
      if (method !== "POST") return json(405, { error: "method not allowed" });
      return await acceptAgreement(decodeURIComponent(acceptMatch[1]), event);
    }

    const payMatch = path.match(/^\/agreements\/([^/]+)\/payment\/?$/);
    if (payMatch) {
      if (method !== "GET") return json(405, { error: "method not allowed" });
      return await getPaymentStatus(decodeURIComponent(payMatch[1]), event);
    }

    const getMatch = path.match(/^\/agreements\/([^/]+)\/?$/);
    if (getMatch) {
      if (method !== "GET") return json(405, { error: "method not allowed" });
      return await getAgreement(decodeURIComponent(getMatch[1]), event);
    }

    if (path === "/speak" || path === "/speak/") {
      if (method !== "POST") return json(405, { error: "method not allowed" });
      return await speakText(event);
    }

    if (path === "/transcribe" || path === "/transcribe/") {
      if (method !== "POST") return json(405, { error: "method not allowed" });
      return await transcribeAudio(event);
    }

    if (path === "/providers" || path === "/providers/") {
      if (method !== "POST") return json(405, { error: "method not allowed" });
      return await createProvider(event);
    }

    if (path === "/providers/me" || path === "/providers/me/") {
      if (method !== "GET") return json(405, { error: "method not allowed" });
      return await getMyProvider(event);
    }

    if (path === "/webhooks/cashfree" || path === "/webhooks/cashfree/") {
      if (method !== "POST") return json(405, { error: "method not allowed" });
      return await receiveCashfreeWebhook(event);
    }

    return json(404, { error: "not found", path });
  } catch (err) {
    console.error(JSON.stringify({ evt: "unhandled", path, method, error: String(err?.stack || err) }));
    return json(500, { error: "internal error" });
  }
};
