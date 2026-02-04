import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { SidebarNav } from './SidebarNav';
import {
  useActiveContractSession,
  useContractReviewState,
  useContracts,
  useProposals,
} from '../../contracts/hooks';

vi.mock('../../contracts/hooks', () => ({
  useContracts: vi.fn(),
  useProposals: vi.fn(),
  useContractReviewState: vi.fn(),
  useActiveContractSession: vi.fn(),
}));

const mockUseContracts = useContracts as ReturnType<typeof vi.fn>;
const mockUseProposals = useProposals as ReturnType<typeof vi.fn>;
const mockUseContractReviewState = useContractReviewState as ReturnType<
  typeof vi.fn
>;
const mockUseActiveContractSession = useActiveContractSession as ReturnType<
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
    mockUseContractReviewState.mockReturnValue({ reviewedMap: {} });
    mockUseActiveContractSession.mockReturnValue({
      activeSessionId: undefined,
    });
    mockUseProposals.mockReturnValue({ data: [] });
  });

  it('renders the expected navigation items', () => {
    mockUseContracts.mockReturnValue({ data: [] });

    renderSidebar('/dashboard');

    expect(screen.getByText('Demo Bank')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cards' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Transactions' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contracts' })).toBeInTheDocument();
  });

  it('shows a numeric badge when there are unreviewed contract updates', () => {
    mockUseContracts.mockReturnValue({
      data: [
        {
          contractId: 'contract-1',
          typeBlueId: 'type-blue-1',
          displayName: 'Contract',
          sessionId: 'session-1',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
        {
          contractId: 'contract-2',
          typeBlueId: 'type-blue-2',
          displayName: 'Contract',
          sessionId: 'session-2',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
      ],
    });

    renderSidebar('/cards');

    const contractsLink = screen.getByRole('link', { name: /Contracts/ });
    expect(within(contractsLink).getByText('2')).toBeInTheDocument();
  });
});
