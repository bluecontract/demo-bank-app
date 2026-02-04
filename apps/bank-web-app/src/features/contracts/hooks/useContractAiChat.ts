import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import type {
  ContractAiChatMessage,
  ContractAiChatResponse,
} from '../../../types/api';

type ContractAiChatInput = {
  sessionId: string;
  messages: ContractAiChatMessage[];
};

type ContractAiChatError = Error & { status?: number };

const makeError = (message: string, status?: number): ContractAiChatError => {
  const error = new Error(message) as ContractAiChatError;
  error.status = status;
  return error;
};

export function useContractAiChat() {
  return useMutation<
    ContractAiChatResponse,
    ContractAiChatError,
    ContractAiChatInput
  >({
    mutationFn: async (input): Promise<ContractAiChatResponse> => {
      const response = await apiClient.banking.contractAiChat({
        params: { sessionId: input.sessionId },
        body: { messages: input.messages },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to chat with AI', response.status);
      }

      return response.body;
    },
  });
}
