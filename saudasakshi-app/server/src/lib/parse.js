/**
 * Shared server-side parsing for verbal agreements.
 * - Real Unicode-script based language detection (no external API needed).
 * - Amount extraction from free-form transcripts.
 */

export function detectLanguage(text) {
  const scripts = [
    ['kn', /[\u0C80-\u0CEF]/], // Kannada
    ['hi', /[\u0900-\u097F]/], // Devanagari (Hindi)
    ['ta', /[\u0B80-\u0BFF]/], // Tamil
  ];
  for (const [code, re] of scripts) {
    if (re.test(text)) return code;
  }
  return 'en';
}

export function parseAmounts(text) {
  const clean = String(text || '').replace(/,/g, '');
  const matches = clean.match(/\d{3,6}/g);
  if (!matches || matches.length < 1) return null;
  const nums = matches.map(Number).sort((a, b) => b - a);
  const total = nums[0];
  let advance = nums[nums.length - 1] < total ? nums[nums.length - 1] : Math.round(total * 0.25);
  advance = Math.min(advance, total);
  return { total, advance, balance: Math.max(0, total - advance) };
}

export function inr(amount) {
  return '₹' + Math.max(0, Number(amount) || 0).toLocaleString('en-IN');
}

export function buildCondition(advance, balance) {
  return `${inr(advance)} upfront via Cashfree, ${inr(balance)} upon work completion.`;
}

export function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
