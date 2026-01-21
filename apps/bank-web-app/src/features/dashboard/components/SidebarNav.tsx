import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useContracts, useContractReviewState } from '../../contracts/hooks';
import { dedupeContracts } from '../../contracts/lib/dedupeContracts';
import { getContractChangeType } from '../../contracts/lib/contractReview';

const navItems = [
  {
    label: 'Overview',
    to: '/dashboard',
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 21V9h6v12" />
      </svg>
    ),
  },
  {
    label: 'Cards',
    to: '/cards',
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18" />
      </svg>
    ),
  },
  {
    label: 'Transfers',
    to: '/transfer/new',
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 7h11M7 4l-3 3 3 3M20 17H9m8 3l3-3-3-3"
        />
      </svg>
    ),
  },
  {
    label: 'Contracts',
    to: '/contracts',
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
      </svg>
    ),
  },
];

export function SidebarNav() {
  const { reviewedMap } = useContractReviewState();
  const newContractsQuery = useContracts({ refetchInterval: 15000 });

  const newCount = useMemo(() => {
    if (!newContractsQuery.data) {
      return 0;
    }
    const deduped = dedupeContracts(newContractsQuery.data);
    return deduped.filter(contract =>
      getContractChangeType(contract, reviewedMap)
    ).length;
  }, [newContractsQuery.data, reviewedMap]);

  return (
    <aside className="hidden lg:flex w-64 flex-col px-6 py-8 border-r border-white/40 bg-white/70 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-[var(--color-primary)] text-white flex items-center justify-center text-lg font-semibold shadow-sm">
          DB
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-muted)]">
            Demo Bank
          </p>
          <p className="text-sm text-slate-600">Retail core</p>
        </div>
      </div>

      <nav className="mt-10 flex flex-col gap-1 text-sm">
        {navItems.map(item => {
          const isContracts = item.to === '/contracts';

          return (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === '/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 transition ${
                  isActive
                    ? 'bg-[rgba(43,190,156,0.12)] text-[color:var(--color-primary)]'
                    : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
                }`
              }
            >
              <span className="text-current">{item.icon}</span>
              <span className="font-medium flex-1">{item.label}</span>
              {isContracts && newCount > 0 && (
                <span className="app-chip">New {newCount}</span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto app-surface p-4 bg-white/80">
        <p className="text-xs text-[color:var(--color-muted)] uppercase tracking-[0.2em]">
          Status
        </p>
        <p className="mt-2 text-sm font-medium text-slate-700">
          All systems operational
        </p>
      </div>
    </aside>
  );
}
