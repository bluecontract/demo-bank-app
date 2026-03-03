import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { SidebarNav } from './SidebarNav';
import { useContractsBadgeCount } from '../../contracts/hooks';

vi.mock('../../contracts/hooks', () => ({
  useContractsBadgeCount: vi.fn(),
}));

const mockUseContractsBadgeCount = useContractsBadgeCount as ReturnType<
  typeof vi.fn
>;

const renderSidebar = (initialEntry = '/dashboard') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SidebarNav />
    </MemoryRouter>
  );

describe('SidebarNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseContractsBadgeCount.mockReturnValue(0);
  });

  it('renders the expected navigation items', () => {
    mockUseContractsBadgeCount.mockReturnValue(0);

    renderSidebar('/dashboard');

    expect(screen.getByText('DEMO BANK')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cards' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Transactions' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contracts' })).toBeInTheDocument();
  });

  it('shows a numeric badge when there are unreviewed contract updates', () => {
    mockUseContractsBadgeCount.mockReturnValue(2);

    renderSidebar('/cards');

    const contractsLink = screen.getByRole('link', { name: /Contracts/ });
    expect(within(contractsLink).getByText('2')).toBeInTheDocument();
  });
});
