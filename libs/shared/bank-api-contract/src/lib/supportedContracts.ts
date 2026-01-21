import { Blue, type BlueNode } from '@blue-labs/language';
import { repository } from '@blue-repository/types';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import {
  PayNoteDeliverySchema,
  PayNoteSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import { z } from 'zod';

export type SupportedContract = {
  typeBlueId: string;
  typeName: string;
  displayName: string;
  operationsChannelKey: string;
};

type SupportedContractDefinition = SupportedContract & {
  schema: z.AnyZodObject;
};

const PAYNOTE_PREFIX = 'PayNote/';

const buildDisplayName = (typeName: string) =>
  typeName.startsWith(PAYNOTE_PREFIX)
    ? typeName.slice(PAYNOTE_PREFIX.length)
    : typeName;

export const blue = new Blue({
  repositories: [repository],
});

const supportedContractDefinitions: SupportedContractDefinition[] = [
  {
    typeBlueId: paynoteBlueIds['PayNote/PayNote Delivery'],
    typeName: 'PayNote/PayNote Delivery',
    displayName: buildDisplayName('PayNote/PayNote Delivery'),
    operationsChannelKey: 'payNoteReceiver',
    schema: PayNoteDeliverySchema,
  },
  {
    typeBlueId: paynoteBlueIds['PayNote/PayNote'],
    typeName: 'PayNote/PayNote',
    displayName: buildDisplayName('PayNote/PayNote'),
    operationsChannelKey: 'payeeChannel',
    schema: PayNoteSchema,
  },
];

export const supportedContracts = supportedContractDefinitions.map(
  ({ typeBlueId, typeName, displayName, operationsChannelKey }) => ({
    typeBlueId,
    typeName,
    displayName,
    operationsChannelKey,
  })
);

export const getSupportedContractByTypeBlueId = (typeBlueId: string) =>
  supportedContractDefinitions.find(
    contract => contract.typeBlueId === typeBlueId
  ) ?? null;

export const getSupportedContractByNode = (node: BlueNode) =>
  supportedContractDefinitions.find(contract =>
    blue.isTypeOf(node, contract.schema, {
      checkSchemaExtensions: true,
    })
  ) ?? null;

export const getSupportedContractForDocument = (document: unknown) => {
  if (!document) {
    return null;
  }

  try {
    const node = blue.jsonValueToNode(document);
    return getSupportedContractByNode(node);
  } catch {
    return null;
  }
};
