export default function StatusBadge({ status }) {
  if (status === 'ADVANCE_PAID') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/10 text-white border border-white/20">
        Advance Paid
      </span>
    );
  }
  if (status === 'COMPLETED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white text-[#09090B]">
        Completed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-transparent text-zinc-400 border border-[#3F3F46]">
      Pending
    </span>
  );
}
