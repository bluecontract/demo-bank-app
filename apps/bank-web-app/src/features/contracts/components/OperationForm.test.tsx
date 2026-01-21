import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlueNode } from '@blue-labs/language';
import { blue } from '@demo-bank-app/shared-bank-api-contract';
import { OperationForm } from './OperationForm';
import { useRunContractOperation } from '../hooks/useRunContractOperation';

vi.mock('../hooks/useRunContractOperation', () => ({
  useRunContractOperation: vi.fn(),
}));

describe('OperationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs no-input operations with empty payload', () => {
    const mutate = vi.fn();
    (useRunContractOperation as any).mockReturnValue({
      mutate,
      isError: false,
      isPending: false,
      error: null,
    });

    render(
      <OperationForm
        operation={{
          name: 'noop',
          label: 'Noop',
          description: 'No input required',
        }}
        sessionId="session-1"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /review request/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & run/i }));

    expect(mutate).toHaveBeenCalledWith(
      {
        sessionId: 'session-1',
        operation: 'noop',
        body: {},
      },
      expect.any(Object)
    );
  });

  it('shows raw JSON fallback errors and confirmation', () => {
    const mutate = vi.fn();
    (useRunContractOperation as any).mockReturnValue({
      mutate,
      isError: false,
      isPending: false,
      error: null,
    });

    const requestNode = new BlueNode().setType('Unknown/Type');

    render(
      <OperationForm
        operation={{
          name: 'raw',
          label: 'Raw',
          request: requestNode,
        }}
        sessionId="session-1"
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/enter json/i), {
      target: { value: '{not-json}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /review request/i }));

    expect(screen.getByText('Enter valid JSON')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/enter json/i), {
      target: { value: '{"ok": true}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /review request/i }));

    expect(
      screen.getByRole('button', { name: /confirm & run/i })
    ).toBeInTheDocument();
  });

  it('builds a payload from typed fields', () => {
    const mutate = vi.fn();
    (useRunContractOperation as any).mockReturnValue({
      mutate,
      isError: false,
      isPending: false,
      error: null,
    });

    const requestNode = blue.jsonValueToNode({
      amount: { type: 'Integer' },
    });

    render(
      <OperationForm
        operation={{
          name: 'capture',
          label: 'Capture',
          request: requestNode,
        }}
        sessionId="session-1"
      />
    );

    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '42' },
    });
    fireEvent.click(screen.getByRole('button', { name: /review request/i }));

    expect(screen.getByText(/"amount": 42/)).toBeInTheDocument();
  });
});
