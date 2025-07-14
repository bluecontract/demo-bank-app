import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';

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

type CreateAccountData = {
  currency: 'USD';
};

export function useCreateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAccountData): Promise<Account> => {
      const response = await apiClient.banking.createAccount({
        body: data,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 201) {
        throw new Error('Failed to create account');
      }

      return response.body;
    },
    onSuccess: () => {
      // Invalidate and refetch accounts query when a new account is created
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}
