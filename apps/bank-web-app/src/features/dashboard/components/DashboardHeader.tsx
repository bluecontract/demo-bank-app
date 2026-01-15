import { Avatar } from '../../../ui/Avatar';
import { Dropdown, DropdownItem } from '../../../ui/Dropdown';
import { useAuth } from '../../../app/providers/AuthProvider';

interface DashboardHeaderProps {
  userEmail: string;
  title?: string;
  description?: string;
  'data-testid'?: string;
}

export function DashboardHeader({
  userEmail,
  title,
  description,
  'data-testid': testId,
}: DashboardHeaderProps) {
  const { signOut } = useAuth();

  const handleSignOut = () => {
    signOut();
  };

  return (
    <header
      className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"
      data-testid={testId}
    >
      <div>
        <p className="text-xs uppercase tracking-[0.35em] text-[color:var(--color-muted)]">
          Demo Bank
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">
          {title ?? 'Welcome back'}
        </h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          {description ??
            'Your personal overview for accounts, cards, and activity.'}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700">
          <span className="font-medium">{userEmail}</span>
        </div>

        <Dropdown trigger={<Avatar name={userEmail} size="lg" />} align="right">
          <DropdownItem
            onClick={handleSignOut}
            icon={
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            }
          >
            Sign Out
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
