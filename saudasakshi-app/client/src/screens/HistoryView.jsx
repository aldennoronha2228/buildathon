import { useMemo, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { formatINR } from '../lib/format.js';
import StatusBadge from '../components/StatusBadge.jsx';

const FILTERS = ['ALL', 'ADVANCE_PAID', 'PENDING', 'COMPLETED'];

export default function HistoryView() {
  const { agreements, setDetailId } = useApp();
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agreements.filter((a) => {
      const matchFilter = filter === 'ALL' || a.status === filter;
      const matchQuery =
        !q ||
        a.service.toLowerCase().includes(q) ||
        a.customerName.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q);
      return matchFilter && matchQuery;
    });
  }, [agreements, filter, query]);

  return (
    <div className="flex-1 flex flex-col screen-animate">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-white">Agreement History</h1>
        <p className="text-xs text-[#A1A1AA] mt-1">All voice-verified contracts and Cashfree payment links.</p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <svg
          className="w-4 h-4 text-[#A1A1AA] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by customer or service..."
          className="w-full bg-[#121215] border border-[#27272A] focus:border-zinc-500 rounded-xl pl-10 pr-4 py-3 text-xs text-white placeholder-zinc-500 focus:outline-none transition-colors"
        />
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2.5 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-white text-[#09090B]'
                : 'bg-[#121215] border border-[#27272A] text-[#A1A1AA] hover:text-white'
            }`}
          >
            {f === 'ALL' ? 'All' : f === 'ADVANCE_PAID' ? 'Paid' : f === 'PENDING' ? 'Pending' : 'Completed'}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3.5 flex-1 pb-6">
        {filtered.length === 0 ? (
          <div className="bg-[#121215] border border-[#27272A] rounded-2xl p-8 text-center">
            <p className="text-sm font-medium text-white">No agreements found</p>
            <p className="text-xs text-[#A1A1AA] mt-1">Try adjusting your search or filter.</p>
          </div>
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => setDetailId(item.id)}
              className="w-full text-left bg-[#121215] border border-[#27272A] hover:border-zinc-500 rounded-2xl p-4 transition-all active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{item.service}</div>
                  <div className="flex items-center gap-1.5 text-xs text-[#A1A1AA] mt-0.5 flex-wrap">
                    <span>{item.customerName}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#09090B] border border-[#27272A] text-[10px] font-medium text-zinc-300">
                      {item.language.split(' ')[0]}
                    </span>
                  </div>
                </div>
                <div className="shrink-0">
                  <StatusBadge status={item.status} />
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[#27272A] flex items-center justify-between text-xs">
                <div>
                  <span className="text-[#A1A1AA]">Total: </span>
                  <span className="font-semibold text-white">{formatINR(item.total)}</span>
                </div>
                <div>
                  {item.status === 'COMPLETED' ? (
                    <span className="text-white font-medium">Fully Settled</span>
                  ) : (
                    <>
                      <span className="text-[#A1A1AA]">Balance: </span>
                      <span className="font-semibold text-zinc-200">{formatINR(item.balance)}</span>
                    </>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
