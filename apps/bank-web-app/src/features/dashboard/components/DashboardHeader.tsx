import { useAuth } from '../../../app/providers/AuthProvider';

interface DashboardHeaderProps {
  userEmail: string;
  title?: string;
  description?: string | null;
  'data-testid'?: string;
}

export function DashboardHeader({
  userEmail,
  title,
  description,
  'data-testid': testId,
}: DashboardHeaderProps) {
  const { signOut } = useAuth();
  const resolvedDescription = description ?? null;
  const shouldRenderDescription = resolvedDescription !== null;

  return (
    <header
      className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between"
      data-testid={testId}
    >
      <div className="min-w-0">
        <h1 className="text-[32px] font-extrabold leading-10 text-[color:var(--color-ink)]">
          {title ?? 'Overview'}
        </h1>
        {shouldRenderDescription && (
          <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
            {resolvedDescription}
          </p>
        )}
      </div>

      <div className="hidden items-center gap-2 lg:flex">
        <span className="text-base leading-6 text-[color:var(--color-ink)]">
          {userEmail}
        </span>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex h-9 w-9 items-center justify-center text-[color:var(--color-muted)] transition hover:text-[color:var(--color-ink)]"
          aria-label="Sign out"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 2.5V9m6.364-2.364A9 9 0 105.636 6.636"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
