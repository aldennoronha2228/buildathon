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
  const phone = String(customerPhone || '').replace(/\D/g, '');
  if (!/^\d{10}$/.test(phone))
    throw Object.assign(new Error('A valid customer phone number is required for a Cashfree link'), { status: 400 });

  let res;
  try {
    res = await fetch(`${cfBase()}/pg/links`, {
      method: 'POST',
      headers: cfHeaders(),
      body: JSON.stringify({
        link_id: linkId,
        link_amount: amount,
        link_currency: 'INR',
        link_purpose: purpose,
        customer_details: { customer_name: customerName || undefined, customer_phone: phone },
        link_meta: {
          return_url: returnUrl || undefined,
          notify_url: notifyUrl || undefined,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw Object.assign(new Error(`Cashfree link request failed: ${err.message}`), { status: 502 });
  }

  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Cashfree link creation failed (${res.status}): ${text.slice(0, 300)}`), { status: 502 });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Cashfree returned an invalid response'), { status: 502 });
  }
  const url = data.link_url || data.url;
  if (!url) throw Object.assign(new Error('Cashfree did not return a payment URL'), { status: 502 });
  return {
    linkId: data.link_id || linkId,
    url,
    status: data.link_status || 'ACTIVE',
  };
}

/**
 * Poll the current status of a Cashfree payment link.
 * @returns {Promise<{status:'ACTIVE'|'PAID'|'EXPIRED'|string}>}
 */
export async function getPaymentLinkStatus(linkId) {
  let res;
  try {
    res = await fetch(`${cfBase()}/pg/links/${encodeURIComponent(linkId)}`, {
      method: 'GET',
      headers: cfHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw Object.assign(new Error(`Cashfree status request failed: ${err.message}`), { status: 502 });
  }
  if (!res.ok) throw Object.assign(new Error(`Cashfree status check failed (${res.status})`), { status: 502 });
  const data = await res.json();
  return { status: data.link_status || 'ACTIVE' };
}

/**
 * Verify a Cashfree webhook signature.
 * Cashfree signs timestamp + "." + raw body with the merchant secret.
 */
export function verifyWebhookSignature(rawBody, signatureHeader, timestamp) {
  const secret = process.env.CASHFREE_SECRET_KEY;
  if (!secret || !signatureHeader || !timestamp) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('base64');
  try {
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signatureHeader);
    return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}

/** Return a payment link id only for a confirmed paid event. */
export function extractLinkIdFromWebhook(payloadString) {
  try {
    const data = JSON.parse(payloadString);
    const link = data?.data?.link || data?.link;
    if (String(link?.link_status || data?.link_status || '').toUpperCase() !== 'PAID') return null;
    return (
      link?.link_id ||
      data?.link_id ||
      null
    );
  } catch {
    return null;
  }
}
