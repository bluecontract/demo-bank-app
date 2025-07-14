import { render, screen } from '@testing-library/react';
import { Spinner, SpinnerWithText } from './Spinner';

describe('Spinner', () => {
  it('should render with default props', () => {
    render(<Spinner data-testid="spinner" />);

    const spinner = screen.getByTestId('spinner');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass('animate-spin', 'rounded-full', 'border-2');
    expect(spinner).toHaveClass('w-6', 'h-6'); // md size
    expect(spinner).toHaveClass('border-white/30', 'border-t-white'); // white color
  });

  it('should render with custom size', () => {
    render(<Spinner size="xl" data-testid="spinner" />);

    const spinner = screen.getByTestId('spinner');
    expect(spinner).toHaveClass('w-12', 'h-12');
  });

  it('should render with custom color', () => {
    render(<Spinner color="green" data-testid="spinner" />);

    const spinner = screen.getByTestId('spinner');
    expect(spinner).toHaveClass('border-green-200', 'border-t-green-600');
  });

  it('should render with custom className', () => {
    render(<Spinner className="custom-class" data-testid="spinner" />);

    const spinner = screen.getByTestId('spinner');
    expect(spinner).toHaveClass('custom-class');
  });

  it('should have accessibility attributes', () => {
    render(<Spinner data-testid="spinner" />);

    const spinner = screen.getByTestId('spinner');
    expect(spinner).toHaveAttribute('role', 'status');
    expect(spinner).toHaveAttribute('aria-label', 'Loading');
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should render all size variants correctly', () => {
    const sizes = ['sm', 'md', 'lg', 'xl'] as const;
    const expectedClasses = ['w-4 h-4', 'w-6 h-6', 'w-8 h-8', 'w-12 h-12'];

    sizes.forEach((size, index) => {
      render(<Spinner size={size} data-testid={`spinner-${size}`} />);

      const spinner = screen.getByTestId(`spinner-${size}`);
      expectedClasses[index].split(' ').forEach(className => {
        expect(spinner).toHaveClass(className);
      });
    });
  });

  it('should render all color variants correctly', () => {
    const colors = ['white', 'green', 'blue', 'gray'] as const;
    const expectedClasses = [
      'border-white/30 border-t-white',
      'border-green-200 border-t-green-600',
      'border-blue-200 border-t-blue-600',
      'border-gray-200 border-t-gray-600',
    ];

    colors.forEach((color, index) => {
      render(<Spinner color={color} data-testid={`spinner-${color}`} />);

      const spinner = screen.getByTestId(`spinner-${color}`);
      expectedClasses[index].split(' ').forEach(className => {
        expect(spinner).toHaveClass(className);
      });
    });
  });
});

describe('SpinnerWithText', () => {
  it('should render with default props', () => {
    render(<SpinnerWithText data-testid="spinner-with-text" />);

    const container = screen.getByTestId('spinner-with-text');
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass(
      'flex',
      'flex-col',
      'items-center',
      'space-y-4'
    );
    expect(screen.getAllByText('Loading...')).toHaveLength(2); // One in sr-only, one visible
  });

  it('should render with custom text', () => {
    render(
      <SpinnerWithText
        text="Custom loading message"
        data-testid="spinner-with-text"
      />
    );

    expect(screen.getByText('Custom loading message')).toBeInTheDocument();
  });

  it('should render with custom text className', () => {
    render(
      <SpinnerWithText
        text="Custom text"
        textClassName="text-blue-500 text-lg"
        data-testid="spinner-with-text"
      />
    );

    const textElement = screen.getByText('Custom text');
    expect(textElement).toHaveClass('text-blue-500', 'text-lg');
  });

  it('should render with custom container className', () => {
    render(
      <SpinnerWithText
        className="custom-container"
        data-testid="spinner-with-text"
      />
    );

    const container = screen.getByTestId('spinner-with-text');
    expect(container).toHaveClass('custom-container');
  });

  it('should pass through spinner props correctly', () => {
    render(
      <SpinnerWithText
        size="xl"
        color="green"
        data-testid="spinner-with-text"
      />
    );

    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('w-12', 'h-12'); // xl size
    expect(spinner).toHaveClass('border-green-200', 'border-t-green-600'); // green color
  });
});
