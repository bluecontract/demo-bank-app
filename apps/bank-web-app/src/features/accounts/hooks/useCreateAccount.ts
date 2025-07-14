import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { Account } from '../../../types/api';

type CreateAccountData = {
  name: string;
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
