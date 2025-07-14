import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthProvider';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock the QueryClient clear method
const mockQueryClientClear = vi.fn();
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      clear: mockQueryClientClear,
    }),
  };
});

// Test component to expose auth context
const TestComponent = () => {
  const { user, isAuthenticated, isLoading, signIn, signOut } = useAuth();

  return (
    <div>
      <div data-testid="loading">{isLoading ? 'Loading' : 'Not Loading'}</div>
      <div data-testid="authenticated">
        {isAuthenticated ? 'Authenticated' : 'Not Authenticated'}
      </div>
      <div data-testid="user">
        {user ? `User: ${user.name} (${user.userId})` : 'No User'}
      </div>
      <button onClick={() => signIn({ userId: 'test-id', name: 'Test User' })}>
        Sign In
      </button>
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
};

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
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it('should start with loading state and then unauthenticated state', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    // Should start loading
    expect(screen.getByTestId('loading')).toHaveTextContent('Loading');

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading');
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent(
      'Not Authenticated'
    );
    expect(screen.getByTestId('user')).toHaveTextContent('No User');
  });

  it('should restore user from localStorage on mount', async () => {
    const storedUser = { userId: 'stored-id', name: 'Stored User' };
    localStorageMock.getItem.mockReturnValue(JSON.stringify(storedUser));

    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    // Wait for loading to complete and user to be restored
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading');
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent(
      'Authenticated'
    );
    expect(screen.getByTestId('user')).toHaveTextContent(
      'User: Stored User (stored-id)'
    );
    expect(localStorageMock.getItem).toHaveBeenCalledWith(
      'demo-blue-auth-user'
    );
  });

  it('should handle corrupted localStorage data gracefully', async () => {
    localStorageMock.getItem.mockReturnValue('invalid-json');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console.error for this test
    });

    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading');
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent(
      'Not Authenticated'
    );
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(
      'demo-blue-auth-user'
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to restore auth state:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('should update to authenticated state when signIn is called', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    // Wait for initial loading
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading');
    });

    // Initially not authenticated
    expect(screen.getByTestId('authenticated')).toHaveTextContent(
      'Not Authenticated'
    );

    // Sign in
    act(() => {
      screen.getByText('Sign In').click();
    });

    // Should be authenticated
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent(
        'Authenticated'
      );
      expect(screen.getByTestId('user')).toHaveTextContent(
        'User: Test User (test-id)'
      );
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'demo-blue-auth-user',
      JSON.stringify({ userId: 'test-id', name: 'Test User' })
    );
  });

  it('should return to unauthenticated state when signOut is called', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    // Wait for initial loading
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading');
    });

    // Sign in first
    act(() => {
      screen.getByText('Sign In').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent(
        'Authenticated'
      );
    });

    // Sign out
    act(() => {
      screen.getByText('Sign Out').click();
    });

    // Should be unauthenticated
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent(
        'Not Authenticated'
      );
      expect(screen.getByTestId('user')).toHaveTextContent('No User');
    });

    expect(localStorageMock.removeItem).toHaveBeenCalledWith(
      'demo-blue-auth-user'
    );
  });

  it('should clear React Query cache on sign out to prevent data leakage', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    // Wait for initial loading
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading');
    });

    // Sign in first
    act(() => {
      screen.getByText('Sign In').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent(
        'Authenticated'
      );
    });

    // Sign out
    act(() => {
      screen.getByText('Sign Out').click();
    });

    // Should clear the query cache
    expect(mockQueryClientClear).toHaveBeenCalledTimes(1);
  });

  it('should throw error when useAuth is used outside AuthProvider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Intentionally empty
    });

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useAuth must be used within AuthProvider');

    consoleSpy.mockRestore();
  });
});
