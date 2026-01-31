import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import App from './app';
import { ApiProvider } from './providers/ApiProvider';
import { routerFutureConfig } from './routerFutureConfig';

// Use vi.hoisted to create mocks that can be used in vi.mock
const { mockSignUp, mockHealth } = vi.hoisted(() => ({
  mockSignUp: vi.fn(),
  mockHealth: vi.fn(),
}));

vi.mock('../api/client', () => ({
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
    <BrowserRouter future={routerFutureConfig}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider>{children}</ApiProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock successful health check by default
    mockHealth.mockResolvedValue({
      status: 200,
      body: {
        status: 'healthy',
        version: '1.0.0',
        environment: 'test',
        timestamp: '2023-01-01T00:00:00Z',
      },
    });
  });

  it('should render successfully', () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    expect(screen.getByText('Demo Bank App')).toBeInTheDocument();
  });

  it('should show the Demo Bank App title and tagline', () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    expect(screen.getByText('Demo Bank App')).toBeInTheDocument();
    expect(
      screen.getByText(
        /The end-to-end reference for modelling banking workflows using/i
      )
    ).toBeInTheDocument();
  });

  it('should expose the system health control', async () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    expect(
      await screen.findByRole('button', { name: /System status/i })
    ).toBeInTheDocument();
  });
});
