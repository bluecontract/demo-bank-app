import type { ReactNode } from 'react';
import { SidebarNav } from './SidebarNav';
import { MobileNav } from './MobileNav';

interface DashboardShellProps {
  header: ReactNode;
  children: ReactNode;
  'data-testid'?: string;
}

export function DashboardShell({
  header,
  children,
  'data-testid': testId,
}: DashboardShellProps) {
  return (
    <div className="app-shell flex" data-testid={testId}>
      <SidebarNav />

      <div className="flex-1 flex flex-col min-h-screen">
        <MobileNav />
        <div className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 lg:px-10">
          {header}
        </div>

        <main className="flex-1 px-4 pb-6 sm:px-6 sm:pb-8 lg:px-10 flex flex-col gap-4 sm:gap-6 min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}
