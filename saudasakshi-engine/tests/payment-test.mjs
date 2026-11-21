#!/usr/bin/env node
// Escrow payment links: real Cashfree sandbox link creation, idempotency,
// refresh endpoint scoping, and the signed webhook moving the agreement to in_escrow.
//
// Usage: node tests/payment-test.mjs [baseUrl]
//   CASHFREE_PG_SECRET=... enables the valid-signature webhook check (never printed).
const BASE = (process.argv[2] || "https://hbdbo7fzhqpji6npunwokvrabq0ptjfs.lambda-url.ap-south-1.on.aws").replace(/\/+$/, "");
const SECRET = process.env.CASHFREE_PG_SECRET || "";
import { createHmac } from "node:crypto";

const stamp = Date.now();
const CLIENT = `pay-client-${stamp}`;
const PROVIDER = `pay-provider-${stamp}`;
const EVE = `pay-eve-${stamp}`;

const results = [];
const check = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass, extra });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = (path, uid, body) =>
  fetch(BASE + path, {
    method: "POST",
    headers: uid ? { "content-type": "application/json", "x-user-id": uid } : { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
const get = (path, uid) =>
  fetch(BASE + path, { cache: "no-store", headers: uid ? { "x-user-id": uid } : {} });

const TRANSCRIPT =
  "Painter (Ramesh): Namaste sir, poora ghar paint kar denge 60,000 rupees mein.\n" +
  "Owner (Anil): Theek hai, lekin kaam khatam hone par hi paisa milega, advance nahi.\n" +
  "Painter: 10 din mein poora ho jayega, har room ki photo bhej dunga.\n" +
  "Owner: Flat 302, Green Glen Layout, Bellandur, Bengaluru. Kaam adhoora chhoda to paisa nahi.";

async function waitDone(id, uid, maxMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const r = await get(`/agreements/${id}`, uid);
    if (r.status === 200) {
      const d = await r.json();
      if (d.status !== "pending") return d;
    }
    await sleep(2000);
  }
  return null;
}

function signedHeaders(rawBody, timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature = createHmac("sha256", SECRET).update(timestamp + rawBody).digest("base64");
  return {
    "content-type": "application/json",
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature": signature,
  };
}

/* ---------------------------------------------------------------- 1. setup */
const created = await post("/agreements", CLIENT, {
  transcript: TRANSCRIPT,
  my_role: "client",
  counterparty_uid: PROVIDER,
});
const createdBody = await created.json().catch(() => ({}));
check("agreement created for the payment flow", !!createdBody.id, String(createdBody.id));
const ID = createdBody.id;

const done = await waitDone(ID, CLIENT);
check("agreement reaches done", !!done && done.status === "done", done ? done.status : "timeout");
if (!done) {
  console.log("\n0/0 payment checks passed (setup failed)");
  process.exit(1);
}
const price = done.agreement?.price_inr;
check("agreement has a positive price", typeof price === "number" && price > 0, String(price));

/* ---------------------------------------------------------------- 2. link created */
const pay = done.payment;
check("payment block is on GET /agreements/{id}", !!pay, JSON.stringify(pay));
check("payment.link_id looks like ss_<id12>_<ts>", typeof pay?.link_id === "string" && /^ss_[A-Za-z0-9-]{1,12}_\d+/.test(pay.link_id), String(pay?.link_id));
check("link_id embeds the first 12 chars of the agreement id", pay?.link_id?.startsWith(`ss_${ID.slice(0, 12)}_`), String(pay?.link_id));
check("payment.amount is the full escrow price", pay?.amount === price, `${pay?.amount} vs ${price}`);
check("link_url is a hosted Cashfree sandbox checkout link", /^https:\/\/[a-z.-]*cashfree\.com\/links\//.test(pay?.link_url || ""), String(pay?.link_url));
check("payment.status is ACTIVE before anyone pays", String(pay?.status).toUpperCase() === "ACTIVE", String(pay?.status));
check("payment carries created_at", !!pay?.created_at, String(pay?.created_at));
check("response leaks no Cashfree secret", !/x-client-secret|CASHFREE_PG_SECRET/.test(JSON.stringify(done)));

/* ---------------------------------------------------------------- 3. idempotency */
await sleep(2500);
const again = await (await get(`/agreements/${ID}`, CLIENT)).json();
check("reload does not create a second link", again.payment?.link_id === pay?.link_id, `${again.payment?.link_id} vs ${pay?.link_id}`);
check("reload keeps the same link_url", again.payment?.link_url === pay?.link_url);
check("reload keeps the original created_at", again.payment?.created_at === pay?.created_at);

// A different agreement must get its own link.
const second = await (await post("/agreements", CLIENT, {
  transcript: TRANSCRIPT,
  my_role: "client",
  counterparty_uid: `${PROVIDER}-2`,
})).json();
const secondDone = await waitDone(second.id, CLIENT);
check("a second agreement creates its own link", !!secondDone?.payment?.link_id && secondDone.payment.link_id !== pay.link_id, String(secondDone?.payment?.link_id));
check("the first link is untouched by the second", (await (await get(`/agreements/${ID}`, CLIENT)).json()).payment?.link_id === pay.link_id);

/* ---------------------------------------------------------------- 4. parties see it */
const provView = await get(`/agreements/${ID}`, PROVIDER);
const provBody = await provView.json().catch(() => ({}));
check("provider sees the payment block", provBody.payment?.link_id === pay.link_id, String(provBody.payment?.link_id));
check("provider my_role = provider", provBody.my_role === "provider", String(provBody.my_role));
check("provider sees client_uid, not the full account", provBody.parties?.client_uid === CLIENT);

/* ---------------------------------------------------------------- 5. payment endpoint */
const noUid = await get(`/agreements/${ID}/payment`, null);
check("GET /agreements/{id}/payment without X-User-Id -> 401", noUid.status === 401, String(noUid.status));
const stranger = await get(`/agreements/${ID}/payment`, EVE);
check("GET /agreements/{id}/payment for a stranger -> 403", stranger.status === 403, String(stranger.status));
const unknown = await get(`/agreements/00000000-0000-0000-0000-000000000000/payment`, CLIENT);
check("payment refresh for an unknown id -> 404", unknown.status === 404, String(unknown.status));
const badMethod = await fetch(`${BASE}/agreements/${ID}/payment`, { method: "POST", headers: { "x-user-id": CLIENT } });
check("payment endpoint rejects POST -> 405", badMethod.status === 405, String(badMethod.status));

const refreshed = await get(`/agreements/${ID}/payment`, CLIENT);
const refreshedBody = await refreshed.json().catch(() => ({}));
check("payment refresh -> 200 for the client", refreshed.status === 200, String(refreshed.status));
check("refresh returns the live link status", ["ACTIVE", "PAID", "EXPIRED", "CANCELLED"].includes(String(refreshedBody.payment?.status).toUpperCase()), String(refreshedBody.payment?.status));
check("refresh leaves a real agreement unfunded when unpaid", refreshedBody.status !== "in_escrow" || String(refreshedBody.payment?.status).toUpperCase() === "PAID", `${refreshedBody.status}/${refreshedBody.payment?.status}`);

/* ---------------------------------------------------------------- 6. webhook auth */
const noSig = await fetch(`${BASE}/webhooks/cashfree`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "PAYMENT_LINK_EVENT", data: { link_id: pay.link_id, link_status: "PAID" } }),
});
check("webhook without signature -> 401", noSig.status === 401, String(noSig.status));

const badSig = await fetch(`${BASE}/webhooks/cashfree`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-webhook-timestamp": "1700000000", "x-webhook-signature": "bm90LWEtcmVhbC1zaWduYXR1cmU=" },
  body: JSON.stringify({ type: "PAYMENT_LINK_EVENT", data: { link_id: pay.link_id, link_status: "PAID" } }),
});
check("webhook with a wrong signature -> 401", badSig.status === 401, String(badSig.status));

const stillUnpaid = await (await get(`/agreements/${ID}`, CLIENT)).json();
check("a rejected webhook does not fund the escrow", stillUnpaid.status !== "in_escrow", stillUnpaid.status);

/* ---------------------------------------------------------------- 7. valid webhook */
if (!SECRET) {
  console.log("SKIP  signed webhook check (set CASHFREE_PG_SECRET to run it)");
} else {
  const payload = JSON.stringify({
    type: "PAYMENT_LINK_EVENT",
    data: {
      link_id: pay.link_id,
      link_status: "PAID",
      link_amount: price,
      link_amount_paid: price,
      link_notes: { agreement_id: ID },
    },
  });
  const t0 = Date.now();
  const ok = await fetch(`${BASE}/webhooks/cashfree`, { method: "POST", headers: signedHeaders(payload), body: payload });
  const ms = Date.now() - t0;
  check("signed PAYMENT_LINK_EVENT PAID -> 200", ok.status === 200, `${ok.status} in ${ms}ms`);
  check("webhook answers quickly (<5s)", ms < 5000, `${ms}ms`);

  const funded = await (await get(`/agreements/${ID}`, CLIENT)).json();
  check("agreement status becomes in_escrow", funded.status === "in_escrow", funded.status);
  check("payment status becomes PAID", String(funded.payment?.status).toUpperCase() === "PAID", String(funded.payment?.status));
  check("in_escrow_at timestamp stored", !!funded.in_escrow_at && !isNaN(Date.parse(funded.in_escrow_at)), String(funded.in_escrow_at));
  check("link_id unchanged by the webhook (no second link)", funded.payment?.link_id === pay.link_id, String(funded.payment?.link_id));

  // replay of the same webhook must not break anything
  const replay = await fetch(`${BASE}/webhooks/cashfree`, { method: "POST", headers: signedHeaders(payload), body: payload });
  check("replayed webhook -> 200", replay.status === 200, String(replay.status));
  const afterReplay = await (await get(`/agreements/${ID}`, CLIENT)).json();
  check("replay keeps status in_escrow", afterReplay.status === "in_escrow", afterReplay.status);

  // a non-PAID event must not fund
  const failedPayload = JSON.stringify({
    type: "PAYMENT_LINK_EVENT",
    data: { link_id: secondDone?.payment?.link_id, link_status: "CANCELLED", link_notes: { agreement_id: second.id } },
  });
  const cancelled = await fetch(`${BASE}/webhooks/cashfree`, { method: "POST", headers: signedHeaders(failedPayload), body: failedPayload });
  check("signed CANCELLED event -> 200", cancelled.status === 200, String(cancelled.status));
  const secondAfter = await (await get(`/agreements/${second.id}`, CLIENT)).json();
  check("CANCELLED event does not fund the escrow", secondAfter.status !== "in_escrow", secondAfter.status);

  // provider still sees the funded state and the badge slot stays honest
  const provFunded = await (await get(`/agreements/${ID}`, PROVIDER)).json();
  check("provider sees in_escrow too", provFunded.status === "in_escrow", provFunded.status);
}

/* ---------------------------------------------------------------- 8. backfill */
// An agreement drafted before escrow links existed gets one lazily on read,
// and only one — a second read must reuse it.
await sleep(1500);
const backfillA = await (await get(`/agreements/${second.id}`, CLIENT)).json();
const backfillB = await (await get(`/agreements/${second.id}`, CLIENT)).json();
check("repeat reads keep a single link", backfillA.payment?.link_id === backfillB.payment?.link_id, `${backfillA.payment?.link_id} vs ${backfillB.payment?.link_id}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} payment checks passed`);
console.log(`agreement: ${ID}  link: ${pay?.link_id}`);
process.exit(failed.length ? 1 : 0);
