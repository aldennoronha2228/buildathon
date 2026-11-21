// Verifies the Sarvam fallback when the grokbot webhook POST fails.
// Runs the handler locally: real DynamoDB (local credentials) + real Sarvam,
// but GROKBOT_WEBHOOK_URL points at a dead endpoint so the fallback triggers.
//
// Usage: SARVAM_API_KEY=... node tests/fallback-test.mjs
import { readFileSync } from "node:fs";

if (!process.env.SARVAM_API_KEY) {
  console.error("SARVAM_API_KEY is required");
  process.exit(2);
}

process.env.GROKBOT_WEBHOOK_URL = "http://127.0.0.1:9/definitely-not-listening";
process.env.GROKBOT_WEBHOOK_KEY = "unused";
process.env.AGREEMENTS_TABLE = process.env.AGREEMENTS_TABLE || "saudasakshi-agreements";
process.env.AWS_REGION = process.env.AWS_REGION || "ap-south-1";

const { handler } = await import("../index.mjs");
const transcript = JSON.parse(
  readFileSync(new URL("./sample-ca.json", import.meta.url), "utf8")
).transcript;

const event = {
  rawPath: "/agreements",
  requestContext: { http: { method: "POST" } },
  headers: { host: "localhost", "x-user-id": "fallback-test", "x-user-name": "Fallback Test" },
  body: JSON.stringify({ transcript, my_role: "client" }),
};

const t0 = Date.now();
const res = await handler(event);
const body = JSON.parse(res.body);
console.log(`POST /agreements -> ${res.statusCode} ${JSON.stringify(body)} (${Date.now() - t0}ms)`);

const checks = [];
const check = (n, p, e = "") => {
  checks.push(!!p);
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${e ? " — " + e : ""}`);
};
check("fallback used sarvam-105b", body.writer === "sarvam-105b", body.writer);
check("status done (inline)", body.status === "done", body.status);
check("no degraded flag", body.degraded !== true);

const got = await handler({
  rawPath: `/agreements/${body.id}`,
  requestContext: { http: { method: "GET" } },
  headers: { "x-user-id": "fallback-test" },
});
const stored = JSON.parse(got.body);
check("stored agreement returned", stored.status === "done" && !!stored.agreement);
check("writer persisted as sarvam-105b", stored.writer === "sarvam-105b", stored.writer);
check("price parsed 3000", stored.agreement?.price_inr === 3000, String(stored.agreement?.price_inr));
check(
  "deadline flagged missing",
  stored.agreement?.deadline === null &&
    /deadline/i.test(JSON.stringify(stored.agreement?.missing_terms || []))
);

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} fallback checks passed`);
process.exit(failed ? 1 : 0);
