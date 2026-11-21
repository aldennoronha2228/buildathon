#!/usr/bin/env node
// End-to-end API test against the deployed Lambda.
// Usage: node tests/api-test.mjs [baseUrl]
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] || "https://hbdbo7fzhqpji6npunwokvrabq0ptjfs.lambda-url.ap-south-1.on.aws").replace(/\/+$/, "");
const here = (p) => new URL(p, import.meta.url);
const house = JSON.parse(readFileSync(here("./sample-house.json"), "utf8"));
const ca = JSON.parse(readFileSync(here("./sample-ca.json"), "utf8"));

// Identity is required on every agreement call.
const UID = process.env.TEST_UID || `api-test-${Date.now()}`;
const UNAME = "API Test";
const H = { "content-type": "application/json", "x-user-id": UID, "x-user-name": UNAME };

const results = [];
const check = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass, extra });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(id, maxMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${BASE}/agreements/${id}`, { cache: "no-store", headers: H });
    const data = await res.json();
    if (data.status === "done" && data.agreement) return data;
    await sleep(2000);
  }
  throw new Error(`timeout waiting for ${id}`);
}

// 1. HTML
const root = await fetch(BASE + "/");
const html = await root.text();
check("GET / -> 200 HTML", root.status === 200 && /text\/html/.test(root.headers.get("content-type") || ""));
check('title "SaudaSakshi"', /<title>SaudaSakshi<\/title>/.test(html));
check("textarea labelled 'Paste the conversation transcript'", /Paste the conversation transcript/.test(html));
check("two sample buttons", (html.match(/Sample:/g) || []).length === 2);
check("polls every 2s", /setTimeout\(r, 2000\)/.test(html));

// 2. Hindi sample
const t0 = Date.now();
const created = await fetch(`${BASE}/agreements`, {
  method: "POST",
  headers: H,
  body: JSON.stringify(house),
});
const createdBody = await created.json();
check("POST /agreements returns id", !!createdBody.id, `writer=${createdBody.writer} in ${Date.now() - t0}ms`);

const done = await waitFor(createdBody.id);
const a = done.agreement;
check("GET /agreements/{id} status done", done.status === "done");
check("writer field present", ["grokbot", "sarvam-105b"].includes(done.writer), done.writer);
check("no transcript/token leaked", !("transcript" in done) && !("cb_token" in done));
check("price 60000", a.price_inr === 60000, String(a.price_inr));
check("escrow = full price", a.escrow?.amount_inr === 60000 && /releas|verif|after|kaam/i.test(a.escrow?.release_condition || ""), a.escrow?.release_condition);
check("location address", /Flat 302, Green Glen Layout, Bellandur, Bengaluru/.test(a.location || ""), a.location);
check("proof required mentions photos", (a.proof_required || []).join(" ").toLowerCase().includes("photo"));
check("verification_checks non-empty", (a.verification_checks || []).length > 0);
check("deadline present", !!a.deadline, a.deadline);
check("English agreement text", (a.agreement_text?.en || "").length > 200);
check("local agreement text (Devanagari)", /[\u0900-\u097F]/.test(a.agreement_text?.local || ""));
check("reasoning non-empty", (a.reasoning || []).length > 0);

// 3. CA sample — no deadline in transcript, must be flagged
const caCreated = await fetch(`${BASE}/agreements`, {
  method: "POST",
  headers: H,
  body: JSON.stringify(ca),
});
const caBody = await caCreated.json();
const caDone = await waitFor(caBody.id);
const c = caDone.agreement;
const missingText = JSON.stringify(c.missing_terms || []);
check("CA price 3000", c.price_inr === 3000, String(c.price_inr));
check("CA deadline flagged missing", c.deadline === null && /deadline/i.test(missingText));
check("CA missing term has a question", (c.missing_terms || []).every((m) => m.term && m.question && m.question.length > 5));
check("CA proof = ITR-V", /itr-?v/i.test((c.proof_required || []).join(" ")), (c.proof_required || []).join(" | "));

// 4. Callback auth (token based, no identity header)
const badTok = await fetch(`${BASE}/agreements/${caBody.id}/callback?t=wrong`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
check("callback with bad token -> 403", badTok.status === 403, String(badTok.status));
const noTok = await fetch(`${BASE}/agreements/${caBody.id}/callback`, { method: "POST", body: "{}" });
check("callback with no token -> 403", noTok.status === 403, String(noTok.status));

// 5. Misc
// The Cashfree webhook now verifies x-webhook-signature (HMAC-SHA256 of
// timestamp+rawBody), so an unsigned POST is rejected instead of accepted.
const cf = await fetch(`${BASE}/webhooks/cashfree`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ event: "PAYMENT_SUCCESS", order_id: "ord_1" }),
});
check("unsigned cashfree webhook -> 401", cf.status === 401, String(cf.status));
const missing = await fetch(`${BASE}/agreements/00000000-0000-0000-0000-000000000000`, { headers: H });
check("unknown id -> 404", missing.status === 404);
const badBody = await fetch(`${BASE}/agreements`, { method: "POST", headers: H, body: "{}" });
check("POST /agreements without transcript -> 400", badBody.status === 400);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} API checks passed`);
process.exit(failed.length ? 1 : 0);
