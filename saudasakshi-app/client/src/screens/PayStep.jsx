import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { formatINR, formatShortDate, formatTime12h } from '../lib/format.js';
import Toggle from '../components/Toggle.jsx';

export default function PayStep() {
  const {
    draft,
    stage,
    setStage,
    createIntent,
    verifyIntent,
    checkPaymentStatus,
    openBalanceGateway,
    toggleAlarm,
    updateAlarmSchedule,
    saveAndReset,
    setBannerId,
    pushToast,
    capabilities,
  } = useApp();

  const [intent, setIntent] = useState(null);
  const [intentBusy, setIntentBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pollStatus, setPollStatus] = useState(null);
  const intentForRef = useRef(null); // `${draftId}:${stage}` this intent belongs to

  const livePay = !!capabilities?.cashfree && !!intent?.linkUrl;

  useEffect(() => {
    if (!draft) return;
    const key = `${draft.id}:${stage}`;
    if (intentForRef.current === key) return;
    intentForRef.current = key;
    setIntent(null);
    setIntentBusy(true);
    setPollStatus(null);
    createIntent(draft.id, stage)
      .then((res) => setIntent(res.intent))
      .catch((err) => pushToast(err.message))
      .finally(() => setIntentBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, stage, draft?.status]);

  if (!draft) return <EmptyCard />;

  const isBalanceStage = stage === 'BALANCE';
  const completed = draft.status === 'COMPLETED';
  const advancePaid = draft.status === 'ADVANCE_PAID';
  const amount = isBalanceStage ? draft.balance : draft.advance;

  const onVerify = async () => {
    if (!intent || verifying || completed) return;
    setVerifying(true);
    try {
      if (livePay) {
        // Cashfree live: poll the real gateway for settlement
        const data = await checkPaymentStatus(intent.id);
        if (data.status === 'PAID') {
          pushToast('Payment received! Cashfree confirmed the settlement.');
        } else {
          setPollStatus(data.status);
          pushToast(`Payment status: ${data.status}. Auto-checking every few seconds…`);
        }
      } else {
        // Mock mode: simulated gateway round-trip latency
        await new Promise((r) => setTimeout(r, 850));
        const updated = await verifyIntent(intent.id);
        pushToast(
          updated.status === 'COMPLETED'
            ? 'Complete payment verified! Agreement settled.'
            : 'Advance paid! Balance alarm active.'
        );
      }
    } catch (err) {
      pushToast(err.message);
    } finally {
      setVerifying(false);
    }
  };

  // Live Cashfree: auto-poll gateway status while this unsettled intent is on screen
  useEffect(() => {
    if (!livePay || !intent || completed) return undefined;
    const t = setInterval(async () => {
      try {
        const data = await checkPaymentStatus(intent.id);
        setPollStatus(data.status === 'PAID' ? null : data.status);
      } catch {
        /* transient poll failure — next tick retries */
      }
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePay, intent?.id, completed]);

  const onCollectBalance = () => {
    if (advancePaid) {
      openBalanceGateway(draft.id);
    } else {
      setStage('BALANCE');
    }
  };

  const onCopy = async () => {
    if (!intent) return;
    const link = `https://payments.cashfree.com/links/${draft.id.toLowerCase()}${isBalanceStage ? '-bal' : ''}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.getElementById('cashfree-link-input');
        input?.select();
        document.execCommand('copy');
      }
      setCopied(true);
      pushToast('Payment link copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      pushToast('Could not copy link');
    }
  };

  const pill = pillFor(draft.status);
  const mockLink = `https://payments.cashfree.com/links/${draft.id.toLowerCase()}${isBalanceStage ? '-bal' : ''}`;
  const link = livePay ? intent.linkUrl : mockLink;

  return (
    <div className="flex-1 flex flex-col justify-between screen-animate">
      <div className="space-y-5">
        {/* Gateway summary card */}
        <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA]">
              {completed ? 'Complete Payment Verified' : advancePaid && !isBalanceStage ? 'Advance Received • Balance Pending' : isBalanceStage ? 'Remaining Balance Payment Due' : 'Advance Payment Due'}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all border ${pill.cls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} />
              {pill.text}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-bold tracking-tight text-white">
              {formatINR(completed ? draft.total : amount)}
            </div>
            <div className="text-right">
              <span className="block text-[11px] text-[#A1A1AA]">
                {completed ? 'Remaining Balance' : isBalanceStage ? 'Advance Already Paid' : advancePaid ? 'Balance Due' : 'Balance after work'}
              </span>
              <span className="text-sm font-semibold text-zinc-300">
                {formatINR(completed ? 0 : isBalanceStage ? draft.advance : draft.balance)}
              </span>
            </div>
          </div>

          {/* Milestones */}
          <div className="mt-4 pt-4 border-t border-[#27272A] grid grid-cols-2 gap-3">
            <Milestone
              label="Milestone 1 • Advance"
              cls={draft.status === 'PENDING' && !isBalanceStage ? 'bg-[#09090B] border border-white/40' : 'bg-white/10 border border-white/25'}
              textCls={draft.status === 'PENDING' && !isBalanceStage ? 'text-white' : 'text-white'}
              value={
                draft.status === 'PENDING'
                  ? `${formatINR(draft.advance)} ${isBalanceStage ? 'Paid' : 'Advance Due'}`
                  : `${formatINR(draft.advance)} Paid ✓`
              }
            />
            <Milestone
              label="Milestone 2 • Balance"
              cls={
                isBalanceStage && !completed
                  ? 'bg-[#09090B] border border-white/40'
                  : draft.status === 'PENDING'
                    ? 'bg-[#09090B] border border-[#27272A]'
                    : draft.balance === 0
                      ? 'bg-white/10 border border-white/25'
                      : 'bg-[#09090B] border border-[#3F3F46]'
              }
              textCls={
                isBalanceStage && !completed
                  ? 'text-white'
                  : draft.status === 'PENDING'
                    ? 'text-[#A1A1AA]'
                    : draft.balance === 0
                      ? 'text-white'
                      : 'text-zinc-300'
              }
              value={
                completed
                  ? `${formatINR(draft.advance + draft.balance)} Paid ✓`
                  : isBalanceStage
                    ? `${formatINR(draft.balance)} Collecting Now`
                    : `${formatINR(draft.balance)} Due ${formatShortDate(draft.dueDate)}`
              }
            />
          </div>
        </div>

        {/* Balance alarm scheduler (advance paid, balance pending) */}
        {(advancePaid || (isBalanceStage && !completed)) && (
          <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#09090B] border border-[#27272A] flex items-center justify-center text-white">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">Remaining Balance Alarm</div>
                  <div className="text-[10px] text-[#A1A1AA]">Notify on next due date to collect balance</div>
                </div>
              </div>
              <Toggle
                checked={draft.alarmEnabled}
                onChange={(v) => toggleAlarm(draft.id, v).catch((e) => pushToast(e.message))}
                size="sm"
                label="Toggle balance alarm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-[#A1A1AA] mb-1">Next Payment Date</label>
                <input
                  type="date"
                  value={draft.dueDate}
                  onChange={(e) =>
                    e.target.value &&
                    updateAlarmSchedule(draft.id, e.target.value, draft.reminderTime).then(() =>
                      pushToast(`Alarm updated for ${formatShortDate(e.target.value)}`)
                    )
                  }
                  className="w-full bg-[#09090B] border border-[#27272A] focus:border-white rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#A1A1AA] mb-1">Alarm Time</label>
                <input
                  type="time"
                  value={draft.reminderTime}
                  onChange={(e) =>
                    e.target.value &&
                    updateAlarmSchedule(draft.id, draft.dueDate, e.target.value).then(() =>
                      pushToast(`Alarm updated for ${formatTime12h(e.target.value)}`)
                    )
                  }
                  className="w-full bg-[#09090B] border border-[#27272A] focus:border-white rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className={`text-[11px] font-medium ${draft.alarmEnabled ? 'text-white' : 'text-[#A1A1AA]'}`}>
                {draft.alarmEnabled
                  ? `Alarm set for ${formatShortDate(draft.dueDate, { withYear: true })}, ${formatTime12h(draft.reminderTime)}`
                  : 'Alarm paused'}
              </span>
              <button
                onClick={() => setBannerId(draft.id)}
                className="px-2.5 py-1 rounded-lg bg-[#09090B] border border-[#27272A] hover:border-zinc-500 text-[11px] font-medium text-white transition-colors"
              >
                Test Alarm
              </button>
            </div>
          </div>
        )}

        {/* QR + gateway link (hidden once advance is settled or fully paid) */}
        {!completed && (!advancePaid || isBalanceStage) && (
          <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-5 flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA]">
                Cashfree Gateway • {isBalanceStage ? 'Final Balance' : 'Advance'}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-[#09090B] border border-[#27272A] text-[10px] font-mono text-zinc-300">
                UPI / Card / NetBanking
              </span>
            </div>

            <div className="p-3 bg-white rounded-xl shadow-md">
              <QrCode />
            </div>
            <p className="text-[11px] text-[#A1A1AA] mt-4">Scan with any UPI app or share link below</p>

            <div className="w-full mt-5 flex items-center gap-2 bg-[#09090B] border border-[#27272A] rounded-xl p-2 pl-3">
              <input
                id="cashfree-link-input"
                type="text"
                readOnly
                value={link}
                className="w-full bg-transparent text-xs font-mono text-zinc-300 focus:outline-none truncate"
              />
              {livePay && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-white text-[#09090B] text-xs font-semibold hover:bg-zinc-200 transition-colors"
                >
                  Open
                </a>
              )}
              <button
                onClick={onCopy}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-[#121215] border border-[#27272A] hover:border-zinc-500 text-xs font-medium text-white transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            {intentBusy && <p className="text-[11px] text-[#A1A1AA] mt-3">Creating payment intent…</p>}
            {intent && !intentBusy && (
              <p className="text-[11px] font-mono text-[#A1A1AA] mt-3">
                intent {intent.id} • {pollStatus || intent.status}
                {livePay ? ' • auto-checking' : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="mt-8 pt-2 space-y-3">
        {completed ? (
          <button
            disabled
            className="w-full py-3.5 px-5 rounded-xl bg-white/15 border border-white/25 text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-default"
          >
            Full Payment Settled via Cashfree ✓
          </button>
        ) : (
          <button
            onClick={onVerify}
            disabled={!intent || verifying}
            className="w-full py-3.5 px-5 rounded-xl bg-white text-[#09090B] font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-zinc-200 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className={`w-4 h-4 animate-spin text-[#09090B] ${verifying ? '' : 'hidden'}`} viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
            </svg>
            <span>
              {verifying
                ? 'Checking Cashfree status...'
                : livePay
                  ? `I've Paid — Check Status (${formatINR(amount)})`
                  : isBalanceStage
                    ? `Verify / Simulate Complete Payment (${formatINR(amount)})`
                    : `Verify / Simulate Advance (${formatINR(amount)})`}
            </span>
          </button>
        )}

        {advancePaid && !isBalanceStage && !completed && (
          <button
            onClick={onCollectBalance}
            className="w-full py-3.5 px-5 rounded-xl bg-white text-[#09090B] font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-zinc-200 active:scale-[0.99]"
          >
            Collect Remaining Balance ({formatINR(draft.balance)}) via Cashfree
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        )}

        <button
          onClick={() => {
            saveAndReset();
            pushToast('Saved to History. Ready for next agreement.');
          }}
          className="w-full py-3 px-5 rounded-xl bg-[#121215] border border-[#27272A] hover:border-zinc-500 text-zinc-300 hover:text-white font-medium text-xs transition-colors"
        >
          Save to History &amp; Start New
        </button>
      </div>
    </div>
  );
}

function pillFor(status) {
  if (status === 'COMPLETED')
    return { text: 'FULLY PAID', cls: 'bg-white/15 text-white border-white/25', dot: 'bg-white' };
  if (status === 'ADVANCE_PAID')
    return { text: 'ADVANCE PAID', cls: 'bg-white/15 text-white border-white/25', dot: 'bg-white' };
  return { text: 'PENDING', cls: 'bg-transparent text-zinc-400 border-[#3F3F46]', dot: 'bg-zinc-500' };
}

function Milestone({ label, cls, textCls, value }) {
  return (
    <div className={`rounded-xl p-3.5 transition-colors ${cls}`}>
      <span className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">{label}</span>
      <div className={`text-xs font-semibold mt-1 ${textCls}`}>{value}</div>
    </div>
  );
}

function QrCode() {
  // Decorative static QR placeholder (mock gateway)
  return (
    <svg width="136" height="136" viewBox="0 0 29 29" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Cashfree Payment QR Code">
      <rect width="29" height="29" fill="#FFFFFF" />
      <path fill="#09090B" d="M1 1h7v7H1V1zm1 1v5h5V2H2zm1 1h3v3H3V3z" />
      <path fill="#09090B" d="M21 1h7v7h-7V1zm1 1v5h5V2h-5zm1 1h3v3h-3V3z" />
      <path fill="#09090B" d="M1 21h7v7H1v-7zm1 1v5h5v-5H2zm1 1h3v3H3v-3z" />
      <path fill="#09090B" d="M10 1h2v1h-2V1zm4 0h1v2h-1V1zm3 0h2v1h-2V1zM10 3h1v2h-1V3zm3 1h3v1h-3V4zm5 0h1v3h-1V4zM10 6h2v2h-2V6zm4 0h2v1h-2V6zm3 2h2v1h-2V8zM1 10h2v2H1v-2zm4 0h3v1H5v-1zm5 0h2v3h-2v-3zm4 0h2v2h-2v-2zm4 0h3v1h-3v-1zm5 0h2v2h-2v-2zm3 0h2v3h-2v-3zM2 13h2v2H2v-2zm4 0h2v3H6v-3zm5 1h3v2h-3v-2zm5-1h2v3h-2v-3zm4 1h2v2h-2v-2zm5 0h2v2h-2v-2zm3 0h2v3h-2v-3zM1 16h3v1H1v-1zm4 1h2v2H5v-2zm4-1h2v3H9v-3zm4 1h3v2h-3v-2zm5 0h2v2h-2v-2zm4-1h2v3h-2v-3zm4 1h2v2h-2v-2zM10 20h2v2h-2v-2zm4 0h2v1h-2v-1zm4 0h3v2h-3v-2zm5 0h2v2h-2v-2zM10 23h3v2h-3v-2zm5-1h2v3h-2v-3zm4 1h2v2h-2v-2zm4 0h4v2h-4v-2zM10 26h2v2h-2v-2zm4 0h3v2h-3v-2zm5 0h2v2h-2v-2zm4 0h2v2h-2v-2zm3 0h2v2h-2v-2z" />
    </svg>
  );
}

function EmptyCard() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-8 text-center">
        <p className="text-sm font-medium text-white">No active agreement</p>
        <p className="text-xs text-[#A1A1AA] mt-1">Go to Step 1 and generate an agreement first.</p>
      </div>
    </div>
  );
}
