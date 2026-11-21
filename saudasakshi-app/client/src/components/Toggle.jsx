export default function Toggle({ checked, onChange, size = 'md', label }) {
  const track = size === 'sm' ? 'w-10 h-5 p-0.5' : 'w-11 h-6 p-0.5';
  const knob = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`${track} rounded-full ${checked ? 'bg-white justify-end' : 'bg-[#27272A] justify-start'} transition-colors flex items-center shrink-0`}
    >
      <span className={`${knob} rounded-full ${checked ? 'bg-[#09090B]' : 'bg-white'} shadow-sm block transition-colors`} />
    </button>
  );
}
