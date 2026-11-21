#!/usr/bin/env node
// Unit tests for the Secure ID verdict ladder and provider masking.
// Stubs global fetch, so it needs no network and no credentials.
//
// Usage: node tests/secure-id-unit.mjs
import { readFileSync } from "node:fs";

const results = [];
const check = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass, extra });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

process.env.AGREEMENTS_TABLE = process.env.AGREEMENTS_TABLE || "saudasakshi-agreements";
process.env.AWS_REGION = process.env.AWS_REGION || "ap-south-1";
process.env.FUNCTION_URL = "https://example.test/";
// Fake credentials: nothing is signed with them because the VRS public key is unset.
process.env.CASHFREE_APP_ID = "test_app_id";
process.env.CASHFREE_PG_SECRET = "test_pg_secret";
delete process.env.CASHFREE_VRS_PUBLIC_KEY;
delete process.env.CASHFREE_VRS_CLIENT_ID;
delete process.env.CASHFREE_VRS_SECRET;

const realFetch = globalThis.fetch;
let queued = [];

// Every handler() call that reaches Cashfree pops the next scripted response.
globalThis.fetch = async () => {
  if (!queued.length) throw new Error("unexpected fetch");
  const r = queued.shift();
  return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), {
    status: r.status ?? 200,
    headers: { "content-type": "application/json" },
  });
};

const { handler } = await import("../index.mjs");

const call = (path, method, headers, body) =>
  handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers: { host: "example.test", "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const ACCOUNT = "026291800001191";
const GOOD = {
  full_name: "John Doe",
  phone: "9876543210",
  bank_account: ACCOUNT,
  ifsc: "YESB0000262",
  work_type: "physical",
};

let n = 0;
const freshUid = () => `unit-${++n}-${Date.now()}`;

async function register(response, overrides = {}) {
  queued = [response];
  const res = await call("/providers", "POST", { "x-user-id": freshUid() }, { ...GOOD, ...overrides });
  // handler() returns a plain Lambda response, not a fetch Response.
  const body = JSON.parse(res.body || "{}");
  return { status: res.statusCode, provider: body.provider || {}, raw: body };
}

/* ---------------------------------------------------------------- verdicts */
const direct = await register({
  body: {
    name_at_bank: "JOHN DOE",
    name_match_result: "DIRECT_MATCH",
    name_match_score: "100.00",
    account_status: "VALID",
    bank_name: "YES BANK",
  },
});
check("DIRECT_MATCH -> verified", direct.provider.verified === true && direct.provider.verification_status === "verified", direct.provider.verification_status);
check("verified keeps the name at bank", direct.provider.name_at_bank === "JOHN DOE", String(direct.provider.name_at_bank));
check("verified keeps the match result", direct.provider.name_match_result === "DIRECT_MATCH", String(direct.provider.name_match_result));
check("verified keeps the numeric score", direct.provider.name_match_score === 100, String(direct.provider.name_match_score));

const good = await register({
  body: { name_at_bank: "JOHN DOE", name_match_result: "GOOD_PARTIAL_MATCH", name_match_score: "88.00", account_status: "VALID" },
});
check("GOOD_PARTIAL_MATCH -> verified", good.provider.verified === true, good.provider.verification_status);

const moderate = await register({
  body: { name_at_bank: "JOHN DOE", name_match_result: "MODERATE_PARTIAL_MATCH", name_match_score: "70.00", account_status: "VALID" },
});
check("MODERATE_PARTIAL_MATCH -> verified", moderate.provider.verified === true, moderate.provider.verification_status);
check("MODERATE_PARTIAL_MATCH explains itself", /partial/i.test(moderate.provider.message || ""), String(moderate.provider.message));

const poor = await register({
  body: { name_at_bank: "JOHN DOE", name_match_result: "POOR_PARTIAL_MATCH", name_match_score: "38.00", account_status: "VALID" },
});
check("POOR_PARTIAL_MATCH -> name_mismatch, not verified", poor.provider.verified === false && poor.provider.verification_status === "name_mismatch", poor.provider.verification_status);
check("POOR_PARTIAL_MATCH keeps Cashfree's scoring language", /POOR_PARTIAL_MATCH/.test(poor.provider.message || ""), String(poor.provider.message));

const none = await register({
  body: { name_at_bank: "JOHN DOE", name_match_result: "NO_MATCH", name_match_score: "12.00", account_status: "VALID" },
});
check("NO_MATCH -> name_mismatch", none.provider.verified === false && none.provider.verification_status === "name_mismatch", none.provider.verification_status);

const blocked = await register({
  body: { name_at_bank: null, name_match_result: null, account_status: "INVALID", account_status_code: "ACCOUNT_BLOCKED" },
});
check("INVALID account -> account_invalid", blocked.provider.verified === false && blocked.provider.verification_status === "account_invalid", blocked.provider.verification_status);
check("account_invalid keeps the status code", /ACCOUNT_BLOCKED/.test(blocked.provider.message || ""), String(blocked.provider.message));

// The sandbox's actual behaviour: valid account, no name verdict at all.
const noMatch = await register({
  body: { name_at_bank: "JOHN DOE", name_match_result: null, name_match_score: null, account_status: "VALID", account_status_code: "ACCOUNT_IS_VALID" },
});
check("valid account without a name verdict -> name_unverified (never verified)", noMatch.provider.verified === false && noMatch.provider.verification_status === "name_unverified", noMatch.provider.verification_status);
check("name_unverified still shows the name at bank", noMatch.provider.name_at_bank === "JOHN DOE", String(noMatch.provider.name_at_bank));
check("name_unverified invents no match result", noMatch.provider.name_match_result === null, String(noMatch.provider.name_match_result));

// An empty 200 is not a success either.
const empty = await register({ body: {} });
check("empty 200 -> unverified, not verified", empty.provider.verified === false, empty.provider.verification_status);

/* ---------------------------------------------------------------- error paths */
const apiError = await register({
  status: 404,
  body: { code: "api_error", type: "internal_error", message: "something went wrong, please try after some time" },
});
check("Cashfree api_error -> verification_unavailable", apiError.provider.verification_status === "verification_unavailable", apiError.provider.verification_status);
check("api_error stored verified=false", apiError.provider.verified === false);
check("api_error keeps Cashfree's message verbatim", apiError.provider.message === "something went wrong, please try after some time", String(apiError.provider.message));
check("api_error invents no name", apiError.provider.name_at_bank === null, String(apiError.provider.name_at_bank));
check("api_error still saves the provider (201)", apiError.status === 201, String(apiError.status));

const sigError = await register({
  status: 403,
  body: { type: "validation_error", code: "authentication_failed", message: "x-cf-signature missing in the request header" },
});
check("signature error -> verification_unavailable", sigError.provider.verification_status === "verification_unavailable", sigError.provider.verification_status);
check("signature error is surfaced to the user", /x-cf-signature/.test(sigError.provider.message || ""), String(sigError.provider.message));

const nonJson = await register({ status: 502, body: "<html>bad gateway</html>" });
check("non-JSON error body -> verification_unavailable", nonJson.provider.verification_status === "verification_unavailable", nonJson.provider.verification_status);

// A network failure (cashfreeFetch throws) must also be stored honestly.
queued = [];
globalThis.fetch = async () => { throw new Error("ECONNRESET"); };
const netFail = await call("/providers", "POST", { "x-user-id": freshUid() }, GOOD);
const netBody = JSON.parse(netFail.body || "{}");
check("network failure -> verification_unavailable", netBody.provider?.verification_status === "verification_unavailable", String(netBody.provider?.verification_status));
check("network failure is not a 500", netFail.statusCode === 201, String(netFail.statusCode));
check("network failure mentions the cause", /ECONNRESET/.test(netBody.provider?.message || ""), String(netBody.provider?.message));

/* ---------------------------------------------------------------- masking */
check("account masked, never returned whole", direct.provider.bank_account_masked === "••••1191", String(direct.provider.bank_account_masked));
check("masked record omits the full account number", !JSON.stringify(direct.raw).includes(ACCOUNT));
check("record exposes only the last 4", direct.raw.provider.bank_account_last4 === "1191");

globalThis.fetch = realFetch;
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} Secure ID unit checks passed`);
process.exit(failed.length ? 1 : 0);
