import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../app/providers/ApiProvider';

export function HealthStatus() {
  const apiClient = useApiClient();

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
          Make sure the API server is running on{' '}
          {import.meta.env.VITE_API_URL || 'http://localhost:3000'}
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
