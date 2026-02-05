import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { SignUpForm, MARKETING_CONSENT_COPY } from './SignUpForm';
import { ApiProvider } from '../../../app/providers/ApiProvider';
import { AuthProvider } from '../../../app/providers/AuthProvider';
import { routerFutureConfig } from '../../../app/routerFutureConfig';

const { mockSignUp, mockHealth } = vi.hoisted(() => ({
  mockSignUp: vi.fn(),
  mockHealth: vi.fn(),
}));

vi.mock('../../../api/client', () => ({
  apiClient: {
    signUp: mockSignUp,
    health: mockHealth,
  },
}));

vi.mock('@demo-bank-app/shared-bank-api-client', () => ({
  createApiClient: () => ({
    signUp: mockSignUp,
    health: mockHealth,
  }),
}));

const createTestWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter future={routerFutureConfig}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ApiProvider>{children}</ApiProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

describe('SignUpForm', () => {
  const validEmail = 'john.doe@example.com';
  const validMerchantName = 'Demo Merchant';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email field and submit button', () => {
    const Wrapper = createTestWrapper();

    render(
      <Wrapper>
        <SignUpForm />
      </Wrapper>
    );

    expect(
      screen.getByRole('heading', { name: 'Create Account' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(
      screen.queryByText('Upload logo (optional)')
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('I am a merchant')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create Account' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(MARKETING_CONSENT_COPY)).toBeChecked();
    expect(screen.queryByLabelText('Merchant name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Merchant ID')).not.toBeInTheDocument();
  });

  it('shows validation errors for empty and malformed email', async () => {
    const Wrapper = createTestWrapper();

    render(
      <Wrapper>
        <SignUpForm />
      </Wrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Email is required')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('I am a merchant'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(
      await screen.findByText('Merchant name is required')
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Merchant ID is required when signing up as a merchant'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Upload logo (optional)')).toBeInTheDocument();

    const emailInput = screen.getByLabelText('Email');
    const merchantNameInput = screen.getByLabelText('Merchant name');
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.change(merchantNameInput, {
      target: { value: validMerchantName },
    });
    fireEvent.change(screen.getByLabelText('Merchant ID'), {
      target: { value: 'merchant-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(
      await screen.findByText('Enter a valid email address')
    ).toBeInTheDocument();
  });

  it('shows validation error for excessively long email', async () => {
    const Wrapper = createTestWrapper();
    const longLocalPart = 'a'.repeat(245);

    render(
      <Wrapper>
        <SignUpForm />
      </Wrapper>
    );

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, {
      target: { value: `${longLocalPart}@example.com` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(
        screen.getByText('Email must be 254 characters or less')
      ).toBeInTheDocument();
    });
  });

  it('displays loading state during submission', async () => {
    const Wrapper = createTestWrapper();

    let resolvePromise: (value: {
      status: number;
      body: {
        userId: string;
        email: string;
        marketingEmailsOptIn: boolean;
      };
    }) => void = vi.fn();
    const signUpPromise = new Promise<typeof mockSignUp.arguments>(resolve => {
      resolvePromise = resolve as unknown as typeof resolvePromise;
    });

    mockSignUp.mockReturnValue(signUpPromise);

    render(
      <Wrapper>
        <SignUpForm />
      </Wrapper>
    );

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: validEmail } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Creating Account...')).toBeInTheDocument();

    resolvePromise({
      status: 201,
      body: {
        userId: '123',
        email: validEmail,
        marketingEmailsOptIn: true,
      },
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Create Account' })
      ).toBeInTheDocument();
    });
  });

  it('calls onSuccess when signup succeeds', async () => {
    const Wrapper = createTestWrapper();
    const onSuccess = vi.fn();

    mockSignUp.mockResolvedValue({
      status: 201,
      body: {
        userId: '123',
        email: validEmail,
        merchantName: validMerchantName,
        marketingEmailsOptIn: true,
      },
    });

    render(
      <Wrapper>
        <SignUpForm onSuccess={onSuccess} />
      </Wrapper>
    );

    fireEvent.click(screen.getByLabelText('I am a merchant'));

    const emailInput = screen.getByLabelText('Email');
    const merchantNameInput = screen.getByLabelText('Merchant name');
    fireEvent.change(emailInput, { target: { value: validEmail } });
    fireEvent.change(merchantNameInput, {
      target: { value: validMerchantName },
    });
    fireEvent.change(screen.getByLabelText('Merchant ID'), {
      target: { value: 'merchant-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        userId: '123',
        email: validEmail,
        merchantName: validMerchantName,
        marketingEmailsOptIn: true,
      });
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            email: validEmail,
            merchantName: validMerchantName,
            marketingEmailsOptIn: true,
            merchantId: 'merchant-123',
          },
        })
      );
    });
  });

  it('displays conflict error when email already exists', async () => {
    const Wrapper = createTestWrapper();

    mockSignUp.mockResolvedValue({
      status: 409,
      body: { error: 'USER_ALREADY_EXISTS', message: 'User already exists' },
    });

    render(
      <Wrapper>
        <SignUpForm />
      </Wrapper>
    );

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: validEmail } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'A user with this email already exists. Please use a different email.'
        )
      ).toBeInTheDocument();
    });
  });

  it('clears errors when typing after validation message', async () => {
    const Wrapper = createTestWrapper();

    render(
      <Wrapper>
        <SignUpForm />
      </Wrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Email is required')).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: validEmail } });

    await waitFor(() => {
      expect(screen.queryByText('Email is required')).not.toBeInTheDocument();
    });
  });

  it('requires merchantId when merchant toggle is enabled', async () => {
    const Wrapper = createTestWrapper();

    mockSignUp.mockResolvedValue({
      status: 201,
      body: {
        userId: '123',
        email: validEmail,
        merchantName: validMerchantName,
        marketingEmailsOptIn: true,
      },
    });

    render(
      <Wrapper>
        <SignUpForm />
      </Wrapper>
    );

    fireEvent.click(screen.getByLabelText('I am a merchant'));

    const emailInput = screen.getByLabelText('Email');
    const merchantNameInput = screen.getByLabelText('Merchant name');
    fireEvent.change(emailInput, { target: { value: validEmail } });
    fireEvent.change(merchantNameInput, {
      target: { value: validMerchantName },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(
      await screen.findByText(
        'Merchant ID is required when signing up as a merchant'
      )
    ).toBeInTheDocument();

    const merchantIdInput = screen.getByLabelText('Merchant ID');
    fireEvent.change(merchantIdInput, { target: { value: 'merchant-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            email: validEmail,
            merchantName: validMerchantName,
            marketingEmailsOptIn: true,
            merchantId: 'merchant-123',
          },
        })
      );
    });
  });
});
