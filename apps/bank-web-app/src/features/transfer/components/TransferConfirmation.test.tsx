import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { TransferConfirmation } from './TransferConfirmation';

describe('TransferConfirmation', () => {
  const mockOnHomeClick = vi.fn();

  const defaultProps = {
    onHomeClick: mockOnHomeClick,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders confirmation message', () => {
    render(<TransferConfirmation {...defaultProps} />);

    expect(screen.getByText('Transfer')).toBeInTheDocument();
    expect(screen.getByText('completed!')).toBeInTheDocument();
  });

  it('renders success illustration', () => {
    render(<TransferConfirmation {...defaultProps} />);

    expect(screen.getByTestId('success-illustration')).toBeInTheDocument();
  });

  it('renders home button with gradient styling', () => {
    render(<TransferConfirmation {...defaultProps} />);

    const homeButton = screen.getByRole('button', { name: /home/i });
    expect(homeButton).toBeInTheDocument();
    expect(homeButton).toHaveClass('bg-gradient-to-r');
  });

  it('calls onHomeClick when home button is clicked', () => {
    render(<TransferConfirmation {...defaultProps} />);

    const homeButton = screen.getByRole('button', { name: /home/i });
    fireEvent.click(homeButton);

    expect(mockOnHomeClick).toHaveBeenCalledTimes(1);
  });

  it('has centered layout', () => {
    render(<TransferConfirmation {...defaultProps} />);

    const container = screen.getByTestId('confirmation-container');
    expect(container).toHaveClass('text-center', 'space-y-6', 'p-6');
  });
});
