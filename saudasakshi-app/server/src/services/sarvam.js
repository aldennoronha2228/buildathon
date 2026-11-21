/**
 * Sarvam AI integration — server-side proxy (the API key never reaches the browser).
 *
 * Capabilities, all env-gated:
 *  - STT:      POST /speech-to-text (model saaras:v4) — enabled by SARVAM_API_KEY
 *  - LLM:      POST /v2/chat/completions (model sarvam-105b) — extracts structured
 *              agreement terms (service, total, advance) from a free transcript.
 *
 * Credentials stay server-side. Provider errors are surfaced to API callers.
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

  const normalizedMime = String(mimeType).split(';')[0].trim().toLowerCase();
  const extensionByMime = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
  };
  const extension = extensionByMime[normalizedMime];
  if (!extension) throw Object.assign(new Error(`Unsupported recording format: ${normalizedMime || 'unknown'}`), { status: 415 });
  if (!audioBuffer?.length) throw Object.assign(new Error('The recording is empty'), { status: 400 });

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: normalizedMime }), `recording.${extension}`);
  form.append('model', process.env.SARVAM_STT_MODEL || 'saaras:v4');
  form.append('mode', 'transcribe');
  form.append('language_code', 'unknown');

  let res;
  try {
    res = await fetch(`${BASE}/speech-to-text`, {
      method: 'POST',
      headers: { 'api-subscription-key': process.env.SARVAM_API_KEY },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw Object.assign(new Error(`Sarvam STT request failed: ${err.message}`), { status: 502 });
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    let message = detail;
    try {
      const body = JSON.parse(detail);
      const error = body.error;
      message = typeof error === 'string' ? error : error?.message || error?.code || body.detail || detail;
    } catch {
      // Keep the provider's plain-text error response.
    }
    const status = res.status === 400 ? 422 : res.status === 403 ? 401 : res.status === 429 ? 429 : res.status === 503 ? 503 : 502;
    throw Object.assign(new Error(`Sarvam STT rejected the audio (${res.status}): ${message}`), { status });
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
 "advance": <advance amount as integer rupees or null if not explicitly stated>}
Rules:
- Amounts are usually stated with ₹ or numbers; "advance/upfront/ಮುಂಗಡ/एडवांस/முன்பணம்" marks the advance, "balance/remaining/ಬಾಕಿ/बाकी/மீதி" marks the rest.
- advance must be <= total. If the advance is not explicit, return null; do not infer a payment split.
- customer_name: include only when the speaker names the customer. Use the name as spoken; never invent one.
- due_date: include ONLY when an explicit calendar date (e.g. "25 November", "ನವೆಂಬರ್ 25") is spoken. Relative phrases like "after work" or "next week" stay null. Format YYYY-MM-DD, year = current year unless stated.
- If you cannot find any amount, return {"error": "no_amount"}.`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDueDate(value) {
  if (!value || typeof value !== 'string') return null;
  const raw = value.trim().slice(0, 10);
  if (!ISO_DATE.test(raw)) return null;
  const parsed = new Date(raw + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return null;
  // Sanity window: reject dates more than 1 year out or in the past beyond 30 days
  const now = Date.now();
  const t = parsed.getTime();
  if (t < now - 30 * 86400000 || t > now + 365 * 86400000) return null;
  return raw;
}

/**
 * Extract structured agreement terms from a transcript using the Sarvam LLM.
 * @returns {Promise<{service:string, serviceRegional:string|null, customerName:string|null,
 *                     dueDate:string|null, total:number, advance:number}>}
 */
export async function extractAgreement(transcript) {
  if (!sarvamLlmEnabled())
    throw Object.assign(new Error('Sarvam LLM is not configured (missing SARVAM_API_KEY)'), { status: 503 });

  try {
    const res = await fetch(`${BASE}/v2/chat/completions`, {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.SARVAM_LLM_MODEL || 'sarvam-105b',
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: transcript },
        ],
        temperature: 0.1,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw Object.assign(new Error(`Sarvam LLM failed (${res.status}): ${detail}`), { status: 502 });
    }

    const data = await res.json();
    let content = String(data?.choices?.[0]?.message?.content || '').trim();
    // strip markdown fences if the model wraps the JSON
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Sarvam LLM returned invalid agreement data');
    const parsed = JSON.parse(match[0]);
    if (parsed.error || typeof parsed.total !== 'number' || !Number.isSafeInteger(parsed.total) || parsed.total <= 0 || parsed.total > 10000000)
      throw new Error('Sarvam LLM could not identify a valid total amount');

    const total = Math.round(parsed.total);
    const advance = Number(parsed.advance);
    if (parsed.advance === null || parsed.advance === undefined || !Number.isFinite(advance) || advance < 0 || advance > total)
      throw new Error('Sarvam LLM returned an invalid advance amount');

    const service = String(parsed.service || '').trim().slice(0, 120);
    if (!service) throw new Error('Sarvam LLM could not identify the service description');

    const customerName = String(parsed.customer_name || '').trim().slice(0, 60) || null;
    const dueDate = normalizeDueDate(parsed.due_date);

    return {
      service,
      serviceRegional: String(parsed.service_regional || '').trim() || null,
      customerName,
      dueDate,
      total,
      advance,
    };
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error(err.message || 'Sarvam LLM extraction failed'), { status: 502 });
  }
}
