import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from './Button';

describe('Button', () => {
  it('should render children correctly', () => {
    render(<Button>Click me</Button>);

    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('should apply default primary variant styling', () => {
    render(<Button data-testid="button">Primary Button</Button>);

    const button = screen.getByTestId('button');
    expect(button).toHaveClass(
      'bg-green-600',
      'text-white',
      'hover:bg-green-700'
    );
  });

  it('should apply secondary variant styling', () => {
    render(
      <Button variant="secondary" data-testid="button">
        Secondary Button
      </Button>
    );

    const button = screen.getByTestId('button');
    expect(button).toHaveClass(
      'bg-gray-200',
      'text-gray-900',
      'hover:bg-gray-300'
    );
  });

  it('should apply outline variant styling', () => {
    render(
      <Button variant="outline" data-testid="button">
        Outline Button
      </Button>
    );

    const button = screen.getByTestId('button');
    expect(button).toHaveClass(
      'border-2',
      'border-green-600',
      'text-green-600',
      'hover:bg-green-50'
    );
  });

  it('should apply additional className when provided', () => {
    render(
      <Button className="custom-class" data-testid="button">
        Button
      </Button>
    );

    const button = screen.getByTestId('button');
    expect(button).toHaveClass('custom-class');
  });

  it('should handle click events', () => {
    const handleClick = vi.fn();
    render(
      <Button onClick={handleClick} data-testid="button">
        Button
      </Button>
    );

    const button = screen.getByTestId('button');
    button.click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should be disabled when disabled prop is true', () => {
    render(
      <Button disabled data-testid="button">
        Disabled Button
      </Button>
    );

    const button = screen.getByTestId('button');
    expect(button).toBeDisabled();
    expect(button).toHaveClass('opacity-50', 'cursor-not-allowed');
  });

  it('should support different sizes', () => {
    render(
      <Button size="sm" data-testid="button">
        Small Button
      </Button>
    );

    const button = screen.getByTestId('button');
    expect(button).toHaveClass('px-3', 'py-1', 'text-sm');
  });

  it('should support large size', () => {
    render(
      <Button size="lg" data-testid="button">
        Large Button
      </Button>
    );

    const button = screen.getByTestId('button');
    expect(button).toHaveClass('px-8', 'py-3', 'text-lg');
  });

  it('should support fullWidth prop', () => {
    render(
      <Button fullWidth data-testid="button">
        Full Width Button
      </Button>
    );

    const button = screen.getByTestId('button');
    expect(button).toHaveClass('w-full');
  });
});
