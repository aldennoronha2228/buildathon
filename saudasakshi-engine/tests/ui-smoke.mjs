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
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

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
ok("user ID saved to localStorage", stored.uid === UID && stored.name === NAME, JSON.stringify(stored));

// reload: identity persists
await page.reload({ waitUntil: "networkidle" });
ok("identity survives reload", await page.locator("#app").isVisible() && !(await page.locator("#signinCard").isVisible()));

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
const termsText = await page.locator("#result").innerText();
const deadlineCell = (await page.locator("#result").innerText()).match(/Deadline\s*\n?\s*([^\n]{0,120})/)?.[1] || "";
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
await accept.click();
await page.waitForTimeout(1200);
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

// --- sign out
await page.click("#signout");
await page.waitForTimeout(300);
ok("Sign out returns to the sign-in card", await page.locator("#signinCard").isVisible() && !(await page.locator("#app").isVisible()));
ok("Sign out clears localStorage", (await page.evaluate(() => localStorage.getItem('saudasakshi.uid'))) === null);

ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
