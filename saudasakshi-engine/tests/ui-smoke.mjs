// Browser smoke test for the deployed SaudaSakshi UI.
// Usage: node tests/ui-smoke.mjs [baseUrl]
import { chromium } from "playwright";

const BASE = process.argv[2] || "https://hbdbo7fzhqpji6npunwokvrabq0ptjfs.lambda-url.ap-south-1.on.aws";
const UID = `ui-${Date.now()}`;
const NAME = "Anil (UI test)";
const errors = [];
const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/home/panda/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // GET /providers/me -> 404 is the documented "no provider profile yet".
  if (/status of 404/.test(m.text())) return;
  errors.push(m.text());
});

// Capture every request so we can assert the identity headers go out.
const apiCalls = [];
page.on("request", (req) => {
  const u = new URL(req.url());
  if (u.pathname.startsWith("/agreements")) {
    apiCalls.push({ method: req.method(), path: u.pathname, headers: req.headers() });
  }
});

await page.goto(BASE, { waitUntil: "networkidle" });
ok("title is SaudaSakshi", (await page.title()) === "SaudaSakshi");

// --- sign-in gate
ok("sign-in card shown when no user ID is stored", await page.locator("#signinCard").isVisible());
ok("form hidden before sign-in", !(await page.locator("#app").isVisible()));
ok("'Your user ID' field present", (await page.locator("#uid").count()) === 1);
ok("display name field is optional", (await page.locator("#uname").getAttribute("required")) === null);

// --- provider sign-up card on the landing page
ok("'Join as service provider' card on the landing page", /Join as service provider/.test(await page.locator("#providerCard").innerText()));
ok("provider card is visible before sign-in", await page.locator("#providerCard").isVisible());
ok("provider form asks for a user ID", (await page.locator("#p-uid").count()) === 1);
ok("provider form asks for full name, phone, account, IFSC, work type",
  (await page.locator("#p-name").count()) === 1 && (await page.locator("#p-phone").count()) === 1 &&
  (await page.locator("#p-account").count()) === 1 && (await page.locator("#p-ifsc").count()) === 1 &&
  (await page.locator("#p-work").count()) === 1);
const hint = await page.locator("#provider-hint").innerText();
ok("sandbox test values hint shown", hint.includes("026291800001191") && hint.includes("YESB0000262"), hint.replace(/\n/g, " ").slice(0, 90));

await page.fill("#uid", UID);
await page.fill("#uname", NAME);
await page.click("#signinForm button[type=submit]");
await page.waitForSelector("#app:not(.hidden)", { timeout: 10000 });

ok("signed-in state hides the sign-in card", !(await page.locator("#signinCard").isVisible()));
ok('header shows "Signed in as X"', /Signed in as/.test(await page.locator("#who").innerText()) && (await page.locator("#who").innerText()).includes(UID));
ok("Sign out link in header", await page.locator("#signout").isVisible());
const stored = await page.evaluate(() => ({
  uid: localStorage.getItem('saudasakshi.uid'),
  name: localStorage.getItem('saudasakshi.name'),
}));
ok("identity is NOT written to localStorage", stored.uid === null && stored.name === null, JSON.stringify(stored));

// reload: identity is asked again (in-memory only)
await page.reload({ waitUntil: "networkidle" });
ok("identity is asked again after reload", await page.locator("#signinCard").isVisible() && !(await page.locator("#app").isVisible()));

// --- provider bank check, real Cashfree Secure ID call
await page.fill("#p-uid", UID);
await page.fill("#p-name", "Ramesh Kumar");
await page.fill("#p-phone", "9876543210");
await page.click("#fill-test");
await page.selectOption("#p-work", "physical");
await page.click("#p-submit");
await page.waitForSelector("#providerResult:not(.hidden)", { timeout: 30000 });
const provResult = await page.locator("#providerResult").innerText();
ok("provider result panel shown", provResult.length > 20, provResult.replace(/\n/g, " ").slice(0, 100));
ok("result is one of green verified / red mismatch / amber not-checked-or-unavailable",
  /bank verified/i.test(provResult) ||
    /bank check failed/i.test(provResult) ||
    /name not checked/i.test(provResult) ||
    /bank check unavailable \(sandbox\)/i.test(provResult),
  provResult.replace(/\n/g, " ").slice(0, 110));
ok("an amber result never claims the name matched",
  !/name not checked/i.test(provResult) || !/name match\s*YES/i.test(provResult),
  provResult.replace(/\n/g, " ").slice(0, 110));
ok("result never shows the full account number", !provResult.includes("026291800001191"));
ok("amber result shows only the masked account", !/unavailable|not checked/i.test(provResult) || /••••1191/.test(provResult), provResult.replace(/\n/g, " ").slice(0, 140));

await page.reload({ waitUntil: "networkidle" });
ok("provider result is re-fetched after reload once signed in", !(await page.locator("#providerResult").isVisible()));

await page.fill("#uid", UID);
await page.fill("#uname", NAME);
await page.click("#signinForm button[type=submit]");
await page.waitForSelector("#app:not(.hidden)", { timeout: 10000 });
await page.waitForSelector("#providerResult:not(.hidden)", { timeout: 30000 }).catch(() => {});
ok(
  "saved provider record loads on sign-in",
  (await page.locator("#providerResult").isVisible()) && (await page.locator("#providerResult").innerText()).length > 20,
  ((await page.locator("#providerResult").innerText().catch(() => "")) || "").replace(/\n/g, " ").slice(0, 80)
);

ok("textarea present", await page.locator("#transcript").isVisible());
ok("my role toggle present", (await page.locator(".rolebtn").count()) === 2);
ok("'Other party's user ID' field present", await page.locator("#counterparty").isVisible());

// sample button fills transcript
await page.click("#sample-house");
const filled = await page.inputValue("#transcript");
ok("sample button fills textarea", filled.includes("60,000") && filled.includes("Bellandur"), `${filled.length} chars`);

// pick a role and a counterparty
await page.click('.rolebtn[data-role="client"]');
await page.fill("#counterparty", `${UID}-painter`);

// run the real flow
await page.click("#create");
const spinnerVisible = await page.locator("#status").isVisible();
ok("shows 'Drafting agreement…' + spinner", spinnerVisible && (await page.locator("#status").innerText()).includes("Drafting agreement"));

await page.waitForSelector("#result section", { timeout: 180000 });
await page.waitForTimeout(400);

const body = await page.locator("#result").innerText();
ok("status badge rendered", /Drafted|Needs info/.test(body));
ok("writer shown", /writer:\s*sarvam-105b|writer:\s*grokbot/.test(body));
ok("parties rendered", body.includes("Ramesh") && body.includes("Anil"));
ok("escrow box", /held in escrow, released when/.test(body));
ok("₹ amount formatted", /₹\s?60,000/.test(body));

// --- escrow payment link for the client
const payBtnSel = '#result a[href*="cashfree.com/links/"]';
ok("client sees the 'Pay ₹X into escrow' action", (await page.locator(payBtnSel).count()) === 1);
const payLink = await page.locator(payBtnSel).first().getAttribute("href");
ok("pay button opens the Cashfree sandbox link", /^https:\/\/[a-z.-]*cashfree\.com\/links\//.test(payLink || ""), String(payLink).slice(0, 60));
ok("pay button labels the amount", /Pay ₹\s?60,000 into escrow/.test(body));
ok("no full bank account rendered", !body.includes("026291800001191"));
const termsText = await page.locator("#result").innerText();
const deadlineCell = (await page.locator("#result").innerText()).match(/Deadline\s*\n?\s*([^\n]{0,120})/i)?.[1] || "";
ok(
  "deadline rendered from transcript",
  /(10|ten)/i.test(deadlineCell) && !/Not stated/i.test(deadlineCell),
  deadlineCell.trim()
);
ok("location/address", body.includes("Flat 302, Green Glen Layout, Bellandur, Bengaluru"));
ok("proof required", /Proof required/i.test(body) && /photo/i.test(body));
ok("verification checks", /Verification checks/i.test(body));
ok("missing terms block", /Missing terms/i.test(body));
ok("reasoning collapsible exists", (await page.locator("#result details summary").count()) > 0);

// tabs
const enText = await page.locator("#agree-text").innerText();
await page.click('.tabbtn[data-tab="local"]');
const localText = await page.locator("#agree-text").innerText();
ok("local language tab switches text", localText !== enText && localText.length > 40, `${enText.length} -> ${localText.length}`);
ok("local text is Devanagari", /[\u0900-\u097F]/.test(localText));

// reasoning opens
await page.click("#result details summary");
ok("reasoning list expands", (await page.locator("#result details ul li").count()) > 0);

// --- accept button for the signed-in party
const accept = page.locator("#accept");
ok("Accept button offered to the signed-in client", (await accept.count()) === 1 && /Accept as client/.test(await accept.innerText()));
const acceptDone = page.waitForResponse(
  (r) => r.url().includes("/accept") && r.request().method() === "POST",
  { timeout: 30000 }
);
await accept.click();
const acceptRes = await acceptDone;
ok("accept POST succeeded", acceptRes.status() === 200, String(acceptRes.status()));
await page.waitForFunction(
  () => /You accepted/i.test(document.querySelector("#result")?.innerText || ""),
  null,
  { timeout: 30000 }
);
const afterAccept = await page.locator("#result").innerText();
ok("client acceptance recorded in UI", /You accepted/.test(afterAccept));
ok("still says waiting for the provider", /Waiting for the provider/.test(afterAccept));

// --- my agreements list
const listText = await page.locator("#listCard").innerText();
ok("'My agreements' section present", /My agreements/i.test(listText));
const rowCount = await page.locator("#listBody [data-open]").count();
ok("created agreement listed", rowCount >= 1, `${rowCount} rows`);
const rowText = await page.locator("#listBody [data-open]").first().innerText();
ok("list row shows price + status", /60,000/.test(rowText) && /Drafted|Drafting|Accepted/.test(rowText));
ok("list row shows my role", /you are the client/.test(rowText), rowText.replace(/\n/g, " "));

// clicking a row re-opens it
await page.click("#listBody [data-open]");
await page.waitForTimeout(800);
ok("clicking a row opens the agreement", (await page.locator("#result").innerText()).includes("Flat 302"));

// --- identity headers on every API call
const withUid = apiCalls.filter((c) => c.headers["x-user-id"] === UID);
const listCalls = apiCalls.filter((c) => c.method === "GET" && c.path === "/agreements");
const posts = apiCalls.filter((c) => c.method === "POST" && c.path === "/agreements");
const gets = apiCalls.filter((c) => c.method === "GET" && c.path !== "/agreements");
const accepts = apiCalls.filter((c) => c.path.endsWith("/accept"));
ok("every /agreements call carried X-User-Id", apiCalls.length > 0 && withUid.length === apiCalls.length, `${withUid.length}/${apiCalls.length}`);
ok("X-User-Name sent when set", withUid.every((c) => c.headers["x-user-name"] === NAME), String(withUid[0]?.headers["x-user-name"]));
ok("list call went out (GET /agreements)", listCalls.length >= 1, `${listCalls.length}`);
ok("create POST sent", posts.length >= 1, `${posts.length}`);
ok("detail GETs sent", gets.length >= 1, `${gets.length}`);
ok("accept POST sent", accepts.length >= 1, `${accepts.length}`);

await page.screenshot({ path: "/tmp/shot/result.png", fullPage: true });

// --- provider view: waiting for the client to fund escrow
const agreementId = await page.locator("#listBody [data-open]").first().getAttribute("data-open");
await page.click("#signout");
await page.waitForTimeout(300);
await page.fill("#uid", `${UID}-painter`);
await page.fill("#uname", "Ramesh (provider)");
await page.click("#signinForm button[type=submit]");
await page.waitForSelector("#app:not(.hidden)", { timeout: 10000 });
await page.evaluate((id) => openAgreement(id), agreementId);
await page.waitForSelector("#result section", { timeout: 30000 });
await page.waitForTimeout(400);
const provView = await page.locator("#result").innerText();
ok("provider sees 'Waiting for client to fund escrow'", /Waiting for client to fund escrow/i.test(provView));
ok("provider does not get the Pay button", (await page.locator('#result a[href*="cashfree.com/links/"]').count()) === 0);
ok("provider view shows the escrow amount", /₹\s?60,000/.test(provView));

// --- sign out
await page.click("#signout");
await page.waitForTimeout(300);
ok("Sign out returns to the sign-in card", await page.locator("#signinCard").isVisible() && !(await page.locator("#app").isVisible()));
ok("Sign out leaves nothing in localStorage", (await page.evaluate(() => localStorage.getItem('saudasakshi.uid'))) === null);

ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
