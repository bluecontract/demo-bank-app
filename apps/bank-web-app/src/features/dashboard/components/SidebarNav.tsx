import { NavLink } from 'react-router-dom';
import { useContractsBadgeCount } from '../../contracts/hooks';
import {
  CardsIcon,
  ContractsIcon,
  OverviewIcon,
  TransactionsIcon,
} from './SidebarNavIcons';

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
    icon: <TransactionsIcon />,
  },
  {
    label: 'Contracts',
    to: '/contracts',
    icon: <ContractsIcon />,
  },
];

export function SidebarNav() {
  const newCount = useContractsBadgeCount();

  return (
    <aside className="hidden h-screen w-[240px] shrink-0 flex-col gap-8 border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 lg:flex">
      <div className="flex items-center gap-2">
        <div className="grid size-14 place-items-center rounded-full bg-[color:var(--color-primary)] text-base font-extrabold leading-6 text-white">
          DB
        </div>
        <p className="text-base font-bold uppercase tracking-[0.01em] text-[color:var(--color-muted)]">
          DEMO BANK
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
                `flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-base font-semibold leading-6 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)] ${
                  isActive
                    ? 'bg-[color:var(--color-primary)] text-white'
                    : 'border border-[color:var(--color-border)] text-[color:var(--color-ink)] hover:bg-slate-50'
                }`
              }
            >
              <span className="grid size-6 place-items-center text-current">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">{item.label}</span>
              {isContracts && newCount > 0 && (
                <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded bg-[#d32f2f] px-1.5 text-xs font-normal leading-4 text-white">
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
