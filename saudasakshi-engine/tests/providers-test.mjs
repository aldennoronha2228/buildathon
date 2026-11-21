#!/usr/bin/env node
// Providers: Secure ID bank check stored honestly, account masking, 401 without uid,
// GET /providers/me scoping, and the bank badge on an agreement.
// Usage: node tests/providers-test.mjs [baseUrl]
const BASE = (process.argv[2] || "https://hbdbo7fzhqpji6npunwokvrabq0ptjfs.lambda-url.ap-south-1.on.aws").replace(/\/+$/, "");

const stamp = Date.now();
const UID = `prov-${stamp}`;
const OTHER = `prov-other-${stamp}`;

const results = [];
const check = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass, extra });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

const post = (path, uid, body) =>
  fetch(BASE + path, {
    method: "POST",
    headers: uid ? { "content-type": "application/json", "x-user-id": uid } : { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
const get = (path, uid) =>
  fetch(BASE + path, { cache: "no-store", headers: uid ? { "x-user-id": uid } : {} });

// Cashfree's published sandbox test account.
const ACCOUNT = "026291800001191";
const GOOD = {
  full_name: "Ramesh Kumar",
  phone: "9876543210",
  bank_account: ACCOUNT,
  ifsc: "YESB0000262",
  work_type: "physical",
};

/* 1. auth -------------------------------------------------------- */
const noUid = await post("/providers", null, GOOD);
check("POST /providers without X-User-Id -> 401", noUid.status === 401, String(noUid.status));

const blankUid = await post("/providers", "   ", GOOD);
check("POST /providers with blank X-User-Id -> 401", blankUid.status === 401, String(blankUid.status));

const noUidGet = await get("/providers/me", null);
check("GET /providers/me without X-User-Id -> 401", noUidGet.status === 401, String(noUidGet.status));

/* 2. validation -------------------------------------------------- */
const badIfsc = await post("/providers", UID, { ...GOOD, ifsc: "NOPE" });
const badIfscBody = await badIfsc.json().catch(() => ({}));
check("bad IFSC -> 400", badIfsc.status === 400, String(badIfsc.status));
check("bad IFSC names the field", /ifsc/.test(JSON.stringify(badIfscBody)), JSON.stringify(badIfscBody.problems || badIfscBody).slice(0, 160));

const badPhone = await post("/providers", UID, { ...GOOD, phone: "12345" });
check("short phone -> 400", badPhone.status === 400, String(badPhone.status));

const badAcct = await post("/providers", UID, { ...GOOD, bank_account: "12ab" });
check("non-numeric bank account -> 400", badAcct.status === 400, String(badAcct.status));

const badWork = await post("/providers", UID, { ...GOOD, work_type: "astrology" });
check("unknown work_type -> 400", badWork.status === 400, String(badWork.status));

const missingName = await post("/providers", UID, { ...GOOD, full_name: "" });
check("empty full_name -> 400", missingName.status === 400, String(missingName.status));

/* 3. the real Secure ID call ------------------------------------- */
// This is a live Secure ID call against the sandbox. Three honest outcomes are
// possible and all are acceptable; what is never acceptable is a fabricated one:
//   verified          - account valid AND name matched
//   name_mismatch /
//   account_invalid   - cashfree said no
//   name_unverified   - account found, but no name match was returned
//   verification_unavailable - the product/key/signature did not work
const created = await post("/providers", UID, GOOD);
const createdBody = await created.json().catch(() => ({}));
const p = createdBody.provider || {};
check("POST /providers -> 201 or 200", created.status === 201 || created.status === 200, String(created.status));
check("provider recorded for the caller", p.uid === UID, String(p.uid));
check("verified is a boolean", typeof p.verified === "boolean", String(p.verified));
const VERDICTS = ["verified", "name_mismatch", "account_invalid", "name_unverified", "unverified", "verification_unavailable"];
check("verification_status is a known verdict", VERDICTS.includes(p.verification_status), String(p.verification_status));

if (p.verified === true) {
  // Green path: only ever claimed when Cashfree positively matched the name.
  check("verified implies a name match result", ["DIRECT_MATCH", "GOOD_PARTIAL_MATCH", "MODERATE_PARTIAL_MATCH", "YES", "PARTIAL"].includes(p.name_match_result), String(p.name_match_result));
  check("verified implies a valid account", p.account_status === "VALID", String(p.account_status));
  check("verified carries the name at bank", !!p.name_at_bank, String(p.name_at_bank));
  console.log(`      live Secure ID: verified · ${p.name_at_bank} · match ${p.name_match_result}`);
} else if (p.verification_status === "name_unverified") {
  // Account is real, but Cashfree returned no name match: we must not claim one.
  check("name_unverified carries the name at bank", !!p.name_at_bank, String(p.name_at_bank));
  check("name_unverified does not invent a match result", p.name_match_result === null, String(p.name_match_result));
  check("name_unverified explains itself", typeof p.message === "string" && p.message.length > 0, String(p.message).slice(0, 100));
  check("name_unverified keeps verified=false", p.verified === false);
  console.log(`      live Secure ID: account found (${p.name_at_bank}) but no name match returned`);
} else if (p.verification_status === "verification_unavailable") {
  // The failure the task called out: keys/product/signature not working.
  check("Cashfree's own message is kept", typeof p.message === "string" && p.message.length > 0, String(p.message).slice(0, 100));
  check("no name_at_bank invented", p.name_at_bank === null, String(p.name_at_bank));
  console.log(`      live Secure ID: unavailable · ${p.message}`);
} else {
  check("a failed verdict keeps Cashfree's reason", typeof p.message === "string" && p.message.length > 0, String(p.message || "").slice(0, 100));
  console.log(`      live Secure ID: ${p.verification_status} · ${p.message}`);
}

/* 4. masking ----------------------------------------------------- */
check("response has no full account number", !JSON.stringify(createdBody).includes(ACCOUNT));
check("account masked to last 4", p.bank_account_masked === "••••1191", String(p.bank_account_masked));
check("last4 present", p.bank_account_last4 === "1191", String(p.bank_account_last4));
check("secret never echoed", !/CASHFREE_PG_SECRET|x-client-secret/i.test(JSON.stringify(createdBody)));

/* 5. GET /providers/me ------------------------------------------- */
const me = await get("/providers/me", UID);
const meBody = await me.json().catch(() => ({}));
check("GET /providers/me -> 200 for the owner", me.status === 200, String(me.status));
check("me returns the same masked record", meBody.provider?.bank_account_masked === "••••1191", String(meBody.provider?.bank_account_masked));
check("me never returns the full account", !JSON.stringify(meBody).includes(ACCOUNT));
check("me keeps the honest status", meBody.provider?.verification_status === p.verification_status, String(meBody.provider?.verification_status));

const otherMe = await get("/providers/me", OTHER);
check("GET /providers/me for an unknown uid -> 404", otherMe.status === 404, String(otherMe.status));

/* 6. re-verification updates in place ---------------------------- */
const again = await post("/providers", UID, { ...GOOD, phone: "9812345678" });
const againBody = await again.json().catch(() => ({}));
check("re-verify -> 200 (record updated, not duplicated)", again.status === 200, String(again.status));
check("re-verify keeps the created_at", againBody.provider?.created_at === p.created_at, `${againBody.provider?.created_at} vs ${p.created_at}`);
check("re-verify updates the phone", againBody.provider?.phone === "9812345678", String(againBody.provider?.phone));

/* 7. badge on an agreement ------------------------------------- */
// The provider record must surface on agreements where this uid is provider_uid.
const agreement = await post("/agreements", OTHER, {
  transcript:
    "Painter: poora ghar paint kar denge 60000 rupees mein.\nOwner: Theek hai, kaam ke baad hi paisa milega, advance nahi.\nPainter: 10 din mein poora ho jayega, photo bhej dunga.",
  my_role: "client",
  counterparty_uid: UID,
});
const agreementBody = await agreement.json().catch(() => ({}));
check("agreement created for the provider badge check", !!agreementBody.id, String(agreementBody.id));

const deadline = Date.now() + 180000;
let detail = null;
while (Date.now() < deadline) {
  const r = await get(`/agreements/${agreementBody.id}`, UID);
  if (r.status === 200) {
    const d = await r.json();
    if (d.status !== "pending") { detail = d; break; }
  }
  await new Promise((res) => setTimeout(res, 2000));
}
check("provider can read the agreement", !!detail, detail ? detail.status : "timeout");
if (detail) {
  const badge = detail.provider_bank;
  check("agreement carries the provider bank badge", !!badge, JSON.stringify(badge));
  check("badge mirrors the stored verdict", badge?.verified === p.verified && badge?.verification_status === p.verification_status, JSON.stringify(badge));
  check("badge only exposes the masked account", badge?.bank_account_masked === "••••1191", String(badge?.bank_account_masked));
  check("badge leaks no full account", !JSON.stringify(detail).includes(ACCOUNT));
}

/* 8. agreement without a provider record ------------------------ */
const noRecord = await post("/agreements", OTHER, {
  transcript:
    "Carpenter: almari banane ka 20000 rupees.\nOwner: Theek hai, kaam dekh ke paisa dunga.\nCarpenter: 5 din lagega.",
  my_role: "client",
  counterparty_uid: `${OTHER}-noprov`,
});
const noRecordBody = await noRecord.json().catch(() => ({}));
const deadline2 = Date.now() + 180000;
let detail2 = null;
while (Date.now() < deadline2 && noRecordBody.id) {
  const r = await get(`/agreements/${noRecordBody.id}`, OTHER);
  if (r.status === 200) {
    const d = await r.json();
    if (d.status !== "pending") { detail2 = d; break; }
  }
  await new Promise((res) => setTimeout(res, 2000));
}
check("no provider record -> no badge field", !!detail2 && !("provider_bank" in detail2), detail2 ? String(detail2.provider_bank) : "timeout");

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} provider checks passed`);
console.log(`users: uid=${UID} other=${OTHER}  sandbox account=${ACCOUNT} (masked ••••1191)`);
process.exit(failed.length ? 1 : 0);
