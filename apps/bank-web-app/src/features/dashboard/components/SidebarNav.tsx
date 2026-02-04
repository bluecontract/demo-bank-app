import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  useContracts,
  useContractReviewState,
  useActiveContractSession,
  useProposals,
} from '../../contracts/hooks';
import { dedupeContracts } from '../../contracts/lib/dedupeContracts';
import { getContractChangeType } from '../../contracts/lib/contractReview';
import {
  isInboxContract,
  isImportantProposal,
} from '../../contracts/lib/contractListFilters';
import {
  mergeContractsAndProposals,
  isProposalItem,
} from '../../contracts/lib/contractsAndProposals';
import { CardsIcon, ContractsIcon, OverviewIcon } from './SidebarNavIcons';

const navItems = [
  {
    label: 'Overview',
    to: '/dashboard',
    icon: <OverviewIcon />,
  },
  {
    label: 'Cards',
    to: '/cards',
    icon: <CardsIcon />,
  },
  {
    label: 'Transactions',
    to: '/transactions',
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 12h10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 17h10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h.01" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h.01" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 17h.01" />
      </svg>
    ),
  },
  {
    label: 'Contracts',
    to: '/contracts',
    icon: <ContractsIcon />,
  },
];

export function SidebarNav() {
  const { reviewedMap } = useContractReviewState();
  const { activeSessionId } = useActiveContractSession();
  const newContractsQuery = useContracts({ refetchInterval: 5000 });
  const proposalsQuery = useProposals();

  const newCount = useMemo(() => {
    const contracts = newContractsQuery.data
      ? dedupeContracts(newContractsQuery.data)
      : [];
    const proposals = proposalsQuery.data ?? [];
    if (contracts.length === 0 && proposals.length === 0) {
      return 0;
    }
    const listItems = mergeContractsAndProposals(contracts, proposals);
    const inboxContracts = listItems.filter(isInboxContract);
    const inboxCount = inboxContracts.filter(contract => {
      if (activeSessionId && contract.sessionId === activeSessionId) {
        return false;
      }
      return Boolean(getContractChangeType(contract, reviewedMap));
    }).length;
    const importantCount = listItems.filter(
      item => isProposalItem(item) && isImportantProposal(item)
    ).length;
    return inboxCount + importantCount;
  }, [
    activeSessionId,
    newContractsQuery.data,
    proposalsQuery.data,
    reviewedMap,
  ]);

  return (
    <aside className="hidden lg:flex w-[240px] shrink-0 flex-col gap-8 border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
      <div className="flex items-center gap-2">
        <div className="grid size-14 place-items-center rounded-full bg-[var(--color-primary)] text-base font-semibold text-white">
          DB
        </div>
        <p className="text-base font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
          Demo Bank
        </p>
      </div>

      <nav className="flex flex-col gap-4">
        {navItems.map(item => {
          const isContracts = item.to === '/contracts';

          return (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === '/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-2xl px-4 py-3 text-base font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)] ${
                  isActive
                    ? 'bg-[color:var(--color-primary)] text-white'
                    : 'border border-[color:var(--color-border)] text-slate-900 hover:bg-slate-50'
                }`
              }
            >
              <span className="grid size-6 place-items-center p-0.5 text-current">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">{item.label}</span>
              {isContracts && newCount > 0 && (
                <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded bg-rose-500 px-2 text-xs font-semibold text-white">
                  {newCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
