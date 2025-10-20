import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { SignUpForm } from './SignUpForm';
import { ApiProvider } from '../../../app/providers/ApiProvider';
import { AuthProvider } from '../../../app/providers/AuthProvider';

// Use vi.hoisted to create mocks that can be used in vi.mock
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

// Mock the API client library
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
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ApiProvider>{children}</ApiProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

describe('SignUpForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form with all required elements', () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <SignUpForm />
      </TestWrapper>
    );

    expect(
      screen.getByRole('heading', { name: 'Create Account' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create Account' })
    ).toBeInTheDocument();
  });

  it('shows validation error for empty name', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <SignUpForm />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });
  });

  it('shows validation error for name too long', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <SignUpForm />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'a'.repeat(51) } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

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
    const signUpPromise = new Promise(resolve => {
      resolvePromise = resolve;
    });

    mockSignUp.mockReturnValue(signUpPromise);

    render(
      <TestWrapper>
        <SignUpForm />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Creating Account...')).toBeInTheDocument();

    resolvePromise({ status: 201, body: { userId: '123', name: 'John Doe' } });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Create Account' })
      ).toBeInTheDocument();
    });
  });

  it('calls onSuccess when signup succeeds', async () => {
    const TestWrapper = createTestWrapper();
    const onSuccess = vi.fn();

    mockSignUp.mockResolvedValue({
      status: 201,
      body: { userId: '123', name: 'John Doe' },
    });

    render(
      <TestWrapper>
        <SignUpForm onSuccess={onSuccess} />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        userId: '123',
        name: 'John Doe',
      });
    });
  });

  it('shows error message when user already exists', async () => {
    const TestWrapper = createTestWrapper();

    // Mock the API to return a 409 status, which should cause the component to throw an error
    mockSignUp.mockResolvedValue({
      status: 409,
      body: { error: 'CONFLICT', message: 'User already exists' },
    });

    render(
      <TestWrapper>
        <SignUpForm />
      </TestWrapper>
    );

    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'A user with this name already exists. Please choose a different name.'
        )
      ).toBeInTheDocument();
    });
  });

  it('clears errors when typing in name field', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <SignUpForm />
      </TestWrapper>
    );

    // First trigger an error
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });

    // Then type in the field to clear the error
    const nameInput = screen.getByLabelText('Full Name');
    fireEvent.change(nameInput, { target: { value: 'John' } });

    await waitFor(() => {
      expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
    });
  });
});
