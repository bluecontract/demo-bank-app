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
    renderWithRouter(<DashboardHeader userEmail="john.doe@example.com" />);

    expect(screen.getByText('Demo Bank')).toBeInTheDocument();
  });

  it('should render user name correctly', () => {
    renderWithRouter(<DashboardHeader userEmail="john.doe@example.com" />);

    expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
  });

  it('should render user avatar with correct initials', () => {
    renderWithRouter(<DashboardHeader userEmail="alice.johnson@example.com" />);

    expect(screen.getByText('AJ')).toBeInTheDocument();
  });

  it('should render welcome message', () => {
    renderWithRouter(<DashboardHeader userEmail="john.doe@example.com" />);

    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('should have proper layout structure', () => {
    renderWithRouter(
      <DashboardHeader
        userEmail="john.doe@example.com"
        data-testid="dashboard-header"
      />
    );

    const header = screen.getByTestId('dashboard-header');
    expect(header).toBeInTheDocument();
    expect(header).toHaveClass('flex', 'gap-6');
  });

  it('should render avatar when user name is provided', () => {
    renderWithRouter(<DashboardHeader userEmail="jane.smith@example.com" />);

    const avatar = screen.getByText('JS');
    expect(avatar).toBeInTheDocument();
  });

  it('should handle single name correctly', () => {
    renderWithRouter(<DashboardHeader userEmail="alice@example.com" />);

    expect(screen.getByText('AE')).toBeInTheDocument();
  });

  it('should handle long user names', () => {
    renderWithRouter(
      <DashboardHeader userEmail="alexander.vonderberg@example.com" />
    );

    expect(screen.getByText('AV')).toBeInTheDocument();
  });

  it('should show dropdown menu when avatar is clicked', () => {
    renderWithRouter(<DashboardHeader userEmail="john.doe@example.com" />);

    const avatar = screen.getByText('JD');
    fireEvent.click(avatar);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Sign Out' })
    ).toBeInTheDocument();
  });

  it('should call signOut when Sign Out is clicked', () => {
    renderWithRouter(<DashboardHeader userEmail="john.doe@example.com" />);

    const avatar = screen.getByText('JD');
    fireEvent.click(avatar);

    const signOutButton = screen.getByRole('menuitem', { name: 'Sign Out' });
    fireEvent.click(signOutButton);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('should hide dropdown when clicking outside', () => {
    renderWithRouter(
      <div>
        <DashboardHeader userEmail="john.doe@example.com" />
        <div data-testid="outside">Outside element</div>
      </div>
    );

    const avatar = screen.getByText('JD');
    fireEvent.click(avatar);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
