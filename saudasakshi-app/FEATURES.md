# SaudaSakshi — Feature Guide

**From Verbal Agreements to Verified Payments.**
A mobile-first web app for informal workers (electricians, plumbers, AC technicians): speak the deal, get a structured agreement, both parties verify it, payments happen through Cashfree in two milestones (advance + balance), and the app reminds you to collect the balance.

Everything below is **what exists in the code right now**.

---

## 1. Voice Capture — Step 1 "Voice"

- Mic button with animated pulse rings; tap to start/stop.
- **Two modes, auto-selected by configuration:**
  - **Demo mode** (no keys): 4 scripted sample transcripts — Kannada, Hindi, Tamil, English — streamed word-by-word like a live transcription, with "Quick Demo" chips (`Test Kannada` … `Test EN`).
  - **Live mode** (`SARVAM_API_KEY` set): records the real microphone (MediaRecorder), sends audio to the server, which proxies to **Sarvam Speech-to-Text** (`saarika:v2.5`); the transcript streams back into the box. Recording timer shown.
- **Free typing is always supported** in the transcript box.
- **Language auto-detection** — real Unicode-script detection (Kannada U+0C80–0CEF, Devanagari U+0900–097F, Tamil U+0B80–0BFF, else English) with a confidence pill under "Voice Transcript"; the header badge lights up with the detected language (`ಕನ್ನಡ • Auto`).
- **Term extraction**:
  - Live mode: **Sarvam LLM** (`sarvam-m`) extracts the full draft as JSON — service (English + regional), **customer name** (only if spoken), **explicit due date** (only if a calendar date is spoken), total, advance — with strict validation.
  - Demo mode: deterministic regex parser extracts amounts; balance = total − advance.
  - If the LLM is unavailable or returns garbage, the regex parser takes over silently.

## 2. Agreement Draft & Dual Verification — Step 2 "Confirm"

- Structured agreement card: service description, agreement ID (`#SS-xxxx`), **Total / Advance / Balance** cells, payment condition, balance-due date + alarm time.
- **Bilingual toggle**: English ↔ the spoken language (ಕನ್ನಡ / हिंदी / தமிழ்) for all labels; plus a "Bilingual Reference" box showing both.
- **Edit Terms**: change service, total, advance, due date. Balance auto-recalculates; editing invalidates prior confirmations (both parties must re-verify).
- **Dual Verification**: Contractor (You) + Customer each "Tap to Confirm"; timestamps recorded; counter shows `0 / 2 → 2 / 2 Confirmed`. "Proceed to Cashfree Payment" stays locked until both confirm.

## 3. Payments — Step 3 "Pay"

- **Two-milestone model**: Milestone 1 = advance (upfront), Milestone 2 = balance (on completion), each shown as a tracker card with paid/due/collecting states.
- **Cashfree-branded gateway card**: QR code, payment link (copyable), payment intent ID and status.
  - **Demo mode** (no keys): mock intent + "Verify / Simulate Advance / Complete Payment" button settles the milestone.
  - **Live mode** (`CASHFREE_APP_ID` + `CASHFREE_SECRET_KEY`): creates a **real Cashfree Payment Link** per milestone, with an "Open" button, client auto-polling of gateway status every 4 s, a manual "I've Paid — Check Status" button, and a **signature-verified webhook** (`/api/webhooks/cashfree`) that settles payments server-side.
- **Status pills**: `PENDING` → `ADVANCE PAID` → `FULLY PAID` (monochrome: dim outline → white tint → solid white).
- **Balance alarm scheduler** (appears once advance is paid): on/off toggle, date + time pickers, "Alarm set for …" status, **Test Alarm** button.
- "Save to History & Start New" resets the flow.

## 4. Payment Alarms & Reminders

- Server computes pending alarms (agreements with unpaid balance) and which are **due today**.
- **Auto-triggered banner** on app load for due payments — "₹6,000 Balance Due • Kitchen Wiring • Suresh Pai" — with **Open Cashfree Gateway** and **Snooze +1d** actions; dismissible.
- **Payment Alarms modal** (bell icon): list of all pending balance alarms with per-agreement on/off toggles, **Ring Test** (fires the banner), and **Collect** (jumps straight into that milestone's gateway).
- Snoozing moves the due date +1 day (persisted).

## 5. Agreement History

- All agreements, newest first: service, customer, spoken-language chip, total, balance, status badge.
- **Search** by customer, service, or agreement ID; **filter pills** (All / Paid / Pending / Completed); empty state.
- **Detail modal** per agreement: financial breakdown, spoken language, created date, Cashfree link ID, due date + alarm state, terms, and status-appropriate actions (open advance gateway / open balance gateway / test alarm / "All Milestones Paid & Verified").

## 6. Account & Settings

- **Business profile**: name, trade name, phone, city (saved server-side, survives restarts).
- **Cashfree settlements**: connected UPI ID, settlement bank row, auto-send receipt toggle.
- **Voice AI settings**: auto-detect toggle, supported-languages chips, bilingual output toggle; live/demo capability badges ("Sarvam STT • LIVE" / "GATEWAY • LIVE" vs demo labels).
- **Save Settings** + **Reset Demo Data** (wipes DB back to the 3 seeded agreements).

## 7. Shell & Navigation

- Mobile-frame layout (max-width column) that works on phone and desktop.
- **Sidebar drawer**: profile card ("Cashfree Verified" badge), live stats (Total Volume, Active Deals), nav links with count badges, sign-out (demo-stubbed).
- **Header**: brand, alarm bell with notification dot (count of active alarms), language auto-detect badge.
- Real routes: `/` (workflow), `/history`, `/settings` — deep-linkable, SPA fallback on the server.

## 8. Notifications

- In-app **toast** system (payments, saves, copies, errors).
- **Alarm banner** (top overlay) for due balance payments.

---

## Real vs Simulated (current state)

| Capability | Demo mode (no keys) | Live mode (keys set) |
|---|---|---|
| Speech-to-text | Scripted 4-language samples | ✅ Real mic → **Sarvam STT** |
| Term extraction | Regex amount parser | ✅ **Sarvam LLM** (service, regional name, customer, due date, amounts) |
| Language detection | ✅ Real (Unicode scripts) | ✅ Real |
| Payment gateway | Mock intents + simulate button | ✅ Real **Cashfree Payment Links** + polling + signed webhook |
| Agreements, confirmations, milestones, alarms, history, settings | ✅ Real (SQLite, server API) | ✅ Same |
| Sign-out / multi-user | Stub (single-merchant MVP) | Not built |

**Capabilities are env-gated** — add `SARVAM_API_KEY` and/or `CASHFREE_APP_ID`+`CASHFREE_SECRET_KEY` and the app switches modes on restart; the boot log prints `[sarvam-stt:live, sarvam-llm:live, cashfree:live]`.

## Languages

ಕನ್ನಡ (Kannada) • हिंदी (Hindi) • தமிழ் (Tamil) • English (IN) • code-mixed speech (LLM mode). UI labels fully bilingual on the agreement card.

## Under the hood

- **Frontend**: React 18, Vite, Tailwind CSS 3, React Router 6 — built bundle served by the API server.
- **Backend**: Node.js + Express 4, SQLite (better-sqlite3, file-based, auto-seeded), 13+ REST endpoints (agreements CRUD, confirmations, payment intents, gateway webhook, status polling, alarms, settings, transcription proxy, reset).
- **Design**: monochrome dark theme — white = verified/paid, dim outline = pending; no status colors.
- **Deploy**: one process/port — `npm install && npm run build && npm start`, or `docker build`. See README.md.

## Not built yet (known gaps)

- Authentication / multi-user (single-merchant MVP; no login).
- Customer-side confirmation — both verifications happen on the merchant's device.
- Out-of-app notifications (SMS / WhatsApp) — alarms are in-app only.
- Real receipt generation (toggle exists, PDF generation doesn't).
- Audio history / replay of recordings.

---
*File: `saudasakshi-app/FEATURES.md` — reflects the codebase as of 21 Nov 2026.*
