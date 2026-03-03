import type { ReactNode } from 'react';
import { SidebarNav } from './SidebarNav';
import { MobileNav } from './MobileNav';

interface DashboardShellProps {
  header: ReactNode;
  children: ReactNode;
  contentWidth?: 'constrained' | 'full';
  'data-testid'?: string;
}

export function DashboardShell({
  header,
  children,
  contentWidth = 'constrained',
  'data-testid': testId,
}: DashboardShellProps) {
  const contentContainerClassName =
    contentWidth === 'full' ? 'w-full' : 'mx-auto w-full max-w-[1152px]';

  return (
    <div className="app-shell flex w-full overflow-x-clip" data-testid={testId}>
      <SidebarNav />

      <div className="min-w-0 flex-1 flex flex-col min-h-screen">
        <MobileNav />
        <div className="px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6 lg:px-6">
          <div className={contentContainerClassName}>{header}</div>
        </div>

        <main className="min-w-0 flex-1 px-4 pb-6 sm:px-6 sm:pb-8 lg:px-6">
          <div
            className={`${contentContainerClassName} flex min-h-0 flex-col gap-4 sm:gap-6`}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
