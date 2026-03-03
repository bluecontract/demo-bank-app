import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BrowserRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { DashboardHeader } from './DashboardHeader';
import { routerFutureConfig } from '../../../app/routerFutureConfig';

const mockSignOut = vi.fn();

vi.mock('../../../app/providers/AuthProvider', () => ({
  useAuth: () => ({
    signOut: mockSignOut,
  }),
}));

const renderWithRouter = (component: ReactElement) =>
  render(
    <BrowserRouter future={routerFutureConfig}>{component}</BrowserRouter>
  );

describe('DashboardHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders default title and description', () => {
    renderWithRouter(<DashboardHeader userEmail="john.doe@example.com" />);

    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your personal overview for accounts, cards, and activity.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    renderWithRouter(
      <DashboardHeader userEmail="john.doe@example.com" title="Contracts" />
    );

    expect(screen.getByText('Contracts')).toBeInTheDocument();
  });

  it('does not render description when set to null', () => {
    renderWithRouter(
      <DashboardHeader
        userEmail="john.doe@example.com"
        title="Contracts"
        description={null}
      />
    );

    expect(
      screen.queryByText(
        'Your personal overview for accounts, cards, and activity.'
      )
    ).not.toBeInTheDocument();
  });

  it('calls signOut from the desktop header action', () => {
    renderWithRouter(<DashboardHeader userEmail="john.doe@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
