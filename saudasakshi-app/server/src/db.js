import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildCondition, detectLanguage } from './lib/parse.js';
import { extractAgreement } from './services/sarvam.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'saudasakshi.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS agreements (
    id TEXT PRIMARY KEY,
    seq INTEGER UNIQUE,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    service TEXT NOT NULL,
    service_regional TEXT NOT NULL,
    language TEXT NOT NULL,
    lang_code TEXT NOT NULL DEFAULT 'en',
    total INTEGER NOT NULL,
    advance INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    condition_text TEXT NOT NULL,
    due_date TEXT NOT NULL,
    reminder_time TEXT NOT NULL DEFAULT '10:00',
    alarm_enabled INTEGER NOT NULL DEFAULT 1,
    link_id TEXT,
    contractor_confirmed_at TEXT,
    customer_confirmed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    agreement_id TEXT NOT NULL REFERENCES agreements(id),
    stage TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED',
    created_at TEXT NOT NULL,
    paid_at TEXT,
    link_url TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Lightweight migrations for pre-existing databases
try {
  db.exec('ALTER TABLE payment_intents ADD COLUMN link_url TEXT');
} catch {
  /* column already exists */
}
try {
  db.exec('ALTER TABLE payment_intents ADD COLUMN link_id TEXT');
} catch {
  /* column already exists */
}
try {
  db.exec("ALTER TABLE agreements ADD COLUMN customer_phone TEXT NOT NULL DEFAULT ''");
} catch {
  /* column already exists */
}

/* ------------------------------ helpers ------------------------------ */

const now = () => new Date().toISOString();

function nextSeq() {
  return Number(db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM agreements').get().seq);
}

function insertAgreement(a) {
  db.prepare(`
    INSERT INTO agreements (
      id, seq, customer_name, customer_phone, service, service_regional, language, lang_code,
      total, advance, balance, status, condition_text, due_date, reminder_time,
      alarm_enabled, link_id, contractor_confirmed_at, customer_confirmed_at,
      created_at, updated_at
    ) VALUES (
      @id, @seq, @customer_name, @customer_phone, @service, @service_regional, @language, @lang_code,
      @total, @advance, @balance, @status, @condition_text, @due_date, @reminder_time,
      @alarm_enabled, @link_id, @contractor_confirmed_at, @customer_confirmed_at,
      @created_at, @updated_at
    )
  `).run(a);
}

function rowToAgreement(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone || '',
    service: row.service,
    serviceRegional: row.service_regional,
    language: row.language,
    langCode: row.lang_code,
    total: row.total,
    advance: row.advance,
    balance: row.balance,
    status: row.status,
    condition: row.condition_text,
    dueDate: row.due_date || null,
    reminderTime: row.reminder_time,
    alarmEnabled: !!row.alarm_enabled,
    cashfreeLinkId: row.link_id || null,
    confirmations: {
      contractor: { confirmed: !!row.contractor_confirmed_at, at: row.contractor_confirmed_at },
      customer: { confirmed: !!row.customer_confirmed_at, at: row.customer_confirmed_at },
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------ queries ------------------------------ */

export function listAgreements() {
  return db
    .prepare('SELECT * FROM agreements ORDER BY seq DESC, created_at DESC')
    .all()
    .map(rowToAgreement);
}

export function getAgreement(id) {
  return rowToAgreement(db.prepare('SELECT * FROM agreements WHERE id = ?').get(id));
}

export async function createAgreement({ transcript, service, serviceRegional, customerName, customerPhone }) {
  const text = String(transcript || '').trim();
  if (text.length < 5) throw Object.assign(new Error('Transcript is too short'), { status: 400 });

  const extracted = await extractAgreement(text);
  const langCode = detectLanguage(text);
  const language = langLabel(langCode);
  const total = Math.round(extracted.total);
  const advance = Math.round(extracted.advance);
  if (advance > total)
    throw Object.assign(new Error('Advance amount cannot exceed the total'), { status: 422 });
  const balance = Math.max(0, total - advance);
  const seq = nextSeq();
  const id = `SS-${seq}`;

  insertAgreement({
    id,
    seq,
    customer_name: String(customerName || extracted.customerName || '').trim().slice(0, 120),
    customer_phone: normalizePhone(customerPhone),
    service: String(service || extracted.service).trim(),
    service_regional: String(serviceRegional || extracted.serviceRegional || extracted.service).trim(),
    language,
    lang_code: langCode,
    total,
    advance,
    balance,
    status: 'PENDING',
    condition_text: buildCondition(advance, balance),
    due_date: extracted.dueDate || '',
    reminder_time: '10:00',
    alarm_enabled: extracted.dueDate ? 1 : 0,
    link_id: null,
    contractor_confirmed_at: null,
    customer_confirmed_at: null,
    created_at: now(),
    updated_at: now(),
  });

  return getAgreement(id);
}

export function updateAgreement(id, patch) {
  const row = db.prepare('SELECT * FROM agreements WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Agreement not found'), { status: 404 });

  const next = {
    customer_name: patch.customerName !== undefined ? String(patch.customerName).trim().slice(0, 120) : row.customer_name,
    customer_phone: patch.customerPhone !== undefined ? normalizePhone(patch.customerPhone) : row.customer_phone,
    service: patch.service !== undefined ? String(patch.service).trim() || row.service : row.service,
    service_regional:
      patch.service !== undefined ? String(patch.service).trim() || row.service_regional : row.service_regional,
    total: patch.total !== undefined ? validAmount(patch.total, 'total', 1) : row.total,
    advance: patch.advance !== undefined ? validAmount(patch.advance, 'advance', 0) : row.advance,
    due_date: patch.dueDate !== undefined ? validDate(patch.dueDate) : row.due_date,
    reminder_time: patch.reminderTime !== undefined ? validTime(patch.reminderTime) : row.reminder_time,
    alarm_enabled: patch.alarmEnabled !== undefined ? (patch.alarmEnabled ? 1 : 0) : row.alarm_enabled,
  };
  if (next.advance > next.total)
    throw Object.assign(new Error('Advance amount cannot exceed the total'), { status: 400 });
  const balance = Math.max(0, next.total - next.advance);

  // Editing terms invalidates prior confirmations (both parties must re-verify)
  const termsChanged =
    next.service !== row.service ||
    next.total !== row.total ||
    next.advance !== row.advance ||
    next.due_date !== row.due_date;

  db.prepare(`
    UPDATE agreements SET
      customer_name = ?, customer_phone = ?, service = ?, service_regional = ?, total = ?, advance = ?, balance = ?,
      condition_text = ?, due_date = ?, reminder_time = ?, alarm_enabled = ?,
      contractor_confirmed_at = ?, customer_confirmed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.customer_name,
    next.customer_phone,
    next.service,
    next.service_regional,
    next.total,
    next.advance,
    balance,
    buildCondition(next.advance, balance),
    next.due_date,
    next.reminder_time,
    next.alarm_enabled,
    termsChanged ? null : row.contractor_confirmed_at,
    termsChanged ? null : row.customer_confirmed_at,
    now(),
    id
  );

  return getAgreement(id);
}

export function confirmParty(id, party) {
  const row = db.prepare('SELECT * FROM agreements WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Agreement not found'), { status: 404 });
  const col = party === 'contractor' ? 'contractor_confirmed_at' : 'customer_confirmed_at';
  if (!row[col]) {
    db.prepare(`UPDATE agreements SET ${col} = ?, updated_at = ? WHERE id = ?`).run(
      `Confirmed ${now().slice(11, 16)}`,
      now(),
      id
    );
  }
  return getAgreement(id);
}

export function createPaymentIntent(id, stage, external = null) {
  const row = db.prepare('SELECT * FROM agreements WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Agreement not found'), { status: 404 });

  const amount = stage === 'ADVANCE' ? row.advance : row.balance;
  if (amount <= 0) throw Object.assign(new Error('Nothing due for this stage'), { status: 400 });
  if (stage === 'ADVANCE' && row.status !== 'PENDING')
    throw Object.assign(new Error('Advance already settled'), { status: 409 });
  if (stage === 'BALANCE' && row.status !== 'ADVANCE_PAID')
    throw Object.assign(new Error('Advance must be settled before balance'), { status: 409 });

  const intent = {
    id: 'pi_' + crypto.randomBytes(6).toString('hex'),
    agreement_id: id,
    stage,
    amount,
    status: 'CREATED',
    created_at: now(),
    paid_at: null,
    link_url: external?.linkUrl || null,
    link_id: external?.linkId || null,
  };
  db.prepare(`
    INSERT INTO payment_intents (id, agreement_id, stage, amount, status, created_at, paid_at, link_url, link_id)
    VALUES (@id, @agreement_id, @stage, @amount, @status, @created_at, @paid_at, @link_url, @link_id)
  `).run(intent);

  return { intent: intentRowToApi(intent), agreement: getAgreement(id) };
}

function intentRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    agreementId: row.agreement_id,
    stage: row.stage,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    linkUrl: row.link_url,
    linkId: row.link_id,
  };
}

export function getIntent(intentId) {
  return intentRowToApi(db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(intentId));
}

export function getIntentByLinkId(linkId) {
  return intentRowToApi(
    db.prepare('SELECT * FROM payment_intents WHERE link_id = ? ORDER BY created_at DESC LIMIT 1').get(linkId)
  );
}

/** Mark an intent paid and advance the agreement's milestone status. Idempotent. */
export function markIntentPaid(intentId) {
  const intent = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(intentId);
  if (!intent) throw Object.assign(new Error('Payment intent not found'), { status: 404 });
  if (intent.status === 'PAID') {
    return { intent: intentRowToApi(intent), agreement: getAgreement(intent.agreement_id), alreadyPaid: true };
  }

  const paidAt = now();
  db.prepare('UPDATE payment_intents SET status = ?, paid_at = ? WHERE id = ?').run('PAID', paidAt, intentId);

  if (intent.stage === 'ADVANCE') {
    db.prepare("UPDATE agreements SET status = 'ADVANCE_PAID', updated_at = ? WHERE id = ?").run(
      paidAt,
      intent.agreement_id
    );
  } else {
    db.prepare(
      "UPDATE agreements SET status = 'COMPLETED', balance = 0, alarm_enabled = 0, updated_at = ? WHERE id = ?"
    ).run(paidAt, intent.agreement_id);
  }

  return { intent: intentRowToApi(db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(intentId)), agreement: getAgreement(intent.agreement_id), alreadyPaid: false };
}

export function snoozeAlarm(id) {
  const row = db.prepare('SELECT * FROM agreements WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Agreement not found'), { status: 404 });
  if (!row.due_date)
    throw Object.assign(new Error('Set a due date before snoozing this alarm'), { status: 400 });
  const d = new Date(row.due_date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  db.prepare('UPDATE agreements SET due_date = ?, updated_at = ? WHERE id = ?').run(
    d.toISOString().slice(0, 10),
    now(),
    id
  );
  return getAgreement(id);
}

export function listAlarms() {
  const rows = db
    .prepare("SELECT * FROM agreements WHERE status != 'COMPLETED' AND balance > 0 ORDER BY due_date ASC")
    .all()
    .map(rowToAgreement);
  return {
    alarms: rows,
    activeCount: rows.filter((a) => a.alarmEnabled).length,
    dueToday: rows.filter((a) => a.alarmEnabled && a.dueDate && a.dueDate <= now().slice(0, 10)),
  };
}

export function getSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'profile'").get();
  if (!row) return null;
  const stored = JSON.parse(row.value);
  return {
    name: String(stored.name || ''),
    business: String(stored.business || ''),
    phone: String(stored.phone || ''),
    city: String(stored.city || ''),
  };
}

export function putSettings(profile) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('profile', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(profile));
  return getSettings();
}


/* --------------------------- small utilities --------------------------- */

function validAmount(value, label, min) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < min || amount > 10000000)
    throw Object.assign(new Error(`${label} must be a whole rupee amount from ${min} to 10000000`), { status: 400 });
  return amount;
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (!/^\d{10}$/.test(digits))
    throw Object.assign(new Error('Customer phone must be a 10-digit number'), { status: 400 });
  return digits;
}

function validDate(v) {
  if (v === '' || v == null) return '';
  const date = String(v);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw Object.assign(new Error('dueDate must be a valid YYYY-MM-DD date'), { status: 400 });
  return date;
}

function validTime(v) {
  if (v === '' || v == null) return '10:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)))
    throw Object.assign(new Error('reminderTime must be a valid HH:MM time'), { status: 400 });
  return String(v);
}

const LANG_LABELS = {
  kn: 'à²•à²¨à³à²¨à²¡ (Kannada)',
  hi: 'à¤¹à¤¿à¤‚à¤¦à¥€ (Hindi)',
  ta: 'à®¤à®®à®¿à®´à¯ (Tamil)',
  en: 'English (India)',
};
function langLabel(code) {
  return LANG_LABELS[code] || LANG_LABELS.en;
}
