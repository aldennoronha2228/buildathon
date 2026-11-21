/** Thin fetch wrapper for the SaudaSakshi API. */

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  listAgreements: () => request('/agreements'),
  getAgreement: (id) => request(`/agreements/${encodeURIComponent(id)}`),
  createAgreement: (payload) => request('/agreements', { method: 'POST', body: payload }),
  updateAgreement: (id, patch) =>
    request(`/agreements/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  confirmParty: (id, party) =>
    request(`/agreements/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: { party } }),
  snoozeAlarm: (id) => request(`/agreements/${encodeURIComponent(id)}/snooze`, { method: 'POST' }),
  createPayment: (id, stage) =>
    request(`/agreements/${encodeURIComponent(id)}/payments`, { method: 'POST', body: { stage } }),
  checkPaymentStatus: (intentId) => request(`/payments/${encodeURIComponent(intentId)}/status`),
  transcribe: async (blob) => {
    const res = await fetch('/api/transcribe', { method: 'POST', body: blob });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok) throw new Error(data?.error || `Transcription failed (${res.status})`);
    return data;
  },
  listAlarms: () => request('/alarms'),
  getSettings: () => request('/settings'),
  saveSettings: (profile) => request('/settings', { method: 'PUT', body: profile }),
};
