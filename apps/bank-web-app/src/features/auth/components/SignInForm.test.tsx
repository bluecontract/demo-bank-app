import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { SignInForm } from './SignInForm';
import { ApiProvider } from '../../../app/providers/ApiProvider';
import { AuthProvider } from '../../../app/providers/AuthProvider';

// Use vi.hoisted to create mocks that can be used in vi.mock
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

// Mock the API client library
vi.mock('@demo-bank-app/shared-bank-api-client', () => ({
  createApiClient: () => ({
    signIn: mockSignIn,
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form with all required elements', () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <SignInForm />
      </TestWrapper>
    );

    expect(
      screen.getByRole('heading', { name: 'Sign In' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('shows validation error for empty name', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <SignInForm />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });
  });

  it('shows validation error for name too long', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <SignInForm />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'a'.repeat(51) } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        screen.getByText('Name must be 50 characters or less')
      ).toBeInTheDocument();
    });
  });

  it('shows loading state during submission', async () => {
    const TestWrapper = createTestWrapper();

    let resolvePromise: (value: {
      status: number;
      body: { userId: string; name: string };
    }) => void = vi.fn();
    const signInPromise = new Promise(resolve => {
      resolvePromise = resolve;
    });

    mockSignIn.mockReturnValue(signInPromise);

    render(
      <TestWrapper>
        <SignInForm />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByText('Signing In...')).toBeInTheDocument();

    resolvePromise({ status: 200, body: { userId: '123', name: 'John Doe' } });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Sign In' })
      ).toBeInTheDocument();
    });
  });

  it('calls onSuccess when signin succeeds', async () => {
    const TestWrapper = createTestWrapper();
    const onSuccess = vi.fn();

    mockSignIn.mockResolvedValue({
      status: 200,
      body: { userId: '123', name: 'John Doe' },
    });

    render(
      <TestWrapper>
        <SignInForm onSuccess={onSuccess} />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        userId: '123',
        name: 'John Doe',
      });
    });
  });

  it('shows error message when user not found', async () => {
    const TestWrapper = createTestWrapper();

    mockSignIn.mockResolvedValue({
      status: 404,
      body: {
        error: 'USER_NOT_FOUND',
        message: 'User not found. Please check the name and try again.',
      },
    });

    render(
      <TestWrapper>
        <SignInForm />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'NonExistent User' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        screen.getByText('User not found. Please check the name and try again.')
      ).toBeInTheDocument();
    });
  });

  it('shows generic error message for other failures', async () => {
    const TestWrapper = createTestWrapper();

    mockSignIn.mockResolvedValue({
      status: 500,
      body: { error: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });

    render(
      <TestWrapper>
        <SignInForm />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        screen.getByText('Sign in failed. Please try again.')
      ).toBeInTheDocument();
    });
  });

  it('clears errors when typing in name field', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <SignInForm />
      </TestWrapper>
    );

    // First trigger an error
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });

    // Then type to clear the error
    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'J' } });

    await waitFor(() => {
      expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
    });
  });

  it('disables form when mutation is pending', async () => {
    const TestWrapper = createTestWrapper();

    let resolvePromise: (value: {
      status: number;
      body: { userId: string; name: string };
    }) => void = vi.fn();
    const signInPromise = new Promise(resolve => {
      resolvePromise = resolve;
    });

    mockSignIn.mockReturnValue(signInPromise);

    render(
      <TestWrapper>
        <SignInForm />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    const submitButton = screen.getByRole('button', { name: 'Sign In' });

    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    fireEvent.click(submitButton);

    expect(nameInput).toBeDisabled();
    expect(submitButton).toBeDisabled();

    resolvePromise({ status: 200, body: { userId: '123', name: 'John Doe' } });

    await waitFor(() => {
      expect(nameInput).not.toBeDisabled();
      expect(submitButton).not.toBeDisabled();
    });
  });
});
