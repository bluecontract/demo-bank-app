import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Card } from './Card';

describe('Card', () => {
  it('should render children correctly', () => {
    render(
      <Card>
        <div>Test Content</div>
      </Card>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should apply default styling', () => {
    render(
      <Card data-testid="card">
        <div>Content</div>
      </Card>
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('app-surface', 'p-6');
  });

  it('should apply additional className when provided', () => {
    render(
      <Card className="custom-class" data-testid="card">
        <div>Content</div>
      </Card>
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('custom-class');
  });

  it('should support gradient background variant', () => {
    render(
      <Card variant="gradient" data-testid="card">
        <div>Content</div>
      </Card>
    );

    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-[var(--color-primary)]');
  });

  it('should support dashed border variant', () => {
    render(
      <Card variant="dashed" data-testid="card">
        <div>Content</div>
      </Card>
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('border-2', 'border-dashed');
  });

  it('should handle click events', () => {
    const handleClick = vi.fn();
    render(
      <Card onClick={handleClick} data-testid="card">
        <div>Content</div>
      </Card>
    );

    const card = screen.getByTestId('card');
    card.click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should apply hover styles when clickable', () => {
    const handleClick = vi.fn();
    render(
      <Card onClick={handleClick} data-testid="card">
        <div>Content</div>
      </Card>
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('cursor-pointer', 'hover:-translate-y-1');
  });
});
