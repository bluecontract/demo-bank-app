import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';

// Define Account type based on API contract
type Account = {
  accountId: string;
  accountNumber: string;
  currency: 'USD';
  createdAt: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
};

export function useAccounts() {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery({
    queryKey: ['accounts'],
    queryFn: async (): Promise<Account[]> => {
      const response = await apiClient.banking.listAccounts({
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw new Error('Failed to fetch accounts');
      }

      return response.body.accounts;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    throwOnError: error => {
      // Handle auth errors, but still throw other errors
      if (!handleAuthError(error)) {
        return true; // Throw the error
      }
      return false; // Don't throw auth errors (they're handled)
    },
  });
}
