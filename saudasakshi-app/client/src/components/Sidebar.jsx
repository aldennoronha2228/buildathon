import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/store.jsx';
import { formatINR, initials } from '../lib/format.js';

export default function Sidebar() {
  const { sidebarOpen, setSidebarOpen, profile, agreements, alarms, setAlarmsModalOpen, pushToast, view } = useApp();
  const navigate = useNavigate();

  const totalVolume = agreements.reduce((sum, a) => sum + a.total, 0);
  const activeCount = agreements.filter((a) => a.status !== 'COMPLETED').length;
  const activeAlarms = alarms.alarms.filter((a) => a.alarmEnabled).length;

  const nav = [
    { key: 'workflow', label: 'New Agreement', to: '/app', icon: MicIcon },
    { key: 'history', label: 'Agreement History', to: '/history', icon: HistoryIcon, badge: agreements.length },
    { key: 'alarms', label: 'Payment Alarms', to: null, icon: BellIcon, badge: activeAlarms, action: () => { setSidebarOpen(false); setAlarmsModalOpen(true); } },
    { key: 'settings', label: 'Account & Settings', to: '/settings', icon: GearIcon },
  ];

  return (
    <>
      <div
        onClick={() => setSidebarOpen(false)}
        className={`absolute inset-0 z-40 bg-black/65 backdrop-blur-sm transition-opacity duration-300 ${sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        aria-hidden="true"
      />
      <aside
        className={`absolute inset-y-0 left-0 z-50 w-[82%] max-w-[310px] bg-[#09090B] border-r border-[#27272A] flex flex-col justify-between -translate-x-full ${sidebarOpen ? 'translate-x-0' : ''} transition-transform duration-300 ease-out shadow-2xl`}
        aria-label="Sidebar Navigation"
      >
        <div className="flex flex-col flex-1 overflow-y-auto">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA]">Menu</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded-lg bg-[#121215] border border-[#27272A] text-[#A1A1AA] hover:text-white hover:border-zinc-500 transition-colors"
              aria-label="Close Menu"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {/* Account Summary */}
          <div className="px-4 py-3">
            <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-white text-[#09090B] font-bold text-sm flex items-center justify-center shrink-0 tracking-tight">
                  {initials(profile?.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{profile?.name || '—'}</div>
                  <div className="text-xs text-[#A1A1AA] truncate mt-0.5">
                    {profile?.business || '—'} • {profile?.city || '—'}
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-[#27272A] flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/20 text-[11px] font-medium text-white">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Cashfree Verified
                </span>
                <span className="text-[10px] font-mono text-[#A1A1AA]">KYC OK</span>
              </div>
            </div>
          </div>

          {/* Quick stats */}
          <div className="px-4 pb-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#121215] border border-[#27272A] rounded-xl p-3.5">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-[#A1A1AA]">Total Volume</span>
                <div className="text-sm font-bold text-white mt-1">{formatINR(totalVolume)}</div>
              </div>
              <div className="bg-[#121215] border border-[#27272A] rounded-xl p-3.5">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-[#A1A1AA]">Active Deals</span>
                <div className="text-sm font-bold text-white mt-1">{activeCount}</div>
              </div>
            </div>
          </div>

          {/* Nav links */}
          <nav className="px-3 py-2.5 space-y-1.5">
            {nav.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  if (item.action) return item.action();
                  setSidebarOpen(false);
                  navigate(item.to);
                }}
                className={`w-full px-3 py-3 rounded-xl flex items-center gap-3 text-sm font-medium transition-all ${
                  view === item.key
                    ? 'bg-[#121215] border border-[#27272A] text-white'
                    : 'text-[#A1A1AA] hover:text-white hover:bg-[#121215] border border-transparent'
                }`}
              >
                <item.icon />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      item.key === 'alarms' && activeAlarms > 0
                        ? 'bg-[#18181B] border border-[#3F3F46] text-zinc-300'
                        : 'bg-[#18181B] border border-[#27272A] text-white'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-[#27272A] flex items-center justify-between">
          <span className="text-[11px] font-mono text-[#A1A1AA]">SaudaSakshi MVP v1.0</span>
          <button
            onClick={() => {
              setSidebarOpen(false);
              pushToast('Sign out is not configured');
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#A1A1AA] hover:text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" x2="9" y1="12" y2="12" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}

function MicIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
