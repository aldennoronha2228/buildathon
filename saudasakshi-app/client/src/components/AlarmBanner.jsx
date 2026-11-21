import { useApp } from '../state/store.jsx';
import { formatINR, formatShortDate } from '../lib/format.js';

export default function AlarmBanner() {
  const { bannerAgreement, dismissBanner, snooze, openGatewayFromHistory, pushToast } = useApp();
  if (!bannerAgreement) return null;
  const a = bannerAgreement;

  const onSnooze = async () => {
    try {
      await snooze(a.id);
      pushToast(`Alarm snoozed to ${formatShortDate(a.dueDate)}`);
    } catch (err) {
      pushToast(err.message);
    }
  };

  const onPay = () => {
    openGatewayFromHistory(a.id, a.status === 'PENDING' ? 'ADVANCE' : 'BALANCE');
  };

  return (
    <div className="absolute top-3 left-3 right-3 z-[70] bg-[#121215] border border-white/50 rounded-2xl p-4 shadow-2xl alarm-banner-animate">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-white text-[#09090B] flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-300">Balance Payment Alarm</span>
            <button onClick={() => dismissBanner(a.id)} className="text-[#A1A1AA] hover:text-white text-xs" aria-label="Dismiss Alarm">
              ✕
            </button>
          </div>
          <p className="text-sm font-semibold text-white mt-0.5 truncate">{formatINR(a.balance)} Balance Due</p>
          <p className="text-xs text-[#A1A1AA] mt-0.5 truncate">
            {a.service} • {a.customerName}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onPay}
              className="flex-1 py-2 px-3 rounded-lg bg-white text-[#09090B] text-xs font-semibold hover:bg-zinc-200 transition-colors"
            >
              Open Cashfree Gateway
            </button>
            <button
              onClick={onSnooze}
              className="py-2 px-3 rounded-lg bg-[#09090B] border border-[#27272A] hover:border-zinc-500 text-xs font-medium text-zinc-300 transition-colors"
            >
              Snooze +1d
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
