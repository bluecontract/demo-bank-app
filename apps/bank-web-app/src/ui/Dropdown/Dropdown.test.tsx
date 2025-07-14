import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Dropdown, DropdownItem } from './Dropdown';

describe('Dropdown', () => {
  const mockOnClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render trigger element', () => {
    render(
      <Dropdown trigger={<span>Click me</span>}>
        <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
      </Dropdown>
    );

    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('should not show dropdown menu initially', () => {
    render(
      <Dropdown trigger={<span>Click me</span>}>
        <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
      </Dropdown>
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('should show dropdown menu when trigger is clicked', () => {
    render(
      <Dropdown trigger={<span>Click me</span>}>
        <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
      </Dropdown>
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Item 1' })
    ).toBeInTheDocument();
  });

  it('should hide dropdown menu when trigger is clicked again', () => {
    render(
      <Dropdown trigger={<span>Click me</span>}>
        <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
      </Dropdown>
    );

    const triggerButton = screen.getByRole('button');

    fireEvent.click(triggerButton);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.click(triggerButton);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('should hide dropdown when clicking outside', () => {
    render(
      <div>
        <Dropdown trigger={<span>Click me</span>}>
          <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
        </Dropdown>
        <div data-testid="outside">Outside element</div>
      </div>
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('should hide dropdown when pressing Escape key', () => {
    render(
      <Dropdown trigger={<span>Click me</span>}>
        <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
      </Dropdown>
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('should apply right alignment by default', () => {
    render(
      <Dropdown trigger={<span>Click me</span>}>
        <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
      </Dropdown>
    );

    fireEvent.click(screen.getByRole('button'));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveClass('right-0');
  });

  it('should apply left alignment when specified', () => {
    render(
      <Dropdown trigger={<span>Click me</span>} align="left">
        <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
      </Dropdown>
    );

    fireEvent.click(screen.getByRole('button'));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveClass('left-0');
  });

  it('should apply custom className', () => {
    render(
      <Dropdown trigger={<span>Click me</span>} className="custom-class">
        <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
      </Dropdown>
    );

    const container = screen.getByRole('button').parentElement;
    expect(container).toHaveClass('custom-class');
  });

  it('should set proper ARIA attributes', () => {
    render(
      <Dropdown trigger={<span>Click me</span>}>
        <DropdownItem onClick={mockOnClick}>Item 1</DropdownItem>
      </Dropdown>
    );

    const triggerButton = screen.getByRole('button');
    expect(triggerButton).toHaveAttribute('aria-expanded', 'false');
    expect(triggerButton).toHaveAttribute('aria-haspopup', 'true');

    fireEvent.click(triggerButton);
    expect(triggerButton).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('DropdownItem', () => {
  const mockOnClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render item text', () => {
    render(<DropdownItem onClick={mockOnClick}>Test Item</DropdownItem>);

    expect(
      screen.getByRole('menuitem', { name: 'Test Item' })
    ).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    render(<DropdownItem onClick={mockOnClick}>Test Item</DropdownItem>);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Test Item' }));
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('should render with icon', () => {
    const icon = <span data-testid="test-icon">🔥</span>;

    render(
      <DropdownItem onClick={mockOnClick} icon={icon}>
        Test Item
      </DropdownItem>
    );

    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: '🔥 Test Item' })
    ).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    render(
      <DropdownItem onClick={mockOnClick} className="custom-item-class">
        Test Item
      </DropdownItem>
    );

    const item = screen.getByRole('menuitem', { name: 'Test Item' });
    expect(item).toHaveClass('custom-item-class');
  });

  it('should have proper default styling', () => {
    render(<DropdownItem onClick={mockOnClick}>Test Item</DropdownItem>);

    const item = screen.getByRole('menuitem', { name: 'Test Item' });
    expect(item).toHaveClass('w-full', 'text-left', 'px-4', 'py-2', 'text-sm');
  });
});
