import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { vi } from 'vitest';
import { AuthorizationStep } from './AuthorizationStep';
import { encodeObjectAsPayNoteBase64 } from '../../../lib/paynote';

type UseTransferMoneyOptions = {
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
};

const hoistedTransfer = vi.hoisted(() => {
  const state: {
    mutateMock: ReturnType<typeof vi.fn>;
    capturedOptions: UseTransferMoneyOptions | undefined;
    useTransferMoneyMock: ReturnType<typeof vi.fn>;
  } = {
    mutateMock: vi.fn(),
    capturedOptions: undefined,
    useTransferMoneyMock: vi.fn(),
  };

  state.useTransferMoneyMock = vi.fn((options?: UseTransferMoneyOptions) => {
    state.capturedOptions = options;
    return {
      mutate: state.mutateMock,
      isPending: false,
    };
  });

  return state;
});

vi.mock('../../transfer/hooks/useTransferMoney.ts', () => ({
  useTransferMoney: hoistedTransfer.useTransferMoneyMock,
}));

const hoistedApi = vi.hoisted(() => {
  const bootstrapPayNoteMock = vi.fn();
  const useApiClientMock = vi.fn(() => ({
    banking: {
      bootstrapPayNote: bootstrapPayNoteMock,
    },
  }));

  return {
    bootstrapPayNoteMock,
    useApiClientMock,
  };
});

vi.mock('../../../app/providers/ApiProvider', () => ({
  useApiClient: hoistedApi.useApiClientMock,
}));

describe('AuthorizationStep', () => {
  const accounts = [
    {
      accountId: 'account-1',
      accountNumber: '1234567890',
      name: 'Primary Account',
      currency: 'USD',
      ledgerBalanceMinor: 250000,
      availableBalanceMinor: 200000,
      status: 'ACTIVE',
    },
  ];

  const baseProps = {
    accounts,
    onAuthorize: vi.fn(),
    onBack: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    hoistedTransfer.mutateMock.mockReset();
    hoistedTransfer.useTransferMoneyMock.mockClear();
    baseProps.onAuthorize.mockReset();
    baseProps.onBack.mockReset();
    baseProps.onCancel.mockReset();
    hoistedTransfer.capturedOptions = undefined;
    hoistedApi.bootstrapPayNoteMock.mockReset();
    hoistedApi.useApiClientMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders standard transfer header when PayNote is disabled', () => {
    render(
      <AuthorizationStep
        {...baseProps}
        formData={{
          fromAccount: 'account-1',
          totalAmount: '150.00',
          toAccount: '9876543210',
          recipientName: 'Alice',
          title: 'Invoice 42',
          isPayNoteEnabled: false,
        }}
      />
    );

    expect(screen.getByText('Authorize Transfer')).toBeInTheDocument();
    expect(hoistedTransfer.useTransferMoneyMock).toHaveBeenCalled();
  });

  it('submits a direct transfer using the legacy mutate flow', async () => {
    render(
      <AuthorizationStep
        {...baseProps}
        formData={{
          fromAccount: 'account-1',
          totalAmount: '150.25',
          toAccount: '9876543210',
          recipientName: 'Alice',
          title: 'Invoice 42',
          isPayNoteEnabled: false,
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /authorize/i }));

    await waitFor(() => {
      expect(hoistedTransfer.mutateMock).toHaveBeenCalledWith({
        sourceAccountId: 'account-1',
        destinationAccountNumber: '9876543210',
        amountMinor: 15025,
        description: 'Invoice 42',
      });
    });
    expect(baseProps.onAuthorize).not.toHaveBeenCalled();
  });

  it('displays validation errors for invalid destination account', async () => {
    render(
      <AuthorizationStep
        {...baseProps}
        formData={{
          fromAccount: 'account-1',
          totalAmount: '150.25',
          toAccount: '123',
          recipientName: 'Alice',
          title: 'Invoice 42',
          isPayNoteEnabled: false,
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /authorize/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          /destination account number must be exactly 10 digits/i
        )
      ).toBeInTheDocument();
    });
    expect(hoistedTransfer.mutateMock).not.toHaveBeenCalled();
  });

  it('surfaces errors coming from the transfer mutation', async () => {
    render(
      <AuthorizationStep
        {...baseProps}
        formData={{
          fromAccount: 'account-1',
          totalAmount: '150.25',
          toAccount: '9876543210',
          recipientName: 'Alice',
          title: 'Invoice 42',
          isPayNoteEnabled: false,
        }}
      />
    );

    const error = Object.assign(new Error('Transfer failed'), {
      body: { error: 'ACCOUNT_NOT_FOUND' },
    });

    await act(async () => {
      hoistedTransfer.capturedOptions?.onError?.(error);
    });

    expect(
      screen.getByText(
        /account not found\. external outgoing transfers are not yet supported/i
      )
    ).toBeInTheDocument();
  });

  it('bootsraps a PayNote when enabled', async () => {
    hoistedApi.bootstrapPayNoteMock.mockResolvedValue({
      status: 200,
      body: { message: 'Bootstrap accepted' },
    });

    render(
      <AuthorizationStep
        {...baseProps}
        formData={{
          fromAccount: 'account-1',
          totalAmount: '500.00',
          toAccount: undefined,
          recipientName: undefined,
          title: undefined,
          isPayNoteEnabled: true,
          payNoteCode: encodeObjectAsPayNoteBase64({ name: 'Test PayNote' }),
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /authorize/i }));

    expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled();
    expect(hoistedTransfer.mutateMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(hoistedApi.bootstrapPayNoteMock).toHaveBeenCalledWith({
        body: { payNote: { name: 'Test PayNote' } },
      });
    });

    expect(baseProps.onAuthorize).toHaveBeenCalled();
  });

  it('surfaces bootstrapping errors', async () => {
    hoistedApi.bootstrapPayNoteMock.mockResolvedValue({
      status: 400,
      body: { error: 'VALIDATION_ERROR', message: 'failed' },
    });

    render(
      <AuthorizationStep
        {...baseProps}
        formData={{
          fromAccount: 'account-1',
          totalAmount: '500.00',
          isPayNoteEnabled: true,
          payNoteCode: encodeObjectAsPayNoteBase64({ name: 'Bad PayNote' }),
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /authorize/i }));

    await waitFor(() => {
      expect(screen.getByText(/bootstrap request failed/i)).toBeInTheDocument();
    });
    expect(baseProps.onAuthorize).not.toHaveBeenCalled();
  });
});
