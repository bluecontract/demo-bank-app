import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../../app/providers/AuthProvider';
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

export function MobileNav() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const newCount = useContractsBadgeCount();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  const unreadBadge = useMemo(() => {
    if (newCount <= 0) {
      return null;
    }
    return (
      <span className="inline-flex min-w-6 items-center justify-center rounded bg-[#d32f2f] px-1.5 text-sm font-normal leading-6 text-white">
        {newCount}
      </span>
    );
  }, [newCount]);

  return (
    <>
      <div className="flex items-center justify-between gap-4 px-4 pb-2 pt-6 lg:hidden">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="grid size-14 shrink-0 place-items-center rounded-full bg-[color:var(--color-primary)] text-base font-extrabold leading-6 text-white">
            DB
          </div>
          <p className="truncate text-base font-bold uppercase tracking-[0.01em] text-[color:var(--color-muted)]">
            DEMO BANK
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadBadge}
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
            onClick={() => setIsOpen(true)}
            aria-label="Open menu"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-white lg:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex h-full flex-col gap-8 px-4 pb-6 pt-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="grid size-14 shrink-0 place-items-center rounded-full bg-[color:var(--color-primary)] text-base font-extrabold leading-6 text-white">
                  DB
                </div>
                <p className="truncate text-base font-bold uppercase tracking-[0.01em] text-[color:var(--color-muted)]">
                  DEMO BANK
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
                onClick={() => setIsOpen(false)}
                aria-label="Close menu"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
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
                      `flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-base font-semibold leading-6 transition ${
                        isActive
                          ? 'bg-[color:var(--color-primary)] text-white'
                          : 'border border-[color:var(--color-border)] text-[color:var(--color-ink)]'
                      }`
                    }
                  >
                    <span className="grid size-6 place-items-center text-current">
                      {item.icon}
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {isContracts && newCount > 0 && (
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-[#d32f2f] px-1.5 text-xs font-normal leading-4 text-white">
                        {newCount}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </nav>

            <div className="mt-auto flex items-center justify-end gap-2 text-sm text-slate-600">
              <span className="truncate text-base leading-6 text-[color:var(--color-ink)]">
                {user?.email || 'Guest'}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex h-9 w-9 items-center justify-center text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
                aria-label="Sign out"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 2.5V9m6.364-2.364A9 9 0 105.636 6.636"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
