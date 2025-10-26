import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { SignInForm } from './SignInForm';
import { ApiProvider } from '../../../app/providers/ApiProvider';
import { AuthProvider } from '../../../app/providers/AuthProvider';

const { mockSignIn, mockHealth } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockHealth: vi.fn(),
}));

vi.mock('../../../api/client', () => ({
  apiClient: {
    signIn: mockSignIn,
    health: mockHealth,
  },
}));

vi.mock('@demo-bank-app/shared-bank-api-client', () => ({
  createApiClient: () => ({
    signIn: mockSignIn,
    health: mockHealth,
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ApiProvider>{children}</ApiProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

describe('SignInForm', () => {
  const validEmail = 'john.doe@example.com';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email field and submit button', () => {
    const Wrapper = createWrapper();

    render(
      <Wrapper>
        <SignInForm />
      </Wrapper>
    );

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('validates empty and malformed email addresses', async () => {
    const Wrapper = createWrapper();

    render(
      <Wrapper>
        <SignInForm />
      </Wrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Email is required')).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(
      await screen.findByText('Enter a valid email address')
    ).toBeInTheDocument();
  });

  it('submits credentials and handles success', async () => {
    const Wrapper = createWrapper();
    const onSuccess = vi.fn();

    mockSignIn.mockResolvedValue({
      status: 200,
      body: { userId: '123', email: validEmail, marketingEmailsOptIn: true },
    });

    render(
      <Wrapper>
        <SignInForm onSuccess={onSuccess} />
      </Wrapper>
    );

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: validEmail } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        userId: '123',
        email: validEmail,
        marketingEmailsOptIn: true,
      });
    });
  });

  it('shows not-found error when API returns 404', async () => {
    const Wrapper = createWrapper();

    mockSignIn.mockResolvedValue({
      status: 404,
      body: { error: 'USER_NOT_FOUND', message: 'missing' },
    });

    render(
      <Wrapper>
        <SignInForm />
      </Wrapper>
    );

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: validEmail } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        screen.getByText('Sign in failed. Please try again.')
      ).toBeInTheDocument();
    });
  });

  it('clears validation errors when user edits input', async () => {
    const Wrapper = createWrapper();

    render(
      <Wrapper>
        <SignInForm />
      </Wrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Email is required')).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: validEmail } });

    await waitFor(() => {
      expect(screen.queryByText('Email is required')).not.toBeInTheDocument();
    });
  });

  it('shows generic error when API call fails', async () => {
    const Wrapper = createWrapper();

    mockSignIn.mockResolvedValue({
      status: 500,
      body: { error: 'SERVER_ERROR', message: 'failure' },
    });

    render(
      <Wrapper>
        <SignInForm />
      </Wrapper>
    );

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: validEmail } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        screen.getByText('Sign in failed. Please try again.')
      ).toBeInTheDocument();
    });
  });
});
