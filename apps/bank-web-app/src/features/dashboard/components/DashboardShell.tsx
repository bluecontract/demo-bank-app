import type { ReactNode } from 'react';
import { SidebarNav } from './SidebarNav';

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
        <div className="px-6 pt-8 pb-4 lg:px-10">{header}</div>

        <main className="flex-1 px-6 pb-8 lg:px-10 flex flex-col gap-6 min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}
