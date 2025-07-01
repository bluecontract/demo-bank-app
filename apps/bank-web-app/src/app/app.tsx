import NxWelcome from './nx-welcome';
import { Route, Routes, Link } from 'react-router-dom';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { createApiClient } from '@demo-blue/api-client';

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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div>
        <HealthStatus />

        <NxWelcome title="@demo-blue/demo-blue" />

        {/* START: routes */}
        {/* These routes and navigation have been generated for you */}
        {/* Feel free to move and update them to fit your needs */}
        <br />
        <hr />
        <br />
        <div role="navigation">
          <ul>
            <li>
              <Link to="/">Home</Link>
            </li>
            <li>
              <Link to="/page-2">Page 2</Link>
            </li>
          </ul>
        </div>
        <Routes>
          <Route
            path="/"
            element={
              <div>
                This is the generated root route.{' '}
                <Link to="/page-2">Click here for page 2.</Link>
              </div>
            }
          />
          <Route
            path="/page-2"
            element={
              <div>
                <Link to="/">Click here to go back to root page.</Link>
              </div>
            }
          />
        </Routes>
        {/* END: routes */}
      </div>
    </QueryClientProvider>
  );
}

export default App;
