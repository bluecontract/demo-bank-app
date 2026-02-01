import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContractsListPanel } from './ContractsListPanel';
import type { ProposalListItem } from '../lib/contractsAndProposals';

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

const proposal: ProposalListItem = {
  kind: 'proposal',
  deliveryId: 'delivery-1',
  deliverySessionId: 'session-delivery-1',
  name: 'Invoice 42',
  amountMinor: 1200,
  currency: 'USD',
  clientDecisionStatus: 'pending',
  transactionId: 'txn-9',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-03T00:00:00.000Z',
};

describe('ContractsListPanel', () => {
  it('renders contracts', () => {
    render(
      <ContractsListPanel items={contracts} selectedSessionId="session-1" />
    );

    expect(screen.getByText('PayNote')).toBeInTheDocument();
    expect(screen.getByText('Atlas Payroll')).toBeInTheDocument();
    expect(screen.getAllByText('PayNote Delivery').length).toBeGreaterThan(0);
  });

  it('invokes selection callback', () => {
    const onSelect = vi.fn();

    render(
      <ContractsListPanel
        items={contracts}
        selectedSessionId={null}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByText('Atlas Payroll'));

    expect(onSelect).toHaveBeenCalledWith(contracts[0]);
  });

  it('renders proposal context', () => {
    render(<ContractsListPanel items={[proposal]} selectedSessionId={null} />);

    expect(screen.getByText('Invoice 42')).toBeInTheDocument();
    expect(screen.getAllByText('Proposal').length).toBeGreaterThan(0);
    expect(screen.getByText('Transaction txn-9')).toBeInTheDocument();
  });
});
