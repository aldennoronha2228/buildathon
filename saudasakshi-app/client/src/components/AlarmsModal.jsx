import { useApp } from '../state/store.jsx';
import { formatINR, formatShortDate, formatTime12h } from '../lib/format.js';
import Toggle from './Toggle.jsx';

export default function AlarmsModal() {
  const { alarmsModalOpen, setAlarmsModalOpen, alarms, toggleAlarm, setBannerId, openGatewayFromHistory } = useApp();
  if (!alarmsModalOpen) return null;

  const close = () => setAlarmsModalOpen(false);

  return (
    <div
      onClick={close}
      className="absolute inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-[#121215] border border-[#27272A] rounded-2xl p-5 shadow-2xl space-y-5 screen-animate max-h-[82vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#27272A]">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white">Payment Alarms</h3>
              <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-[10px] font-semibold text-white">
                {alarms.activeCount} Active
              </span>
            </div>
            <p className="text-xs text-[#A1A1AA] mt-0.5">Scheduled reminders for remaining balance collections.</p>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-lg bg-[#09090B] border border-[#27272A] text-[#A1A1AA] hover:text-white"
            aria-label="Close Alarms"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto flex-1 pr-0.5">
          {alarms.alarms.length === 0 ? (
            <div className="bg-[#09090B] border border-[#27272A] rounded-xl p-6 text-center">
              <p className="text-sm font-medium text-white">No pending balance alarms</p>
              <p className="text-xs text-[#A1A1AA] mt-1">All agreements are fully settled.</p>
            </div>
          ) : (
            alarms.alarms.map((item) => (
              <div key={item.id} className="bg-[#09090B] border border-[#27272A] rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{item.service}</div>
                    <div className="text-[11px] text-[#A1A1AA] mt-0.5">
                      {item.customerName} • <span className="text-white font-semibold">{formatINR(item.balance)}</span> balance
                    </div>
                  </div>
                  <Toggle
                    size="sm"
                    checked={item.alarmEnabled}
                    onChange={(v) => toggleAlarm(item.id, v).catch(() => {})}
                    label={`Toggle alarm for ${item.id}`}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] pt-2.5 border-t border-[#27272A]">
                  <span className={`${item.alarmEnabled ? 'text-white' : 'text-[#A1A1AA]'} font-medium`}>
                    {formatShortDate(item.dueDate)} • {formatTime12h(item.reminderTime)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        close();
                        setBannerId(item.id);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#121215] border border-[#27272A] hover:border-zinc-500 text-[11px] font-medium text-zinc-200"
                    >
                      Ring Test
                    </button>
                    <button
                      onClick={() => openGatewayFromHistory(item.id, item.status === 'ADVANCE_PAID' ? 'BALANCE' : 'ADVANCE')}
                      className="px-2.5 py-1 rounded-lg bg-white text-[#09090B] text-[11px] font-semibold hover:bg-zinc-200"
                    >
                      Collect
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
