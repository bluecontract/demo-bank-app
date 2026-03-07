import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardShell } from './DashboardShell';

const useUnifiedPollChangesMock = vi.hoisted(() => vi.fn());

vi.mock('../../polling/useUnifiedPollChanges', () => ({
  useUnifiedPollChanges: useUnifiedPollChangesMock,
}));

vi.mock('./SidebarNav', () => ({
  SidebarNav: () => <div data-testid="sidebar-nav" />,
}));

vi.mock('./MobileNav', () => ({
  MobileNav: () => <div data-testid="mobile-nav" />,
}));

describe('DashboardShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts a single polling driver by mounting unified polling once', () => {
    render(
      <DashboardShell header={<div>Header</div>}>
        <div>Body</div>
      </DashboardShell>
    );

    expect(useUnifiedPollChangesMock).toHaveBeenCalledTimes(1);
    expect(useUnifiedPollChangesMock).toHaveBeenCalledWith({
      activityAccountNumber: null,
    });
  });

  it('forwards activity account context to unified polling', () => {
    render(
      <DashboardShell
        header={<div>Header</div>}
        pollingActivityAccountNumber="1234567890"
      >
        <div>Body</div>
      </DashboardShell>
    );

    expect(useUnifiedPollChangesMock).toHaveBeenCalledWith({
      activityAccountNumber: '1234567890',
    });
  });
});
