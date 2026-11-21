#!/usr/bin/env node
// Client user-ID auth: 401 without uid, 403 for a stranger, list scoping, accept flow,
// role/counterparty storage, and that the callback route stays token-based.
// Usage: node tests/identity-test.mjs [baseUrl]
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] || "https://hbdbo7fzhqpji6npunwokvrabq0ptjfs.lambda-url.ap-south-1.on.aws").replace(/\/+$/, "");
const house = JSON.parse(readFileSync(new URL("./sample-house.json", import.meta.url), "utf8"));

const stamp = Date.now();
const ALICE = `alice-${stamp}`;   // creator, the client
const BOB = `bob-${stamp}`;       // counterparty, the provider
const EVE = `eve-${stamp}`;       // stranger

const results = [];
const check = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass, extra });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idH = (uid, name) => {
  const h = { "content-type": "application/json", "x-user-id": uid };
  if (name) h["x-user-name"] = name;
  return h;
};
const post = (path, uid, body) =>
  fetch(BASE + path, {
    method: "POST",
    headers: uid ? idH(uid) : { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
const get = (path, uid) =>
  fetch(BASE + path, { cache: "no-store", headers: uid ? { "x-user-id": uid } : {} });

async function waitFor(id, uid, maxMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await get(`/agreements/${id}`, uid);
    if (res.status === 200) {
      const data = await res.json();
      if (data.status === "done" && data.agreement) return data;
    }
    await sleep(2000);
  }
  throw new Error(`timeout waiting for ${id}`);
}

// ---------------------------------------------------------------- 1. 401 without a user ID
const noUidCreate = await post("/agreements", null, house);
check("POST /agreements without X-User-Id -> 401", noUidCreate.status === 401, String(noUidCreate.status));

const noUidList = await get("/agreements", null);
check("GET /agreements without X-User-Id -> 401", noUidList.status === 401, String(noUidList.status));

const emptyUid = await post("/agreements", "   ", house);
check("POST /agreements with blank X-User-Id -> 401", emptyUid.status === 401, String(emptyUid.status));

// ---------------------------------------------------------------- 2. role / counterparty validation
const badRole = await post("/agreements", ALICE, { ...house, my_role: "boss" });
check('my_role other than client|provider -> 400', badRole.status === 400, String(badRole.status));

const selfCp = await post("/agreements", ALICE, { ...house, counterparty_uid: ALICE });
check("counterparty_uid == own uid -> 400", selfCp.status === 400, String(selfCp.status));

// ---------------------------------------------------------------- 3. create as client with a counterparty
const createdRes = await post("/agreements", ALICE, {
  ...house,
  my_role: "client",
  counterparty_uid: BOB,
});
const created = await createdRes.json().catch(() => ({}));
check("POST /agreements with X-User-Id -> id", !!created.id, `status=${createdRes.status}`);

const done = await waitFor(created.id, ALICE);
check("created_by = creator", done.created_by === ALICE, done.created_by);
check("creator stored as client_uid", done.parties?.client_uid === ALICE, done.parties?.client_uid);
check("counterparty stored as provider_uid", done.parties?.provider_uid === BOB, done.parties?.provider_uid);
check("creator_role = client", done.creator_role === "client", done.creator_role);
check("my_role for creator = client", done.my_role === "client", done.my_role);
check("GET response leaks neither transcript nor token", !("transcript" in done) && !("cb_token" in done));

// creator name from X-User-Name
const namedRes = await fetch(`${BASE}/agreements`, {
  method: "POST",
  headers: idH(`${ALICE}-named`, "Anil Kumar"),
  body: JSON.stringify({ ...house, my_role: "provider" }),
});
const named = await namedRes.json().catch(() => ({}));
check("X-User-Name accepted alongside X-User-Id", namedRes.status === 201 || namedRes.status === 202, String(namedRes.status));

// ---------------------------------------------------------------- 4. 403 for a stranger
const strangerGet = await get(`/agreements/${created.id}`, EVE);
check("stranger GET /agreements/{id} -> 403", strangerGet.status === 403, String(strangerGet.status));

const anonGet = await get(`/agreements/${created.id}`, null);
check("anonymous GET /agreements/{id} -> 401", anonGet.status === 401, String(anonGet.status));

const strangerAccept = await post(`/agreements/${created.id}/accept`, EVE);
check("stranger POST accept -> 403", strangerAccept.status === 403, String(strangerAccept.status));

const noUidAccept = await post(`/agreements/${created.id}/accept`, null);
check("accept without X-User-Id -> 401", noUidAccept.status === 401, String(noUidAccept.status));

const bobView = await get(`/agreements/${created.id}`, BOB);
check("counterparty can GET the agreement -> 200", bobView.status === 200, String(bobView.status));
const bobData = await bobView.json();
check("counterparty my_role = provider", bobData.my_role === "provider", bobData.my_role);

// ---------------------------------------------------------------- 5. list scoping
const aliceList = await get("/agreements", ALICE);
const aliceRows = (await aliceList.json()).agreements || [];
check("GET /agreements 200 for creator", aliceList.status === 200);
check("creator sees own agreement in list", aliceRows.some((r) => r.id === created.id), `${aliceRows.length} rows`);
check(
  "list row is minimal (id, status, created_at, price_inr, work_type, parties)",
  aliceRows.every((r) => "id" in r && "status" in r && "created_at" in r && "price_inr" in r && "work_type" in r && "parties" in r)
);
check("list rows never carry the transcript", aliceRows.every((r) => !("transcript" in r) && !("cb_token" in r)));

const bobRows = ((await (await get("/agreements", BOB)).json()).agreements) || [];
check("counterparty sees the agreement in their list", bobRows.some((r) => r.id === created.id), `${bobRows.length} rows`);

const eveRows = ((await (await get("/agreements", EVE)).json()).agreements) || [];
check("stranger's list does not contain it", !eveRows.some((r) => r.id === created.id), `${eveRows.length} rows`);
check("stranger's list is scoped to their own items only", eveRows.every((r) => r.parties?.client_uid === EVE || r.parties?.provider_uid === EVE), `${eveRows.length} rows`);

const aliceAgain = ((await (await get("/agreements", ALICE)).json()).agreements) || [];
const times = aliceAgain.map((r) => String(r.created_at || ""));
const sortedDesc = times.every((t, i) => i === 0 || times[i - 1] >= t);
check("list is newest first", sortedDesc, times.slice(0, 3).join(" >= "));

// ---------------------------------------------------------------- 6. accept flow
const aliceAccept = await post(`/agreements/${created.id}/accept`, ALICE);
const aliceAcceptBody = await aliceAccept.json().catch(() => ({}));
check("client accept -> 200", aliceAccept.status === 200, String(aliceAccept.status));
check("client accept recorded", aliceAcceptBody.accepted_by_client === ALICE, String(aliceAcceptBody.accepted_by_client));
check("one acceptance is not fully accepted", aliceAcceptBody.fully_accepted === false, String(aliceAcceptBody.fully_accepted));

const halfway = await (await get(`/agreements/${created.id}`, ALICE)).json();
check("status stays done after one acceptance", halfway.status === "done", halfway.status);
check("provider has not accepted yet", halfway.accepted_by_provider === null, String(halfway.accepted_by_provider));

const bobAccept = await post(`/agreements/${created.id}/accept`, BOB);
const bobAcceptBody = await bobAccept.json().catch(() => ({}));
check("provider accept -> 200", bobAccept.status === 200, String(bobAccept.status));
check("provider accept recorded", bobAcceptBody.accepted_by_provider === BOB, String(bobAcceptBody.accepted_by_provider));
check("both accepted -> fully_accepted", bobAcceptBody.fully_accepted === true, String(bobAcceptBody.fully_accepted));
check('both accepted -> status "accepted"', bobAcceptBody.status === "accepted", bobAcceptBody.status);

const afterBoth = await (await get(`/agreements/${created.id}`, ALICE)).json();
check("GET reflects status accepted", afterBoth.status === "accepted", afterBoth.status);
check("GET carries agreed text after acceptance", (afterBoth.agreement?.agreement_text?.en || "").length > 200);
const accAt = afterBoth.accepted_at;
check("accepted_at timestamp stored", !!accAt && !isNaN(Date.parse(accAt)), String(accAt));

const acceptAgain = await post(`/agreements/${created.id}/accept`, ALICE);
const acceptAgainBody = await acceptAgain.json().catch(() => ({}));
check("re-accept is idempotent (200, still accepted)", acceptAgain.status === 200 && acceptAgainBody.fully_accepted === true, `${acceptAgain.status}/${acceptAgainBody.fully_accepted}`);

// ---------------------------------------------------------------- 7. defaults and provider-created
const defaulted = await post("/agreements", `${EVE}-default`, {
  ...house,
  counterparty_uid: `${BOB}-default`,
});
const defaultedBody = await defaulted.json().catch(() => ({}));
const defaultedDone = await waitFor(defaultedBody.id, `${EVE}-default`);
check("omitted my_role defaults the creator to client", defaultedDone.parties?.client_uid === `${EVE}-default`, defaultedDone.parties?.client_uid);
check("omitted my_role still fills the counterparty as provider", defaultedDone.parties?.provider_uid === `${BOB}-default`, defaultedDone.parties?.provider_uid);
check("omitted my_role: counterparty can accept", (await post(`/agreements/${defaultedBody.id}/accept`, `${BOB}-default`)).status === 200);

// ---------------------------------------------------------------- 8. callback stays token-based
const cbNoIdentity = await fetch(`${BASE}/agreements/${created.id}/callback?t=wrong`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
check("callback is token-based, no X-User-Id needed (wrong token -> 403)", cbNoIdentity.status === 403, String(cbNoIdentity.status));

// ---------------------------------------------------------------- 9. provider-created agreement
const provRes = await post("/agreements", `${BOB}-prov`, { ...house, my_role: "provider", counterparty_uid: `${ALICE}-prov` });
const prov = await provRes.json().catch(() => ({}));
const provDone = await waitFor(prov.id, `${BOB}-prov`);
check("provider creator stored as provider_uid", provDone.parties?.provider_uid === `${BOB}-prov`, provDone.parties?.provider_uid);
check("provider creator: counterparty becomes client_uid", provDone.parties?.client_uid === `${ALICE}-prov`, provDone.parties?.client_uid);
check("provider creator my_role = provider", provDone.my_role === "provider", provDone.my_role);

// ---------------------------------------------------------------- summary
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} identity checks passed`);
console.log(`users: alice=${ALICE} bob=${BOB} eve=${EVE}`);
process.exit(failed.length ? 1 : 0);
