import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AddAccountCard } from './AddAccountCard';

describe('AddAccountCard', () => {
  it('should render add account card correctly', () => {
    render(<AddAccountCard />);

    expect(screen.getByText('Add new account')).toBeInTheDocument();
  });

  it('should render plus icon', () => {
    render(<AddAccountCard />);

    expect(screen.getByText('+')).toBeInTheDocument();
  });

  it('should have dashed border styling', () => {
    render(<AddAccountCard data-testid="add-account-card" />);

    const card = screen.getByTestId('add-account-card');
    expect(card).toHaveClass('border-dashed');
  });

  it('should handle click events', () => {
    const handleClick = vi.fn();
    render(<AddAccountCard onClick={handleClick} />);

    const card = screen.getByRole('button');
    card.click();

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should have hover effects when clickable', () => {
    const handleClick = vi.fn();
    render(
      <AddAccountCard onClick={handleClick} data-testid="add-account-card" />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveClass('cursor-pointer');
  });

  it('should display loading state', () => {
    render(<AddAccountCard isLoading={true} />);

    expect(screen.getByText('Creating...')).toBeInTheDocument();
  });

  it('should be disabled when loading', () => {
    render(<AddAccountCard isLoading={true} />);

    const card = screen.getByRole('button');
    expect(card).toBeDisabled();
  });

  it('should have proper accessibility attributes', () => {
    render(<AddAccountCard />);

    const card = screen.getByRole('button');
    expect(card).toHaveAttribute('aria-label', 'Add new account');
  });
});
