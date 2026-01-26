import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('should render initials when name is provided', () => {
    render(<Avatar name="Alice Johnson" />);

    expect(screen.getByText('AJ')).toBeInTheDocument();
  });

  it('should render single initial for single name', () => {
    render(<Avatar name="Alice" />);

    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('should render image when src is provided', () => {
    render(<Avatar name="Alice" src="/avatar.jpg" />);

    const image = screen.getByRole('img');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', '/avatar.jpg');
    expect(image).toHaveAttribute('alt', 'Alice');
  });

  it('should fallback to initials when image fails to load', async () => {
    render(<Avatar name="Alice" src="/invalid.jpg" />);

    const image = screen.getByRole('img');
    expect(image).toBeInTheDocument();

    // Trigger image load error
    image.dispatchEvent(new Event('error'));

    // Wait for the state to update and re-render
    await screen.findByText('A');
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('should apply default size styling', () => {
    render(<Avatar name="Alice" data-testid="avatar" />);

    const avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveClass('w-10', 'h-10');
  });

  it('should apply small size styling', () => {
    render(<Avatar name="Alice" size="sm" data-testid="avatar" />);

    const avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveClass('w-8', 'h-8');
  });

  it('should apply large size styling', () => {
    render(<Avatar name="Alice" size="lg" data-testid="avatar" />);

    const avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveClass('w-12', 'h-12');
  });

  it('should apply additional className when provided', () => {
    render(
      <Avatar name="Alice" className="custom-class" data-testid="avatar" />
    );

    const avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveClass('custom-class');
  });

  it('should apply default background color', () => {
    render(<Avatar name="Alice" data-testid="avatar" />);

    const avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveClass('bg-gradient-to-br');
  });

  it('should handle empty name gracefully', () => {
    render(<Avatar name="" data-testid="avatar" />);

    const avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveClass('bg-gray-400');
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('should handle very long names', () => {
    render(<Avatar name="Alice Van Der Berg Johnson" />);

    expect(screen.getByText('AV')).toBeInTheDocument();
  });
});
