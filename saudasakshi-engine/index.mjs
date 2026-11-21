/**
 * SaudaSakshi engine — one Lambda, no frameworks.
 *
 * GET  /                              -> single page UI
 * POST /agreements                    -> {transcript, counterparty_uid?, my_role?} => {id}   (X-User-Id required)
 * GET  /agreements                    -> my agreements, newest first                        (X-User-Id required)
 * POST /agreements/{id}/accept        -> the signed-in party accepts                       (X-User-Id required)
 * POST /agreements/{id}/callback?t=   -> grokbot webhook callback (token auth, no user id)
 * GET  /agreements/{id}               -> {id, status, writer, agreement?} — parties only
 * POST /webhooks/cashfree             -> placeholder
 */
import { randomUUID, randomBytes } from "node:crypto";
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
- missing_terms question is written in the speakers' language (Hindi/Hinglish transcript => Hindi/Hinglish question).
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
        ? { term: m, question: "Please confirm this term." }
        : { term: asText(m?.term) || "unspecified term", question: asText(m?.question) || "Please confirm this term." }
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
        { term: "scope", question: "Exactly what work is included? Please confirm." },
        { term: "proof", question: "What proof will show the work is done? Please confirm." },
        { term: "deadline", question: "By when should the work be finished? Please confirm." },
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
      return json(202, { id, writer: WRITER_GROKBOT, status: "pending" });
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
    return json(201, { id, writer: WRITER_SARVAM, status: "done" });
  } catch (err) {
    console.error(JSON.stringify({ evt: "sarvam_failed", id, error: String(err?.message || err) }));
    const agreement = fallbackAgreement(transcript, id, String(err?.message || err));
    await markDone(id, agreement, WRITER_SARVAM);
    return json(201, { id, writer: WRITER_SARVAM, status: "done", degraded: true });
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
    writer: item.writer?.S || null,
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
  if (isClient && item.accepted_by_provider?.S) {
    expr += ", #s = :s, accepted_at = :now";
    values[":s"] = { S: "accepted" };
  } else if (isProvider && item.accepted_by_client?.S) {
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
  return json(200, { ok: true });
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

    const getMatch = path.match(/^\/agreements\/([^/]+)\/?$/);
    if (getMatch) {
      if (method !== "GET") return json(405, { error: "method not allowed" });
      return await getAgreement(decodeURIComponent(getMatch[1]), event);
    }

    if (path === "/webhooks/cashfree" || path === "/webhooks/cashfree/") {
      if (method !== "POST") return json(405, { error: "method not allowed" });
      console.log(JSON.stringify({ evt: "cashfree_webhook", body: readBody(event) }));
      return json(200, { ok: true });
    }

    return json(404, { error: "not found", path });
  } catch (err) {
    console.error(JSON.stringify({ evt: "unhandled", path, method, error: String(err?.stack || err) }));
    return json(500, { error: "internal error" });
  }
};
