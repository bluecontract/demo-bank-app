import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../app/providers/ApiProvider';
import { HealthCheck } from '../../types/api';

export function HealthStatus() {
  const apiClient = useApiClient();

  const {
    data: health,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthCheck> => {
      const response = await apiClient.health();
      if (response.status === 200) {
        return response.body;
      }
      throw new Error('Health check failed');
    },
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const statusSymbol = (() => {
    if (isLoading) return { icon: '⏳', label: 'Loading' };
    if (error) return { icon: '⚠️', label: 'Unavailable' };
    if (health?.status === 'healthy') return { icon: '✅', label: 'Healthy' };
    if (health) return { icon: 'ℹ️', label: health.status };
    return { icon: '❔', label: 'Unknown' };
  })();

  const tooltipContent = (() => {
    if (isLoading) {
      return (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-700 shadow-lg">
          <h3 className="font-semibold">System Health</h3>
          <p>Loading health status…</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 shadow-lg">
          <h3 className="font-semibold">System Health</h3>
          <p>Backend service is not available.</p>
          <p className="text-sm mt-1">
            Ensure the API server is running on{' '}
            {__BANK_API_URL__ || 'http://localhost:3000'}.
          </p>
        </div>
      );
    }

    if (!health) {
      return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-gray-700 shadow-lg">
          <h3 className="font-semibold">System Health</h3>
          <p>Health information is currently unavailable.</p>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 shadow-lg">
        <h3 className="font-semibold">System Health</h3>
        <p>Status: {health.status}</p>
        <p>Version: {health.version}</p>
        <p>Environment: {health.environment}</p>
        <p>Last checked: {new Date(health.timestamp).toLocaleString()}</p>
      </div>
    );
  })();

  return (
    <div className="group relative inline-block">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-sm font-medium text-gray-600 shadow-sm transition hover:border-blue-300 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
        aria-haspopup="true"
        aria-label={`System status: ${statusSymbol.label}`}
      >
        <span className="text-lg" aria-hidden="true">
          {statusSymbol.icon}
        </span>
        <span className="sr-only sm:not-sr-only">System status</span>
        <span className="hidden text-xs text-gray-400 sm:inline">
          {statusSymbol.label}
        </span>
      </button>

      <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-3 w-72 -translate-x-1/2 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 sm:w-80">
        <div className="pointer-events-auto">{tooltipContent}</div>
      </div>
    </div>
  );
}
