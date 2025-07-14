import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('should render children', () => {
    render(
      <Tooltip content="This is a tooltip">
        <span>Hover me</span>
      </Tooltip>
    );

    expect(screen.getByText('Hover me')).toBeInTheDocument();
  });

  it('should not show tooltip initially', () => {
    render(
      <Tooltip content="This is a tooltip">
        <span>Hover me</span>
      </Tooltip>
    );

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('should show tooltip on mouse enter', () => {
    render(
      <Tooltip content="This is a tooltip">
        <span>Hover me</span>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('This is a tooltip')).toBeInTheDocument();
  });

  it('should hide tooltip on mouse leave', () => {
    render(
      <Tooltip content="This is a tooltip">
        <span>Hover me</span>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('should apply default top position', () => {
    render(
      <Tooltip content="This is a tooltip">
        <span>Hover me</span>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass(
      'bottom-full',
      'left-1/2',
      'transform',
      '-translate-x-1/2',
      'mb-2'
    );
  });

  it('should apply bottom position when specified', () => {
    render(
      <Tooltip content="This is a tooltip" position="bottom">
        <span>Hover me</span>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass(
      'top-full',
      'left-1/2',
      'transform',
      '-translate-x-1/2',
      'mt-2'
    );
  });

  it('should apply left position when specified', () => {
    render(
      <Tooltip content="This is a tooltip" position="left">
        <span>Hover me</span>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass(
      'right-full',
      'top-1/2',
      'transform',
      '-translate-y-1/2',
      'mr-2'
    );
  });

  it('should apply right position when specified', () => {
    render(
      <Tooltip content="This is a tooltip" position="right">
        <span>Hover me</span>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass(
      'left-full',
      'top-1/2',
      'transform',
      '-translate-y-1/2',
      'ml-2'
    );
  });

  it('should apply custom className', () => {
    render(
      <Tooltip
        content="This is a tooltip"
        className="custom-class"
        data-testid="tooltip-container"
      >
        <span>Hover me</span>
      </Tooltip>
    );

    const container = screen.getByTestId('tooltip-container');
    expect(container).toHaveClass('custom-class');
  });

  it('should have proper accessibility attributes', () => {
    render(
      <Tooltip content="This is a tooltip">
        <span>Hover me</span>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveAttribute('aria-label', 'This is a tooltip');
  });

  it('should have tooltip styling classes', () => {
    render(
      <Tooltip content="This is a tooltip">
        <span>Hover me</span>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass(
      'absolute',
      'z-50',
      'px-3',
      'py-2',
      'text-sm',
      'text-white',
      'bg-gray-800',
      'rounded-lg',
      'shadow-lg',
      'whitespace-nowrap'
    );
  });

  it('should render arrow element', () => {
    render(
      <Tooltip content="This is a tooltip">
        <span>Hover me</span>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole('tooltip');
    const arrow = tooltip.querySelector('[aria-hidden="true"]');
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveClass('absolute', 'w-0', 'h-0', 'border-4');
  });
});
