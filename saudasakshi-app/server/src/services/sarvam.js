/**
 * Sarvam AI integration — server-side proxy (the API key never reaches the browser).
 *
 * Capabilities, all env-gated:
 *  - STT:      POST /speech-to-text/v2 (model saarika:v2.5) — enabled by SARVAM_API_KEY
 *  - LLM:      POST /v1/chat/completions (model sarvam-m) — extracts structured
 *              agreement terms (service, total, advance) from a free transcript.
 *
 * Every function returns null / throws only when actually called; callers fall back
 * to the deterministic local parser when Sarvam is not configured or fails.
 */

const BASE = process.env.SARVAM_BASE || 'https://api.sarvam.ai';

export function sarvamSttEnabled() {
  return !!process.env.SARVAM_API_KEY;
}

export function sarvamLlmEnabled() {
  return !!process.env.SARVAM_API_KEY;
}

/**
 * Transcribe an audio buffer via Sarvam Speech-to-Text.
 * @param {Buffer|Uint8Array} audioBuffer raw audio bytes (webm/ogg/wav from MediaRecorder)
 * @param {string} [mimeType]
 * @returns {Promise<string>} transcript text
 */
export async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  if (!sarvamSttEnabled()) throw new Error('Sarvam STT is not configured (missing SARVAM_API_KEY)');

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: mimeType }));
  form.append('model', process.env.SARVAM_STT_MODEL || 'saarika:v2.5');

  const res = await fetch(`${BASE}/speech-to-text/v2`, {
    method: 'POST',
    headers: { 'api-subscription-key': process.env.SARVAM_API_KEY },
    body: form,
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Sarvam STT failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return String(data.transcript || '').trim();
}

const EXTRACTION_SYSTEM_PROMPT = `You extract structured payment-agreement terms from a verbal work-agreement transcript.
The transcript may be in Kannada, Hindi, Tamil, English, or code-mixed.
Return ONLY a JSON object with this exact shape (no markdown, no explanation):
{"service": "<short English service description, max 6 words>",
 "service_regional": "<the service description in the language it was spoken>",
 "customer_name": "<customer name if explicitly spoken, else null>",
 "due_date": "<balance due date as YYYY-MM-DD ONLY if an explicit date was spoken, else null>",
 "total": <total amount as integer rupees>,
 "advance": <advance amount as integer rupees>}
Rules:
- Amounts are usually stated with ₹ or numbers; "advance/upfront/ಮುಂಗಡ/एडवांस/முன்பணம்" marks the advance, "balance/remaining/ಬಾಕಿ/बाकी/மீதி" marks the rest.
- advance must be <= total. If only one amount is mentioned, treat it as total and set advance to 25% of it (rounded).
- customer_name: include ONLY when the speaker names the customer (e.g. "for Ramesh", "Suresh Pai's house"). Use the name as spoken; never invent one.
- due_date: include ONLY when an explicit calendar date (e.g. "25 November", "ನವೆಂಬರ್ 25") is spoken. Relative phrases like "after work" or "next week" stay null. Format YYYY-MM-DD, year = current year unless stated.
- If you cannot find any amount, return {"error": "no_amount"}.`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDueDate(value) {
  if (!value || typeof value !== 'string') return null;
  const raw = value.trim().slice(0, 10);
  if (!ISO_DATE.test(raw)) return null;
  const parsed = new Date(raw + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime())) return null;
  // Sanity window: reject dates more than 1 year out or in the past beyond 30 days
  const now = Date.now();
  const t = parsed.getTime();
  if (t < now - 30 * 86400000 || t > now + 365 * 86400000) return null;
  return raw;
}

/**
 * Extract structured agreement terms from a transcript using the Sarvam LLM.
 * @returns {Promise<{service:string|null, serviceRegional:string|null, customerName:string|null,
 *                     dueDate:string|null, total:number, advance:number}|null>}
 *          null when Sarvam is not configured or the extraction is unusable —
 *          callers fall back to the deterministic regex parser.
 */
export async function extractAgreement(transcript) {
  if (!sarvamLlmEnabled()) return null;

  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.SARVAM_LLM_MODEL || 'sarvam-m',
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: transcript },
        ],
        temperature: 0.1,
        max_tokens: 400,
      }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    let content = String(data?.choices?.[0]?.message?.content || '').trim();
    // strip markdown fences if the model wraps the JSON
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (parsed.error || typeof parsed.total !== 'number' || parsed.total <= 0) return null;

    const total = Math.round(parsed.total);
    let advance = Math.round(Number(parsed.advance) || 0);
    if (advance < 0) advance = 0;
    if (advance > total) advance = total;

    const customerName = String(parsed.customer_name || '').trim().slice(0, 60) || null;
    const dueDate = normalizeDueDate(parsed.due_date);

    return {
      service: String(parsed.service || '').trim() || null,
      serviceRegional: String(parsed.service_regional || '').trim() || null,
      customerName,
      dueDate,
      total,
      advance,
    };
  } catch (err) {
    console.warn('[sarvam] LLM extraction failed, falling back to regex parser:', err.message);
    return null;
  }
}
