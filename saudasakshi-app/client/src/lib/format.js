const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatINR(amount) {
  return '₹' + Math.max(0, Number(amount) || 0).toLocaleString('en-IN');
}

/** '2026-11-22' -> '22 Nov' (with year: '22 Nov 2026') */
export function formatShortDate(isoDate, { withYear = false } = {}) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(isoDate);
  const base = `${d} ${MONTHS[m - 1]}`;
  return withYear ? `${base} ${y}` : base;
}

export function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** '10:00' -> '10:00 AM' */
export function formatTime12h(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(String(hhmm || ''))) return String(hhmm || '');
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'U';
}

/** Real Unicode-script language detection (mirrors server logic). */
export function detectLanguage(text) {
  const scripts = [
    ['kn', /[\u0C80-\u0CEF]/],
    ['hi', /[\u0900-\u097F]/],
    ['ta', /[\u0B80-\u0BFF]/],
  ];
  for (const [code, re] of scripts) {
    if (re.test(text)) return code;
  }
  return 'en';
}
