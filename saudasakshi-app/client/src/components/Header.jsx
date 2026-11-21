import { useApp } from '../state/store.jsx';
import { scenarioFor } from '../lib/scenarios.js';

export default function Header() {
  const { setSidebarOpen, setAlarmsModalOpen, alarms, lastDetected, view, theme, toggleTheme } = useApp();
  const showProgress = view === 'workflow';
  const activeAlarms = alarms.activeCount;

  const label = lastDetected ? `${scenarioFor(lastDetected.code).label} • Auto` : 'Auto-Detect';
  const highlighted = !!lastDetected;

  return (
    <header className="sticky top-0 z-30 bg-[#09090B]/95 backdrop-blur-md border-b border-[#27272A]">
      <div className="px-5 py-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-xl bg-[#121215] border border-[#27272A] hover:border-zinc-500 text-white transition-colors focus:outline-none"
            aria-label="Open Navigation Menu"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" x2="20" y1="6" y2="6" />
              <line x1="4" x2="20" y1="12" y2="12" />
              <line x1="4" x2="20" y1="18" y2="18" />
            </svg>
          </button>
          <span className="text-sm font-semibold tracking-tight text-white">SaudaSakshi</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full bg-[#121215] border border-[#27272A] hover:border-zinc-500 text-white transition-colors focus:outline-none"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setAlarmsModalOpen(true)}
            className="relative p-2 rounded-full bg-[#121215] border border-[#27272A] hover:border-zinc-500 text-white transition-colors focus:outline-none"
            aria-label="Open Payment Alarms"
            title="Scheduled Balance Payment Alarms"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {activeAlarms > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#09090B]" />
            )}
          </button>

          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all duration-300 ${
              highlighted
                ? 'bg-white/10 border border-white/40 font-semibold text-white'
                : 'bg-[#121215] border border-[#27272A] font-medium text-white'
            }`}
            title="Automatic Language Detection"
          >
            <svg
              className="w-3.5 h-3.5 text-white shrink-0 transition-transform duration-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="4" y1="10" x2="4" y2="14" />
              <line x1="8" y1="7" x2="8" y2="17" />
              <line x1="12" y1="4" x2="12" y2="20" />
              <line x1="16" y1="7" x2="16" y2="17" />
              <line x1="20" y1="10" x2="20" y2="14" />
            </svg>
            <span className="tracking-tight">{label}</span>
          </div>
        </div>
      </div>

      {showProgress && <StepTabs />}
    </header>
  );
}

function StepTabs() {
  const { step, setStep } = useApp();
  const steps = [
    { n: 1, label: '1. Voice' },
    { n: 2, label: '2. Confirm' },
    { n: 3, label: '3. Pay' },
  ];
  return (
    <nav className="px-5 pb-3.5 pt-1.5" aria-label="Agreement Progress">
      <div className="grid grid-cols-3 gap-2">
        {steps.map((s) => {
          const active = s.n <= step;
          return (
            <button key={s.n} onClick={() => setStep(s.n)} className="group text-left focus:outline-none">
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`text-[11px] ${active ? 'font-semibold text-white' : 'font-medium text-[#A1A1AA]'}`}>
                  {s.label}
                </span>
              </div>
              <div className={`h-1 w-full rounded-full transition-all duration-300 ${active ? 'bg-white' : 'bg-[#27272A]'}`} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
