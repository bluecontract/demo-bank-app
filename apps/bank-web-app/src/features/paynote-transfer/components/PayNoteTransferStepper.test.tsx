import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { PayNoteTransferStepper } from './PayNoteTransferStepper';

const hoistedStepper = vi.hoisted(() => {
  const state: {
    navigateMock: ReturnType<typeof vi.fn>;
    formStepMock: ReturnType<typeof vi.fn>;
    reviewStepMock: ReturnType<typeof vi.fn>;
    authorizationStepMock: ReturnType<typeof vi.fn>;
    successStepSpy: ReturnType<typeof vi.fn>;
    successStepMock: ReturnType<typeof vi.fn>;
  } = {
    navigateMock: vi.fn(),
    formStepMock: vi.fn(
      ({
        onFormDataChange,
        onNext,
        onCancel,
      }: {
        onFormDataChange: (updates: Record<string, unknown>) => void;
        onNext: () => void;
        onCancel: () => void;
      }) => (
        <div data-testid="form-step">
          <button onClick={() => onFormDataChange({ recipientName: 'Alice' })}>
            update-form
          </button>
          <button onClick={onNext}>next-form</button>
          <button onClick={onCancel}>cancel-form</button>
        </div>
      )
    ),
    reviewStepMock: vi.fn(
      ({
        onFormDataChange,
        onNext,
        onBack,
        onCancel,
      }: {
        onFormDataChange: (updates: Record<string, unknown>) => void;
        onNext: () => void;
        onBack: () => void;
        onCancel: () => void;
      }) => (
        <div data-testid="review-step">
          <button onClick={() => onFormDataChange({ title: 'Review Title' })}>
            update-review
          </button>
          <button onClick={onNext}>next-review</button>
          <button onClick={onBack}>back-review</button>
          <button onClick={onCancel}>cancel-review</button>
        </div>
      )
    ),
    authorizationStepMock: vi.fn(
      ({
        onAuthorize,
        onBack,
      }: {
        onAuthorize: () => void;
        onBack: () => void;
      }) => (
        <div data-testid="authorization-step">
          <button onClick={onAuthorize}>authorize</button>
          <button onClick={onBack}>back-authorize</button>
        </div>
      )
    ),
    successStepSpy: vi.fn(),
    successStepMock: vi.fn(),
  };

  state.successStepMock = vi.fn(
    (props: { formData: Record<string, unknown>; onDone: () => void }) => {
      state.successStepSpy(props);
      return (
        <div data-testid="success-step">
          <button onClick={props.onDone}>done</button>
        </div>
      );
    }
  );

  return state;
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );

  return {
    ...actual,
    useNavigate: () => hoistedStepper.navigateMock,
  };
});

vi.mock('./FormStep.tsx', () => ({ FormStep: hoistedStepper.formStepMock }));
vi.mock('./ReviewStep.tsx', () => ({
  ReviewStep: hoistedStepper.reviewStepMock,
}));
vi.mock('./AuthorizationStep.tsx', () => ({
  AuthorizationStep: hoistedStepper.authorizationStepMock,
}));
vi.mock('./SuccessStep.tsx', () => ({
  SuccessStep: hoistedStepper.successStepMock,
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

describe('PayNoteTransferStepper', () => {
  beforeEach(() => {
    hoistedStepper.navigateMock.mockReset();
    hoistedStepper.formStepMock.mockClear();
    hoistedStepper.reviewStepMock.mockClear();
    hoistedStepper.authorizationStepMock.mockClear();
    hoistedStepper.successStepMock.mockClear();
    hoistedStepper.successStepSpy.mockClear();
  });

  const renderStepper = () =>
    render(
      <MemoryRouter>
        <PayNoteTransferStepper accounts={accounts} />
      </MemoryRouter>
    );

  it('renders the form step by default and cancels to dashboard', () => {
    renderStepper();

    expect(screen.getByTestId('form-step')).toBeInTheDocument();
    fireEvent.click(screen.getByText('cancel-form'));
    expect(hoistedStepper.navigateMock).toHaveBeenCalledWith('/dashboard');
  });

  it('progresses through all steps and preserves form state', () => {
    renderStepper();

    fireEvent.click(screen.getByText('update-form'));
    fireEvent.click(screen.getByText('next-form'));

    expect(screen.getByTestId('review-step')).toBeInTheDocument();
    fireEvent.click(screen.getByText('update-review'));
    fireEvent.click(screen.getByText('next-review'));

    expect(screen.getByTestId('authorization-step')).toBeInTheDocument();
    fireEvent.click(screen.getByText('authorize'));

    expect(screen.getByTestId('success-step')).toBeInTheDocument();
    expect(hoistedStepper.successStepSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        formData: expect.objectContaining({
          recipientName: 'Alice',
          title: 'Review Title',
        }),
      })
    );

    fireEvent.click(screen.getByText('done'));
    expect(hoistedStepper.navigateMock).toHaveBeenLastCalledWith('/dashboard');
  });
});
