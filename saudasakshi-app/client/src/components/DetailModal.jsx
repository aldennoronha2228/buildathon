import { useApp } from '../state/store.jsx';
import { formatINR, formatShortDate, formatTime12h } from '../lib/format.js';
import StatusBadge from './StatusBadge.jsx';

export default function DetailModal() {
  const { detailAgreement: a, setDetailId, openGatewayFromHistory, setBannerId, pushToast } = useApp();
  if (!a) return null;

  const closeModal = () => setDetailId(null);

  let actions;
  if (a.status === 'ADVANCE_PAID') {
    actions = (
      <>
        <button
          onClick={() => openGatewayFromHistory(a.id, 'BALANCE')}
          className="w-full py-3 px-4 rounded-xl bg-white text-[#09090B] font-semibold text-xs hover:bg-zinc-200 transition-colors"
        >
          Open Balance Payment Gateway ({formatINR(a.balance)})
        </button>
        <button
          onClick={() => {
            setDetailId(null);
            setBannerId(a.id);
          }}
          className="w-full py-2.5 px-4 rounded-xl bg-[#09090B] border border-[#27272A] hover:border-zinc-500 text-zinc-200 font-medium text-xs transition-colors"
        >
          Test Balance Alarm Notification
        </button>
      </>
    );
  } else if (a.status === 'PENDING') {
    actions = (
      <button
        onClick={() => openGatewayFromHistory(a.id, 'ADVANCE')}
        className="w-full py-3 px-4 rounded-xl bg-white text-[#09090B] font-semibold text-xs hover:bg-zinc-200 transition-colors"
      >
        Open Advance Payment Gateway ({formatINR(a.advance)})
      </button>
    );
  } else {
    actions = (
      <div className="w-full py-2.5 px-4 rounded-xl bg-white/10 border border-white/20 text-center text-xs font-medium text-white">
        All Milestones Paid &amp; Verified
      </div>
    );
  }

  return (
    <div
      onClick={closeModal}
      className="absolute inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-[#121215] border border-[#27272A] rounded-2xl p-5 shadow-2xl space-y-5 screen-animate max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#27272A]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-[#A1A1AA]">#{a.id}</span>
              <StatusBadge status={a.status} />
            </div>
            <h3 className="text-base font-semibold text-white mt-1.5">{a.service}</h3>
            <p className="text-xs text-[#A1A1AA] mt-0.5">Customer: {a.customerName}</p>
          </div>
          <button
            onClick={closeModal}
            className="p-1.5 rounded-lg bg-[#09090B] border border-[#27272A] text-[#A1A1AA] hover:text-white"
            aria-label="Close Details"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#09090B] border border-[#27272A] rounded-xl p-3.5">
            <span className="block text-[10px] text-[#A1A1AA]">Total</span>
            <div className="text-sm font-bold text-white mt-1">{formatINR(a.total)}</div>
          </div>
          <div className="bg-[#09090B] border border-[#27272A] rounded-xl p-3.5">
            <span className="block text-[10px] text-[#A1A1AA]">Advance</span>
            <div className="text-sm font-bold text-white mt-1">{formatINR(a.advance)}</div>
          </div>
          <div className="bg-[#09090B] border border-[#27272A] rounded-xl p-3.5">
            <span className="block text-[10px] text-[#A1A1AA]">Balance</span>
            <div className="text-sm font-bold text-zinc-300 mt-1">{formatINR(a.balance)}</div>
          </div>
        </div>

        <div className="space-y-3 text-xs bg-[#09090B] border border-[#27272A] rounded-xl p-4">
          <Row label="Spoken Language" value={a.language} />
          <Row label="Date Created" value={a.createdAt ? a.createdAt.slice(0, 10) : '—'} />
          <Row label="Cashfree Link ID" value={a.cashfreeLinkId} mono />
          <Row
            label="Balance Due / Alarm"
            value={
              a.status === 'COMPLETED'
                ? 'Settled (No Alarm)'
                : `${formatShortDate(a.dueDate, { withYear: true })} • ${formatTime12h(a.reminderTime)} (${a.alarmEnabled ? 'Alarm ON' : 'Paused'})`
            }
          />
          <div className="pt-2 border-t border-[#27272A]">
            <span className="block text-[#A1A1AA] mb-1">Terms</span>
            <p className="text-zinc-200 leading-relaxed">{a.condition}</p>
          </div>
        </div>

        <div className="pt-1 space-y-2.5">{actions}</div>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#A1A1AA]">{label}</span>
      <span className={`text-white font-medium ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
