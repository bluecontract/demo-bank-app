import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BrowserRouter } from 'react-router-dom';
import { DashboardHeader } from './DashboardHeader';

const mockSignOut = vi.fn();

vi.mock('../../../app/providers/AuthProvider', () => ({
  useAuth: () => ({
    signOut: mockSignOut,
  }),
}));

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe('DashboardHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render app name correctly', () => {
    renderWithRouter(<DashboardHeader userName="John Doe" />);

    expect(screen.getByText('Demo Bank')).toBeInTheDocument();
  });

  it('should render user name correctly', () => {
    renderWithRouter(<DashboardHeader userName="John Doe" />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('should render welcome message', () => {
    renderWithRouter(<DashboardHeader userName="John Doe" />);

    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('should have proper layout structure', () => {
    renderWithRouter(
      <DashboardHeader userName="John Doe" data-testid="dashboard-header" />
    );

    const header = screen.getByTestId('dashboard-header');
    expect(header).toBeInTheDocument();
    expect(header).toHaveClass('flex', 'justify-between', 'items-center');
  });
});
