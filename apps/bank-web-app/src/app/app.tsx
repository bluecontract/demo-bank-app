import { Routes, Route } from 'react-router-dom';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { createApiClient } from '@demo-blue/shared-bank-api-client';

const queryClient = new QueryClient();

const apiClient = createApiClient({
  baseUrl: __BANK_API_URL__,
});

function HealthStatus() {
  const {
    data: health,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await apiClient.health();
      if (response.status === 200) {
        return response.body;
      }
      throw new Error('Health check failed');
    },
    retry: 1,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="p-4 bg-blue-100 border border-blue-400 text-blue-700 rounded">
        <h3 className="font-bold">System Health</h3>
        <p>Loading health status...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
        <h3 className="font-bold">System Health</h3>
        <p>⚠️ Backend service is not available</p>
        <p className="text-sm">
          Make sure the API server is running on {__BANK_API_URL__}
        </p>
      </div>
    );
  }

  if (!health) return null;

  return (
    <div className="p-4 bg-green-100 border border-green-400 text-green-700 rounded">
      <h3 className="font-bold">System Health</h3>
      <p>✅ Status: {health.status}</p>
      <p>Version: {health.version}</p>
      <p>Environment: {health.environment}</p>
      <p>Last checked: {new Date(health.timestamp).toLocaleString()}</p>
    </div>
  );
}

function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Demo Blue Bank
          </h1>
          <p className="text-lg text-gray-600">
            Secure Banking Demo Application
          </p>
        </header>

        <div className="max-w-2xl mx-auto">
          <HealthStatus />

          <div className="mt-8 p-6 bg-white rounded-lg shadow-sm border">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Welcome to Demo Blue Bank
            </h2>
            <p className="text-gray-600 mb-6">
              This is a demonstration banking application with authentication
              system. Future features will include account management,
              transactions, and more.
            </p>
            <div className="text-sm text-gray-500">
              <p>🔐 Authentication system coming soon</p>
              <p>💳 Account management features planned</p>
              <p>💰 Transaction history planned</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </QueryClientProvider>
  );
}

export default App;
