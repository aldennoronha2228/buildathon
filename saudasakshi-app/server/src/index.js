import './config/env.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './api.js';
import { getIntentByLinkId, markIntentPaid } from './db.js';
import { verifyWebhookSignature, extractLinkIdFromWebhook } from './services/cashfree.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


const app = express();

/**
 * Cashfree webhook — MUST be mounted before express.json so we can verify the
 * signature against the raw request body. Cashfree signs: base64(HMAC-SHA256(rawBody, secret)).
 */
app.post(
  '/api/webhooks/cashfree',
  express.raw({ type: '*/*', limit: '1mb' }),
  (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    if (!verifyWebhookSignature(raw, signature, timestamp)) {
      // Not verified — reject so it can't be spoofed. Cashfree will not retry 4xx for bad signature, which is fine.
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const linkId = extractLinkIdFromWebhook(raw.toString('utf8'));
    if (!linkId) return res.status(200).json({ ok: true, note: 'no link reference in payload' });

    const intent = getIntentByLinkId(linkId);
    if (!intent) return res.status(200).json({ ok: true, note: 'unknown link id' });

    try {
      markIntentPaid(intent.id);
    } catch (err) {
      // Already-paid etc. — still 200 so Cashfree stops retrying
      console.warn('[webhook] settle issue:', err.message);
    }
    res.status(200).json({ ok: true });
  }
);

app.use(express.json({ limit: '256kb' }));

app.use('/api', apiRouter);

// Serve the built React client (client/dist) when present
const dist = path.resolve(__dirname, '../../client/dist');
const indexHtml = path.join(dist, 'index.html');

if (fs.existsSync(indexHtml)) {
  app.use(express.static(dist));
  // SPA fallback: anything not under /api returns the client shell
  app.use((req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(indexHtml);
  });
} else {
  app.get('/', (req, res) =>
    res.status(503).send('Client not built yet. Run: npm run build --workspace client')
  );
}

// JSON error handler
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  const caps = [
    `sarvam-stt:${process.env.SARVAM_API_KEY ? 'live' : 'unavailable'}`,
    `sarvam-llm:${process.env.SARVAM_API_KEY ? 'configured' : 'unavailable'}`,
    `cashfree:${process.env.CASHFREE_APP_ID ? 'live' : 'unavailable'}`,
  ];
  console.log(`SaudaSakshi server running on http://localhost:${port} [${caps.join(', ')}]`);
});
