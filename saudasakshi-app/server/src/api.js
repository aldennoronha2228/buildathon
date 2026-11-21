import express, { Router } from 'express';
import {
  listAgreements,
  getAgreement,
  createAgreement,
  updateAgreement,
  confirmParty,
  createPaymentIntent,
  getIntent,
  markIntentPaid,
  snoozeAlarm,
  listAlarms,
  getSettings,
  putSettings,
} from './db.js';
import { sarvamSttEnabled, sarvamLlmEnabled, transcribeAudio } from './services/sarvam.js';
import { cashfreeEnabled, createPaymentLink, getPaymentLinkStatus } from './services/cashfree.js';

export const apiRouter = Router();

const wrap = (fn) => (req, res) => {
  try {
    res.json(fn(req, res));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};

const wrapAsync = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};

apiRouter.get('/health', wrap(() => ({
  ok: true,
  service: 'saudasakshi-api',
  capabilities: {
    sarvamStt: sarvamSttEnabled(),
    sarvamLlm: sarvamLlmEnabled(),
    cashfree: cashfreeEnabled(),
  },
})));

apiRouter.get('/agreements', wrap(() => listAgreements()));

apiRouter.get('/agreements/:id', wrap((req) => {
  const agreement = getAgreement(req.params.id);
  if (!agreement) throw Object.assign(new Error('Agreement not found'), { status: 404 });
  return agreement;
}));

apiRouter.post('/agreements', wrapAsync(async (req) => createAgreement(req.body || {})));

apiRouter.patch('/agreements/:id', wrap((req) => updateAgreement(req.params.id, req.body || {})));

apiRouter.post('/agreements/:id/confirm', wrap((req) => {
  const party = req.body?.party;
  if (party !== 'contractor' && party !== 'customer')
    throw Object.assign(new Error('party must be contractor or customer'), { status: 400 });
  return confirmParty(req.params.id, party);
}));

apiRouter.post('/agreements/:id/snooze', wrap((req) => snoozeAlarm(req.params.id)));

/**
 * Create a payment intent for a milestone.
 * Cashfree live mode → creates a real Payment Link and stores it on the intent.
 *
 * Payment links require Cashfree configuration.
 */
apiRouter.post('/agreements/:id/payments', wrapAsync(async (req) => {
  const stage = req.body?.stage;
  if (stage !== 'ADVANCE' && stage !== 'BALANCE')
    throw Object.assign(new Error('stage must be ADVANCE or BALANCE'), { status: 400 });

  if (cashfreeEnabled()) {
    const agreement = getAgreement(req.params.id);
    if (!agreement) throw Object.assign(new Error('Agreement not found'), { status: 404 });

    const settings = getSettings() || {};
    const stamp = Date.now().toString(36);
    const linkId = `sauda_${agreement.id}_${stage.toLowerCase()}_${stamp}`.toLowerCase();
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

    const link = await createPaymentLink({
      linkId,
      amount: stage === 'ADVANCE' ? agreement.advance : agreement.balance,
      purpose: `Agreement ${agreement.id} • ${stage.toLowerCase()} payment`,
      customerName: agreement.customerName,
      customerPhone: (settings.phone || '').replace(/\s+/g, '') || undefined,
      returnUrl: `${base}/history?payment=${linkId}`,
      notifyUrl: `${base}/api/webhooks/cashfree`,
    });

    return createPaymentIntent(req.params.id, stage, { linkId: link.linkId, linkUrl: link.url });
  }

  throw Object.assign(new Error('Cashfree is not configured'), { status: 503 });
}));

/** Poll a payment intent's Cashfree gateway status. */
apiRouter.get('/payments/:intentId/status', wrapAsync(async (req) => {
  const intent = getIntent(req.params.intentId);
  if (!intent) throw Object.assign(new Error('Payment intent not found'), { status: 404 });

  if (intent.status === 'PAID') {
    return { status: 'PAID', agreement: getAgreement(intent.agreementId) };
  }
  if (!intent.linkId || !cashfreeEnabled()) {
    return { status: intent.status, agreement: getAgreement(intent.agreementId) };
  }

  const { status } = await getPaymentLinkStatus(intent.linkId);
  if (status === 'PAID') {
    const { agreement } = markIntentPaid(intent.id);
    return { status: 'PAID', agreement };
  }
  return { status, agreement: getAgreement(intent.agreementId) };
}));


/**
 * Sarvam STT proxy: the browser posts raw recorded audio; we forward it to Sarvam
 * so the subscription key stays server-side.
 */
apiRouter.post('/transcribe', express.raw({ type: () => true, limit: '15mb' }), wrapAsync(async (req) => {
  if (!sarvamSttEnabled())
    throw Object.assign(new Error('Sarvam STT is not configured (missing SARVAM_API_KEY)'), { status: 501 });
  if (!req.body || req.body.length === 0)
    throw Object.assign(new Error('No audio payload'), { status: 400 });

  const transcript = await transcribeAudio(req.body, req.headers['content-type'] || 'audio/webm');
  return { transcript };
}));

apiRouter.get('/alarms', wrap(() => listAlarms()));

apiRouter.get('/settings', wrap(() => getSettings()));

apiRouter.put('/settings', wrap((req) => {
  const p = req.body || {};
  const profile = {
    name: String(p.name || '').trim(),
    business: String(p.business || '').trim(),
    phone: String(p.phone || '').trim(),
    city: String(p.city || '').trim(),
    upi: String(p.upi || '').trim(),
    autoReceipt: !!p.autoReceipt,
    autoDetectVoice: !!p.autoDetectVoice,
    alwaysBilingual: !!p.alwaysBilingual,
  };
  return putSettings(profile);
}));

