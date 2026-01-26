import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { IssueCardResponse } from '../../../types/api';

export type IssueCardInput = {
  accountId: string;
  cardholderName?: string;
};

export function useIssueCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: IssueCardInput): Promise<IssueCardResponse> => {
      const response = await apiClient.banking.issueCard({
        body: data,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 201) {
        throw new Error('Failed to issue card');
      }

      return response.body;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['cards', variables.accountId],
      });
      queryClient.invalidateQueries({ queryKey: ['cards', 'all'] });
    },
  });
}
