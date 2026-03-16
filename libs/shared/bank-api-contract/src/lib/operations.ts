import type { Blue, BlueNode } from '@blue-labs/language';
import {
  CompositeTimelineChannelSchema,
  OperationSchema,
} from '@blue-repository/types/packages/conversation/schemas';

export type ContractOperation = {
  name: string;
  label: string;
  description?: string;
  channel?: string;
  request?: BlueNode;
};

type CollectOperationsInput = {
  document: unknown;
  operationsChannelKey: string;
  blue: Blue;
};

export const collectContractOperations = ({
  document,
  operationsChannelKey,
  blue,
}: CollectOperationsInput): ContractOperation[] => {
  if (!document) {
    return [];
  }

  try {
    const node = blue.jsonValueToNode(document);
    const contracts = node.getContracts() ?? {};

    const isOperationEligibleForChannel = (
      operationChannelKey: string
    ): boolean => {
      if (operationChannelKey === operationsChannelKey) {
        return true;
      }

      const visited = new Set<string>();

      const isCompositeChannelContaining = (channelKey: string): boolean => {
        if (channelKey === operationsChannelKey) {
          return true;
        }

        if (visited.has(channelKey)) {
          return false;
        }

        visited.add(channelKey);

        const channelNode = contracts[channelKey];
        if (
          !channelNode ||
          !blue.isTypeOf(channelNode, CompositeTimelineChannelSchema, {
            checkSchemaExtensions: true,
          })
        ) {
          return false;
        }

        const composite = blue.nodeToSchemaOutput(
          channelNode,
          CompositeTimelineChannelSchema
        );

        return (composite.channels ?? []).some(childKey =>
          isCompositeChannelContaining(childKey)
        );
      };

      return isCompositeChannelContaining(operationChannelKey);
    };

    return Object.entries(contracts).flatMap(([contractName, contractNode]) => {
      if (
        !blue.isTypeOf(contractNode, OperationSchema, {
          checkSchemaExtensions: true,
        })
      ) {
        return [];
      }

      const operation = blue.nodeToSchemaOutput(contractNode, OperationSchema);
      const channel = operation.channel;

      if (!channel || !isOperationEligibleForChannel(channel)) {
        return [];
      }

      const result: ContractOperation = {
        name: contractName,
        label: operation.name ?? contractName,
        channel,
        request: operation.request,
        ...(operation.description
          ? { description: operation.description }
          : {}),
      };

      return [result];
    });
  } catch {
    return [];
  }
};
