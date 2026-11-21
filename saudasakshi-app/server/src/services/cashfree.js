/**
 * Cashfree Payment Gateway integration — server-side only (credentials never reach the browser).
 *
 * Uses Cashfree Payment Links (POST /pg/links) which match this app's model:
 * one link per milestone (ADVANCE / BALANCE), shared as a URL / QR, settled
 * out-of-band, then reconciled either by status polling or signed webhooks.
 *
 * Env-gated: set CASHFREE_APP_ID + CASHFREE_SECRET_KEY to go live.
 *   CASHFREE_ENV=sandbox (default) → https://sandbox.cashfree.com
 *   CASHFREE_ENV=production        → https://api.cashfree.com
 */

import crypto from 'node:crypto';

const API_VERSION = process.env.CASHFREE_API_VERSION || '2023-08-01';

function cfBase() {
  return process.env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com'
    : 'https://sandbox.cashfree.com';
}

export function cashfreeEnabled() {
  return !!(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}

function cfHeaders() {
  return {
    'x-client-id': process.env.CASHFREE_APP_ID,
    'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    'x-api-version': API_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Create a Cashfree Payment Link for one milestone.
 * @returns {Promise<{linkId:string, url:string, status:string}>}
 */
export async function createPaymentLink({ linkId, amount, purpose, customerName, customerPhone, returnUrl, notifyUrl }) {
  const res = await fetch(`${cfBase()}/pg/links`, {
    method: 'POST',
    headers: cfHeaders(),
    body: JSON.stringify({
      link_id: linkId,
      link_amount: amount,
      link_currency: 'INR',
      link_purpose: purpose,
      customer_details: {
        customer_name: customerName || 'Customer',
        customer_phone: customerPhone || '9999999999',
      },
      link_meta: {
        return_url: returnUrl || undefined,
        notify_url: notifyUrl || undefined,
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Cashfree link creation failed (${res.status}): ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  return {
    linkId: data.link_id || linkId,
    url: data.link_url || data.url || '',
    status: data.link_status || 'ACTIVE',
  };
}

/**
 * Poll the current status of a Cashfree payment link.
 * @returns {Promise<{status:'ACTIVE'|'PAID'|'EXPIRED'|string}>}
 */
export async function getPaymentLinkStatus(linkId) {
  const res = await fetch(`${cfBase()}/pg/links/${encodeURIComponent(linkId)}`, {
    method: 'GET',
    headers: cfHeaders(),
  });
  if (!res.ok) throw new Error(`Cashfree status check failed (${res.status})`);
  const data = await res.json();
  return { status: data.link_status || 'ACTIVE' };
}

/**
 * Verify a Cashfree webhook signature.
 * Cashfree signs the RAW request body: base64(HMAC-SHA256(rawBody, webhookSecret)),
 * delivered in the `x-webhook-signature` header.
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!process.env.CASHFREE_WEBHOOK_SECRET) return false;
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', process.env.CASHFREE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/** Best-effort extraction of the link id from a webhook payload. */
export function extractLinkIdFromWebhook(payloadString) {
  try {
    const data = JSON.parse(payloadString);
    return (
      data?.data?.link?.link_id ||
      data?.data?.order?.order_id ||
      data?.link_id ||
      data?.order_id ||
      null
    );
  } catch {
    return null;
  }
}
