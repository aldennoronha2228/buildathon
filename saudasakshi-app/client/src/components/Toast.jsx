import { useApp } from '../state/store.jsx';

export default function Toast() {
  const { toasts } = useApp();
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="px-4 py-2 rounded-full bg-[#18181B] border border-[#27272A] text-xs font-medium text-white shadow-xl whitespace-nowrap screen-animate"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
