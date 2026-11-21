import { useState } from 'react';
import { useApp } from '../state/store.jsx';
import { formatINR, formatShortDate, formatTime12h } from '../lib/format.js';
import { scenarioFor } from '../lib/scenarios.js';

export default function ConfirmStep() {
  const { draft, profile, cardLang, setCardLang, editTerms, confirmParty, proceedToPayment, pushToast } = useApp();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!draft) return <EmptyCard />;

  const isRegional = cardLang === 'regional';
  const scenario = scenarioFor(draft.langCode);
  const L = isRegional ? scenario.labels : null;

  const startEdit = () => {
    setForm({
      service: draft.service,
      total: String(draft.total),
      advance: String(draft.advance),
      dueDate: draft.dueDate,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const total = Math.max(1, Number(form.total) || draft.total);
      const advance = Math.min(total, Math.max(0, Number(form.advance) || 0));
      await editTerms(draft.id, {
        service: form.service.trim() || draft.service,
        total,
        advance,
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(form.dueDate) ? form.dueDate : draft.dueDate,
      });
      setEditing(false);
      pushToast('Terms updated. Please re-confirm.');
    } catch (err) {
      pushToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm(null);
  };

  const onConfirm = async (party) => {
    if (draft.confirmations[party].confirmed) return;
    try {
      await confirmParty(draft.id, party);
    } catch (err) {
      pushToast(err.message);
    }
  };

  const bothConfirmed = draft.confirmations.contractor.confirmed && draft.confirmations.customer.confirmed;
  const editBalance = form ? Math.max(0, (Number(form.total) || 0) - (Number(form.advance) || 0)) : null;

  const bilingualText = isRegional
    ? `${draft.service} — Total ${formatINR(draft.total)} (${formatINR(draft.advance)} advance, ${formatINR(draft.balance)} balance).`
    : `${draft.serviceRegional} — ${scenario.labels.total} ${formatINR(draft.total)} (${formatINR(draft.advance)} ${scenario.labels.advance}, ${formatINR(draft.balance)} ${scenario.labels.balance}).`;

  return (
    <div className="flex-1 flex flex-col justify-between screen-animate">
      <div className="space-y-5">
        {/* Language toggle + edit button */}
        <div className="flex items-center justify-between">
          <div className="inline-flex p-0.5 rounded-lg bg-[#121215] border border-[#27272A]">
            <button
              onClick={() => setCardLang('en')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                !isRegional ? 'bg-white text-[#09090B]' : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              English
            </button>
            <button
              onClick={() => setCardLang('regional')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                isRegional ? 'bg-white text-[#09090B]' : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              {scenario.label}
            </button>
          </div>

          <button
            onClick={() => (editing ? cancelEdit() : startEdit())}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121215] border border-[#27272A] hover:border-zinc-500 text-xs font-medium text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-[#A1A1AA]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            <span>{editing ? 'Editing...' : 'Edit Terms'}</span>
          </button>
        </div>

        {/* Parties */}
        <section className="bg-[#121215] border border-[#27272A] rounded-2xl p-5 space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA]">Parties</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PartyCard
              label="Provider"
              name={profile?.name || profile?.business || 'You'}
              role="Service Provider"
            />
            <PartyCard
              label="Client"
              name={draft.customerName || 'Customer'}
              role="Client"
            />
          </div>
        </section>

        {/* Agreement card */}
        <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-5 space-y-5">
          <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#27272A]">
            <div className="flex-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#A1A1AA]">
                {L ? L.service : 'Service Description'}
              </span>
              {editing ? (
                <input
                  value={form.service}
                  onChange={(e) => setForm({ ...form, service: e.target.value })}
                  className="mt-1.5 w-full bg-[#09090B] border border-[#27272A] focus:border-white rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                />
              ) : (
                <h2 className="text-base font-semibold text-white mt-1">
                  {isRegional ? draft.serviceRegional : draft.service}
                </h2>
              )}
            </div>
            <span className="shrink-0 px-2 py-0.5 rounded-md bg-[#09090B] border border-[#27272A] text-[10px] font-mono text-[#A1A1AA]">
              #{draft.id}
            </span>
          </div>

          {/* Financial grid */}
          <div className="grid grid-cols-3 gap-3">
            <MoneyCell label={L ? L.total : 'Total'} value={formatINR(editing ? form.total : draft.total)} editing={editing} inputId="total" form={form} setForm={setForm} />
            <MoneyCell label={L ? L.advance : 'Advance'} value={formatINR(editing ? form.advance : draft.advance)} editing={editing} inputId="advance" form={form} setForm={setForm} />
            <div className="bg-[#09090B] border border-[#27272A] rounded-xl p-3.5">
              <span className="block text-[10px] font-medium text-[#A1A1AA]">{L ? L.balance : 'Balance'}</span>
              <div className="text-base font-bold text-[#A1A1AA] mt-1">
                {editing ? formatINR(editBalance) : formatINR(draft.balance)}
              </div>
            </div>
          </div>

          {/* Payment condition */}
          <div className="pt-1">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-[#A1A1AA]">
              {L ? L.condition : 'Payment Condition'}
            </span>
            <p className="text-xs leading-relaxed text-zinc-200 mt-1.5">
              {L ? L.conditionText(formatINR(draft.advance), formatINR(draft.balance)) : draft.condition}
            </p>
          </div>

          {/* Due date row */}
          <div className="pt-4 border-t border-[#27272A] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-[#A1A1AA] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                <line x1="16" x2="16" y1="2" y2="6" />
                <line x1="8" x2="8" y1="2" y2="6" />
                <line x1="3" x2="21" y1="10" y2="10" />
              </svg>
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-[#A1A1AA]">Balance Due Date</span>
                <div className="text-xs font-semibold text-white mt-0.5">
                  {formatShortDate(draft.dueDate, { withYear: true })} • Alarm {formatTime12h(draft.reminderTime)}
                </div>
              </div>
            </div>
            {editing && (
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="bg-[#09090B] border border-[#27272A] focus:border-white rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
              />
            )}
          </div>

          {/* Bilingual reference */}
          <div className="bg-[#09090B] border border-[#27272A] rounded-xl p-3.5">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-[#A1A1AA] mb-1.5">Bilingual Reference</span>
            <p className="text-xs leading-relaxed text-zinc-300">{bilingualText}</p>
          </div>

          {/* Edit actions */}
          {editing && (
            <div className="flex items-center gap-2.5 pt-1">
              <button
                onClick={saveEdit}
                disabled={busy}
                className="flex-1 py-2.5 px-4 rounded-xl bg-white text-[#09090B] text-xs font-semibold hover:bg-zinc-200 active:scale-[0.99] transition-all disabled:opacity-40"
              >
                {busy ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={cancelEdit}
                className="flex-1 py-2.5 px-4 rounded-xl bg-[#09090B] border border-[#27272A] hover:border-zinc-500 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Dual verification */}
        <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA]">Dual Verification</span>
            <span className="px-2 py-0.5 rounded-full bg-[#09090B] border border-[#27272A] text-[10px] font-semibold text-zinc-300">
              {(draft.confirmations.contractor.confirmed ? 1 : 0) + (draft.confirmations.customer.confirmed ? 1 : 0)} / 2 Confirmed
            </span>
          </div>

          <ConfirmRow
            title="Contractor (You)"
            sub={draft.confirmations.contractor}
            disabled={editing}
            onConfirm={() => onConfirm('contractor')}
          />
          <ConfirmRow
            title="Customer"
            sub={draft.confirmations.customer}
            disabled={editing}
            onConfirm={() => onConfirm('customer')}
          />

          <p className={`text-center text-[11px] ${bothConfirmed ? 'text-white' : 'text-[#A1A1AA]'}`}>
            {bothConfirmed
              ? 'Both parties verified. Ready to generate payment link.'
              : 'Both parties must confirm terms to unlock payment.'}
          </p>
        </div>
      </div>

      {/* Proceed CTA */}
      <div className="mt-8 pt-2">
        <button
          onClick={proceedToPayment}
          disabled={!bothConfirmed}
          className="w-full py-3.5 px-5 rounded-xl bg-white text-[#09090B] font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-zinc-200 active:scale-[0.99] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Proceed to Cashfree Payment
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function PartyCard({ label, name, role }) {
  return (
    <div className="rounded-xl border border-[#3F3F46] bg-[#09090B] p-4">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#A1A1AA]">{label}</span>
      <p className="mt-1 text-base font-semibold text-white">{name}</p>
      <p className="text-sm text-[#A1A1AA]">{role}</p>
    </div>
  );
}

function MoneyCell({ label, value, editing, inputId, form, setForm }) {
  return (
    <div className="bg-[#09090B] border border-[#27272A] rounded-xl p-3.5">
      <span className="block text-[10px] font-medium text-[#A1A1AA]">{label}</span>
      {editing ? (
        <input
          type="number"
          min={inputId === 'total' ? 1 : 0}
          value={form[inputId]}
          onChange={(e) => setForm({ ...form, [inputId]: e.target.value })}
          className="mt-1 w-full bg-[#121215] border border-[#27272A] focus:border-white rounded-md px-2 py-1 text-sm font-semibold text-white focus:outline-none"
        />
      ) : (
        <div className="text-base font-bold text-white mt-1">{value}</div>
      )}
    </div>
  );
}

function ConfirmRow({ title, sub, disabled, onConfirm }) {
  if (sub.confirmed) {
    return (
      <div className="flex items-center justify-between gap-3 bg-[#09090B] border border-white/40 rounded-xl p-3.5 transition-colors">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-white">{title}</div>
          <div className="text-xs text-white mt-0.5">{sub.at || 'Verified'}</div>
        </div>
        <span className="shrink-0 px-3 py-1.5 rounded-xl bg-white/10 border border-white/25 text-xs font-semibold cursor-default inline-flex items-center gap-1 text-white">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Verified
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 bg-[#09090B] border border-[#27272A] rounded-xl p-3.5 transition-colors">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-white">{title}</div>
        <div className="text-xs text-[#A1A1AA] mt-0.5">Pending verification</div>
      </div>
      <button
        onClick={onConfirm}
        disabled={disabled}
        className="shrink-0 px-3.5 py-2 rounded-xl bg-[#09090B] border border-[#27272A] hover:border-white text-xs font-medium text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Tap to Confirm
      </button>
    </div>
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
