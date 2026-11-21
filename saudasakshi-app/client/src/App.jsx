import { useEffect, useRef } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './state/store.jsx';
import { api } from './api.js';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import AlarmBanner from './components/AlarmBanner.jsx';
import Toast from './components/Toast.jsx';
import DetailModal from './components/DetailModal.jsx';
import AlarmsModal from './components/AlarmsModal.jsx';
import Workflow from './screens/Workflow.jsx';
import HistoryView from './screens/HistoryView.jsx';
import SettingsView from './screens/SettingsView.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Workflow />} />
        <Route path="/history" element={<HistoryView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Shell() {
  const { setView, bootError, alarmsModalOpen, refreshAgreements, refreshAlarms, pushToast, theme } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const processedPaymentRef = useRef(null);

  // Mirror the current route into the store so the sidebar can highlight the active view
  useEffect(() => {
    if (location.pathname.startsWith('/history')) setView('history');
    else if (location.pathname.startsWith('/settings')) setView('settings');
    else setView('workflow');
  }, [location.pathname, setView]);

  useEffect(() => {
    const linkId = new URLSearchParams(location.search).get('payment');
    if (!linkId) {
      processedPaymentRef.current = null;
      return;
    }
    if (processedPaymentRef.current === linkId) return;
    processedPaymentRef.current = linkId;
    api.checkPaymentStatus(linkId)
      .then(async (result) => {
        await Promise.all([refreshAgreements(), refreshAlarms()]);
        pushToast(result.status === 'PAID' ? 'Cashfree confirmed the payment.' : `Cashfree payment status: ${result.status}`);
      })
      .catch((err) => {
        pushToast(`Could not refresh payment status: ${err.message}`);
      })
      .finally(() => {
        navigate(location.pathname, { replace: true });
      });
  }, [location.pathname, location.search, navigate, pushToast, refreshAgreements, refreshAlarms]);

  // Lock body scroll while a modal is open
  useEffect(() => {
    document.body.style.overflow = alarmsModalOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [alarmsModalOpen]);

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light-page', theme === 'light');
    document.body.classList.toggle('theme-light-page', theme === 'light');
    return () => {
      document.documentElement.classList.remove('theme-light-page');
      document.body.classList.remove('theme-light-page');
    };
  }, [theme]);

  return (
    <div className={`app-theme relative max-w-md mx-auto min-h-screen flex flex-col bg-[#09090B] sm:border-x sm:border-[#27272A] shadow-2xl overflow-hidden ${theme === 'light' ? 'app-theme-light' : ''}`}>
      <Sidebar />
      <Header />
      <AlarmBanner />

      <main className="flex-1 px-5 py-7 flex flex-col">
        {bootError ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-6 text-center">
              <p className="text-sm font-medium text-white">Could not reach the server</p>
              <p className="text-xs text-[#A1A1AA] mt-1">{bootError}</p>
              <p className="text-xs text-[#A1A1AA] mt-3">
                Start it with <span className="font-mono text-zinc-300">npm run start</span>
              </p>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <DetailModal />
      <AlarmsModal />
      <Toast />
    </div>
  );
}
