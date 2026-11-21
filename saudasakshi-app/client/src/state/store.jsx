import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { todayIso } from '../lib/format.js';

const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

let toastSeq = 0;

export function AppProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('saudasakshi-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [agreements, setAgreements] = useState([]);
  const [alarms, setAlarms] = useState({ alarms: [], activeCount: 0, dueToday: [] });

  // Workflow state
  const [draftId, setDraftId] = useState(null);
  const [step, setStep] = useState(1);
  const [unlocked, setUnlocked] = useState(1);
  const [stage, setStage] = useState('ADVANCE'); // 'ADVANCE' | 'BALANCE'
  const [cardLang, setCardLang] = useState('en');
  const [lastDetected, setLastDetected] = useState(null); // {code, confidence} for header badge

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState('workflow'); // mirrored from route
  const [detailId, setDetailId] = useState(null);
  const [alarmsModalOpen, setAlarmsModalOpen] = useState(false);
  const [bannerId, setBannerId] = useState(null);
  const [dismissedBanners, setDismissedBanners] = useState(() => new Set());
  const [toasts, setToasts] = useState([]);
  const [bootError, setBootError] = useState(null);
  const [capabilities, setCapabilities] = useState({ sarvamStt: false, sarvamLlm: false, cashfree: false });

  const draft = useMemo(() => agreements.find((a) => a.id === draftId) || null, [agreements, draftId]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('saudasakshi-theme', next);
      } catch {
        // The selected theme still applies when storage is unavailable.
      }
      return next;
    });
  }, []);

  /* ------------------------------ toasts ------------------------------ */

  const pushToast = useCallback((message) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-2), { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  }, []);

  /* ------------------------------ loading ------------------------------ */

  const refreshAgreements = useCallback(async () => {
    const list = await api.listAgreements();
    setAgreements(list);
    return list;
  }, []);

  const refreshAlarms = useCallback(async () => {
    const data = await api.listAlarms();
    setAlarms(data);
    return data;
  }, []);

  const patchAgreement = useCallback((updated) => {
    setAgreements((list) => list.map((a) => (a.id === updated.id ? updated : a)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, alarmData, profileData, health] = await Promise.all([
          api.listAgreements(),
          api.listAlarms(),
          api.getSettings(),
          api.health().catch(() => null),
        ]);
        if (cancelled) return;
        setAgreements(list);
        setAlarms(alarmData);
        setProfile(profileData);
        if (health?.capabilities) setCapabilities(health.capabilities);
      } catch (err) {
        if (!cancelled) setBootError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll alarms periodically so due-payment banners appear without manual refresh
  useEffect(() => {
    const t = setInterval(() => {
      refreshAlarms().catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [refreshAlarms]);

  // Auto-show banner for alarms due today (unless dismissed this session)
  useEffect(() => {
    if (bannerId) return;
    const due = alarms.dueToday.find((a) => !dismissedBanners.has(a.id));
    if (due) setBannerId(due.id);
  }, [alarms, bannerId, dismissedBanners]);

  const bannerAgreement = useMemo(
    () => agreements.find((a) => a.id === bannerId) || null,
    [agreements, bannerId]
  );

  /* --------------------------- workflow actions --------------------------- */

  const navigateToStep = useCallback(
    (target) => {
      if (target > unlocked) {
        pushToast('Complete the current step first');
        return;
      }
      setStep(target);
    },
    [unlocked, pushToast]
  );

  const generateAgreement = useCallback(
    async ({ transcript, service, serviceRegional }) => {
      const created = await api.createAgreement({ transcript, service, serviceRegional });
      setAgreements((list) => [created, ...list]);
      setDraftId(created.id);
      setStage('ADVANCE');
      setUnlocked(2);
      setStep(2);
      return created;
    },
    [pushToast]
  );

  const editTerms = useCallback(
    async (id, patch) => {
      const updated = await api.updateAgreement(id, patch);
      patchAgreement(updated);
      return updated;
    },
    [patchAgreement]
  );

  const confirmPartyAction = useCallback(
    async (id, party) => {
      const updated = await api.confirmParty(id, party);
      patchAgreement(updated);
      return updated;
    },
    [patchAgreement]
  );

  const proceedToPayment = useCallback(() => {
    if (!draft) return;
    setStage(draft.status === 'ADVANCE_PAID' ? 'BALANCE' : 'ADVANCE');
    setUnlocked((u) => Math.max(u, 3));
    setStep(3);
  }, [draft]);

  const openBalanceGateway = useCallback(
    (id) => {
      setDraftId(id);
      setStage('BALANCE');
      setUnlocked((u) => Math.max(u, 3));
      setStep(3);
    },
    []
  );

  const createIntent = useCallback(
    async (id, payStage) => api.createPayment(id, payStage),
    []
  );


  /** Live-Cashfree mode: poll the gateway for the intent's real settlement status. */
  const checkPaymentStatus = useCallback(
    async (intentId) => {
      const data = await api.checkPaymentStatus(intentId);
      if (data.agreement) patchAgreement(data.agreement);
      if (data.status === 'PAID') refreshAlarms().catch(() => {});
      return data;
    },
    [patchAgreement, refreshAlarms]
  );

  const snooze = useCallback(
    async (id) => {
      const updated = await api.snoozeAlarm(id);
      patchAgreement(updated);
      refreshAlarms().catch(() => {});
      return updated;
    },
    [patchAgreement, refreshAlarms]
  );

  const toggleAlarm = useCallback(
    async (id, enabled) => {
      const updated = await api.updateAgreement(id, { alarmEnabled: enabled });
      patchAgreement(updated);
      refreshAlarms().catch(() => {});
      return updated;
    },
    [patchAgreement, refreshAlarms]
  );

  const updateAlarmSchedule = useCallback(
    async (id, dueDate, reminderTime) => {
      const updated = await api.updateAgreement(id, { dueDate, reminderTime, alarmEnabled: true });
      patchAgreement(updated);
      refreshAlarms().catch(() => {});
      return updated;
    },
    [patchAgreement, refreshAlarms]
  );

  const saveAndReset = useCallback(() => {
    setDraftId(null);
    setStep(1);
    setUnlocked(1);
    setStage('ADVANCE');
    setCardLang('en');
    setLastDetected(null);
    refreshAlarms().catch(() => {});
  }, [refreshAlarms]);

  const openGatewayFromHistory = useCallback(
    (id, payStage) => {
      setDraftId(id);
      setStage(payStage);
      setUnlocked(3);
      setStep(3);
      setCardLang('en');
      setDetailId(null);
      setAlarmsModalOpen(false);
      setBannerId(null);
    },
    []
  );

  /* ----------------------------- settings ----------------------------- */

  const saveSettings = useCallback(async (nextProfile) => {
    const saved = await api.saveSettings(nextProfile);
    setProfile(saved);
    return saved;
  }, []);


  /* ------------------------------- modal ------------------------------- */

  const detailAgreement = useMemo(
    () => agreements.find((a) => a.id === detailId) || null,
    [agreements, detailId]
  );

  const value = {
    // data
    profile,
    agreements,
    alarms,
    draft,
    draftId,
    bannerAgreement,
    detailAgreement,
    capabilities,
    theme,
    toggleTheme,
    // workflow
    step,
    unlocked,
    stage,
    cardLang,
    lastDetected,
    // ui
    sidebarOpen,
    view,
    alarmsModalOpen,
    detailId,
    toasts,
    bootError,
    // setters
    setDraftId,
    setStep: navigateToStep,
    setStepRaw: setStep,
    setStage,
    setCardLang,
    setLastDetected,
    setSidebarOpen,
    setView,
    setDetailId,
    setAlarmsModalOpen,
    setBannerId,
    dismissBanner: (id) => {
      setDismissedBanners((set) => new Set(set).add(id));
      setBannerId(null);
    },
    pushToast,
    // actions
    refreshAgreements,
    refreshAlarms,
    generateAgreement,
    editTerms,
    confirmParty: confirmPartyAction,
    proceedToPayment,
    openBalanceGateway,
    createIntent,
    checkPaymentStatus,
    snooze,
    toggleAlarm,
    updateAlarmSchedule,
    saveAndReset,
    openGatewayFromHistory,
    saveSettings,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
