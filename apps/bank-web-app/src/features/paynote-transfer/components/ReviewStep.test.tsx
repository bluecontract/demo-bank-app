import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ReviewStep } from './ReviewStep';
import type { TransferFormData } from '../../../lib/paynote';

const hoistedReview = vi.hoisted(() => {
  const state: {
    validatePayNoteMock: ReturnType<typeof vi.fn>;
    useApiClientMock: ReturnType<typeof vi.fn>;
    PayNoteCodeInputMock: ReturnType<typeof vi.fn>;
    PayNoteDetailsMock: ReturnType<typeof vi.fn>;
  } = {
    validatePayNoteMock: vi.fn(),
    useApiClientMock: vi.fn(),
    PayNoteCodeInputMock: vi.fn(() => <div data-testid="paynote-code-input" />),
    PayNoteDetailsMock: vi.fn(() => <div data-testid="paynote-details" />),
  };

  state.useApiClientMock = vi.fn(() => ({
    banking: {
      validatePayNote: state.validatePayNoteMock,
    },
  }));

  return state;
});

vi.mock('../../../app/providers/ApiProvider', () => ({
  useApiClient: hoistedReview.useApiClientMock,
}));

vi.mock('./PayNoteCodeInput.tsx', () => ({
  PayNoteCodeInput: hoistedReview.PayNoteCodeInputMock,
}));

vi.mock('./PayNoteDetails.tsx', () => ({
  PayNoteDetails: hoistedReview.PayNoteDetailsMock,
}));

const accounts = [
  {
    accountId: 'account-1',
    accountNumber: '1234567890',
    name: 'Everyday Checking',
    currency: 'USD',
    ledgerBalanceMinor: 500000,
    availableBalanceMinor: 350000,
    status: 'ACTIVE',
  },
];

const baseFormData: TransferFormData = {
  fromAccount: 'account-1',
  totalAmount: '120.50',
  recipientName: 'Bob',
  toAccount: '9876543210',
  title: 'Services',
  date: '2024-06-01',
  isPayNoteEnabled: false,
};

describe('ReviewStep', () => {
  beforeEach(() => {
    hoistedReview.validatePayNoteMock.mockReset();
    hoistedReview.useApiClientMock.mockClear();
    hoistedReview.PayNoteCodeInputMock.mockClear();
    hoistedReview.PayNoteDetailsMock.mockClear();
  });

  it('skips validation when PayNote is not enabled', async () => {
    const onNext = vi.fn();

    render(
      <ReviewStep
        formData={baseFormData}
        accounts={accounts}
        onFormDataChange={vi.fn()}
        onNext={onNext}
        onBack={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(hoistedReview.validatePayNoteMock).not.toHaveBeenCalled();
    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);
    expect(onNext).toHaveBeenCalled();
  });

  it('validates a PayNote and allows progression on success', async () => {
    hoistedReview.validatePayNoteMock.mockResolvedValue({
      status: 200,
      body: { validationScore: 9, explanation: 'All good' },
    });

    const formData: TransferFormData = {
      ...baseFormData,
      isPayNoteEnabled: true,
      payNoteCode: Buffer.from(
        JSON.stringify({
          amount: { total: { value: 12345 } },
        }),
        'utf-8'
      ).toString('base64'),
    };

    render(
      <ReviewStep
        formData={formData}
        accounts={accounts}
        onFormDataChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(hoistedReview.validatePayNoteMock).toHaveBeenCalled()
    );

    expect(await screen.findByText(/bank notice/i)).toBeInTheDocument();
    expect(screen.getByText(/score: 9\/10/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  it('blocks progression when validation fails', async () => {
    hoistedReview.validatePayNoteMock.mockRejectedValue(new Error('fail'));

    const formData: TransferFormData = {
      ...baseFormData,
      isPayNoteEnabled: true,
      payNoteCode: Buffer.from(JSON.stringify({}), 'utf-8').toString('base64'),
    };

    render(
      <ReviewStep
        formData={formData}
        accounts={accounts}
        onFormDataChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(hoistedReview.validatePayNoteMock).toHaveBeenCalled();
    expect(
      await screen.findByText(/could not be validated/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});
