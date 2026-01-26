import type { Blue } from '@blue-labs/language';
import type { BlueNode } from '@blue-labs/language';
import { OperationSchema } from '@blue-repository/types/packages/conversation/schemas';

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

      if (!channel || channel !== operationsChannelKey) {
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
