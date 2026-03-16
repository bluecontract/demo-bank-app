import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from './Select';

describe('Select', () => {
  const options = [
    { value: '', label: 'All cards' },
    { value: 'card-1', label: '**** 1234' },
    { value: 'card-2', label: '**** 5678' },
  ];

  it('renders the selected option label', () => {
    const onChange = vi.fn();
    render(
      <Select
        value="card-2"
        options={options}
        onChange={onChange}
        aria-label="Test select"
      />
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('**** 5678');
  });

  it('does not show the listbox initially', () => {
    const onChange = vi.fn();
    render(
      <Select
        value=""
        options={options}
        onChange={onChange}
        aria-label="Test select"
      />
    );

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens the listbox when clicked and closes when clicked again', () => {
    const onChange = vi.fn();
    render(
      <Select
        value=""
        options={options}
        onChange={onChange}
        aria-label="Test select"
      />
    );

    const trigger = screen.getByRole('combobox');

    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onChange and closes when selecting an option', () => {
    const onChange = vi.fn();
    render(
      <Select
        value=""
        options={options}
        onChange={onChange}
        aria-label="Test select"
      />
    );

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: '**** 1234' }));

    expect(onChange).toHaveBeenCalledWith('card-1');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the listbox when clicking outside', () => {
    const onChange = vi.fn();
    render(
      <div>
        <Select
          value=""
          options={options}
          onChange={onChange}
          aria-label="Test select"
        />
        <div data-testid="outside">Outside</div>
      </div>
    );

    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the listbox when pressing Escape', () => {
    const onChange = vi.fn();
    render(
      <Select
        value=""
        options={options}
        onChange={onChange}
        aria-label="Test select"
      />
    );

    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('does not open when disabled', () => {
    const onChange = vi.fn();
    render(
      <Select
        value=""
        options={options}
        onChange={onChange}
        aria-label="Test select"
        disabled={true}
      />
    );

    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('supports keyboard navigation and selection', () => {
    const onChange = vi.fn();
    render(
      <Select
        value=""
        options={options}
        onChange={onChange}
        aria-label="Test select"
      />
    );

    const trigger = screen.getByRole('combobox');

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    const optionElements = screen.getAllByRole('option');
    expect(trigger).toHaveAttribute(
      'aria-activedescendant',
      optionElements[0]?.id
    );

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger).toHaveAttribute(
      'aria-activedescendant',
      optionElements[1]?.id
    );

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('card-1');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
