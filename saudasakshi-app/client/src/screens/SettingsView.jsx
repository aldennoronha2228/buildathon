import { useEffect, useState } from 'react';
import { useApp } from '../state/store.jsx';
import Toggle from '../components/Toggle.jsx';

const EMPTY = {
  name: '',
  business: '',
  phone: '',
  city: '',
  upi: '',
  autoReceipt: true,
  autoDetectVoice: true,
  alwaysBilingual: true,
};

export default function SettingsView() {
  const { profile, saveSettings, pushToast, capabilities } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) setForm({ ...EMPTY, ...profile });
  }, [profile]);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const onSave = async () => {
    setSaving(true);
    try {
      await saveSettings(form);
      pushToast('Account & voice settings saved');
    } catch (err) {
      pushToast(err.message);
    } finally {
      setSaving(false);
    }
  };


  return (
    <div className="flex-1 flex flex-col screen-animate">
      <div className="space-y-6 pb-8">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Account &amp; Settings</h1>
          <p className="text-xs text-[#A1A1AA] mt-1">Manage your business profile, settlements, and voice preferences.</p>
        </div>

        {/* Business profile */}
        <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#27272A] pb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA]">Business Profile</span>
            
          </div>

          <Field label="Full Name" value={form.name} onChange={set('name')} />
          <Field label="Business / Trade Name" value={form.business} onChange={set('business')} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone Number" value={form.phone} onChange={set('phone')} small />
            <Field label="City" value={form.city} onChange={set('city')} small />
          </div>
        </div>

        {/* Settlements */}
        <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#27272A] pb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA]">Cashfree Settlements</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${capabilities?.cashfree ? 'bg-white/10 border-white/25 text-white' : 'border-[#3F3F46] text-zinc-400'}`}>
              {capabilities?.cashfree ? 'GATEWAY LIVE' : 'NOT CONNECTED'}
            </span>
          </div>

          <Field label="Connected UPI ID" value={form.upi} onChange={set('upi')} mono />

          <div className="flex items-center justify-between bg-[#09090B] border border-[#27272A] rounded-xl px-3.5 py-3">
            <div>
              <div className="text-xs font-medium text-white">Settlement Bank Account</div>
              <div className="text-[11px] font-mono text-[#A1A1AA] mt-0.5">No bank account connected</div>
            </div>
            <span className="text-[11px] font-medium text-white">Primary</span>
          </div>

          <SettingToggle
            title="Auto-send Payment Receipt"
            desc="Share verified receipt upon Cashfree confirmation"
            checked={form.autoReceipt}
            onChange={(v) => setForm({ ...form, autoReceipt: v })}
          />
        </div>

        {/* Voice settings */}
        <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#27272A] pb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA]">Voice AI</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${capabilities?.sarvamStt ? 'bg-white/10 border-white/25 text-white' : 'border-[#3F3F46] text-zinc-400'}`}>
              {capabilities?.sarvamStt ? 'Sarvam STT LIVE' : 'NOT CONNECTED'}
            </span>
          </div>

          <SettingToggle
            title="Auto-Detect Language"
            desc="Automatically detects Kannada, Hindi, Tamil, English & code-mixed speech"
            checked={form.autoDetectVoice}
            onChange={(v) => setForm({ ...form, autoDetectVoice: v })}
          />

          <div className="bg-[#09090B] border border-[#27272A] rounded-xl p-3">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-[#A1A1AA] mb-2">
              Supported Auto-Detect Languages
            </span>
            <div className="flex flex-wrap gap-1.5">
              {['ಕನ್ನಡ (Kannada)', 'हिंदी (Hindi)', 'தமிழ் (Tamil)', 'English (IN)', 'Code-Mixed'].map((l) => (
                <span
                  key={l}
                  className="px-2 py-0.5 rounded-md bg-[#121215] border border-[#27272A] text-[11px] text-zinc-200"
                >
                  {l}
                </span>
              ))}
            </div>
          </div>

          <SettingToggle
            title="Bilingual Agreement Output"
            desc="Display detected regional language + English summary together"
            checked={form.alwaysBilingual}
            onChange={(v) => setForm({ ...form, alwaysBilingual: v })}
          />
        </div>

        {/* Save + reset */}
        <button
          onClick={onSave}
          disabled={saving}
          className="w-full py-3.5 px-5 rounded-xl bg-white text-[#09090B] font-semibold text-sm hover:bg-zinc-200 active:scale-[0.99] transition-all disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>

      </div>
    </div>
  );
}

function Field({ label, value, onChange, mono = false, small = false }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-[#A1A1AA] mb-1">{label}</label>
      <input
        value={value}
        onChange={onChange}
        className={`w-full bg-[#09090B] border border-[#27272A] focus:border-white rounded-xl text-white focus:outline-none transition-colors ${
          mono ? 'font-mono' : ''
        } ${small ? 'px-3 py-2.5 text-xs' : 'px-3.5 py-2.5 text-sm'}`}
      />
    </div>
  );
}

function SettingToggle({ title, desc, checked, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <div className="pr-3">
        <div className="text-xs font-medium text-white">{title}</div>
        <div className="text-[11px] text-[#A1A1AA] mt-0.5">{desc}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}
