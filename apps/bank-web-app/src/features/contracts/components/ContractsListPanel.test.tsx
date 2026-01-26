import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContractsListPanel } from './ContractsListPanel';

const contracts = [
  {
    contractId: 'contract-1',
    typeBlueId: 'type-1',
    displayName: 'PayNote',
    documentName: 'Atlas Payroll',
    sessionId: 'session-1',
    status: 'accepted',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  {
    contractId: 'contract-2',
    typeBlueId: 'type-2',
    displayName: 'PayNote Delivery',
    sessionId: undefined,
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-03T00:00:00.000Z',
  },
];

describe('ContractsListPanel', () => {
  it('renders contracts', () => {
    render(
      <ContractsListPanel contracts={contracts} selectedSessionId="session-1" />
    );

    expect(screen.getByText('PayNote')).toBeInTheDocument();
    expect(screen.getByText('Atlas Payroll')).toBeInTheDocument();
    expect(screen.getAllByText('PayNote Delivery').length).toBeGreaterThan(0);
  });

  it('invokes selection callback', () => {
    const onSelect = vi.fn();

    render(
      <ContractsListPanel
        contracts={contracts}
        selectedSessionId={null}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByText('Atlas Payroll'));

    expect(onSelect).toHaveBeenCalledWith(contracts[0]);
  });
});
