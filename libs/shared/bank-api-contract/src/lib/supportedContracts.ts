import { Blue } from '@blue-labs/language';
import type { BlueNode } from '@blue-labs/language';
import { repository } from '@blue-repository/types';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import {
  CardTransactionPayNoteSchema,
  MerchantToCustomerPayNoteSchema,
  PayNoteDeliverySchema,
  PayNoteSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import { z } from 'zod';
import { createDefaultMergingProcessor } from '@blue-labs/document-processor';

export type SupportedContract = {
  typeBlueId: string;
  typeName: string;
  displayName: string;
  operationsChannelKey: string;
  userChannelKey: string;
};

export type ResolvedContractChannelKeys = {
  customerChannelKey?: string;
  operationsChannelKey: string;
  userChannelKey: string;
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
  mergingProcessor: createDefaultMergingProcessor(),
});

const supportedContractDefinitions: SupportedContractDefinition[] = [
  {
    typeBlueId: paynoteBlueIds['PayNote/PayNote Delivery'],
    typeName: 'PayNote/PayNote Delivery',
    displayName: buildDisplayName('PayNote/PayNote Delivery'),
    operationsChannelKey: 'payNoteDeliverer',
    userChannelKey: 'payNoteDeliverer',
    schema: PayNoteDeliverySchema,
  },
  {
    typeBlueId: paynoteBlueIds['PayNote/PayNote'],
    typeName: 'PayNote/PayNote',
    displayName: buildDisplayName('PayNote/PayNote'),
    operationsChannelKey: 'payeeChannel',
    userChannelKey: 'payerChannel',
    schema: PayNoteSchema,
  },
];

export const supportedContracts = supportedContractDefinitions.map(
  ({
    typeBlueId,
    typeName,
    displayName,
    operationsChannelKey,
    userChannelKey,
  }) => ({
    typeBlueId,
    typeName,
    displayName,
    operationsChannelKey,
    userChannelKey,
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

const normalizeChannelKey = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeAccountNumber = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

type PayNoteDocumentKind =
  | 'card-transaction'
  | 'merchant-to-customer'
  | 'paynote'
  | null;

const resolvePayNoteDocumentKind = (
  node: BlueNode | null
): PayNoteDocumentKind => {
  if (!node) {
    return null;
  }

  // Resolve most specific schemas first.
  if (
    blue.isTypeOf(node, CardTransactionPayNoteSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return 'card-transaction';
  }

  if (
    blue.isTypeOf(node, MerchantToCustomerPayNoteSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return 'merchant-to-customer';
  }

  if (
    blue.isTypeOf(node, PayNoteSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return 'paynote';
  }

  return null;
};

const readPayNoteAccountNumbers = (
  value?: unknown
): {
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
} => {
  if (!isRecord(value)) {
    return {};
  }

  return {
    payerAccountNumber: normalizeAccountNumber(
      value.payerAccountNumber as string | undefined
    ),
    payeeAccountNumber: normalizeAccountNumber(
      value.payeeAccountNumber as string | undefined
    ),
  };
};

const inferPayNoteCustomerChannelKey = (input: {
  document?: unknown;
  accountNumber?: string;
}): string | undefined => {
  const accountNumber = normalizeAccountNumber(input.accountNumber);
  const fallbackFromRecord = readPayNoteAccountNumbers(input.document);

  try {
    const node = blue.jsonValueToNode(input.document);
    const kind = resolvePayNoteDocumentKind(node);
    if (!kind) {
      return undefined;
    }

    const typeAccounts = readPayNoteAccountNumbers(
      blue.nodeToJson(node, 'simple')
    );
    const payerAccountNumber =
      typeAccounts.payerAccountNumber ?? fallbackFromRecord.payerAccountNumber;
    const payeeAccountNumber =
      typeAccounts.payeeAccountNumber ?? fallbackFromRecord.payeeAccountNumber;

    if (kind === 'merchant-to-customer') {
      return 'payeeChannel';
    }

    if (accountNumber) {
      if (payerAccountNumber && payerAccountNumber === accountNumber) {
        return 'payerChannel';
      }
      if (payeeAccountNumber && payeeAccountNumber === accountNumber) {
        return 'payeeChannel';
      }
    }

    if (kind === 'card-transaction') {
      return 'payerChannel';
    }

    return undefined;
  } catch {
    if (!accountNumber) {
      return undefined;
    }

    if (
      fallbackFromRecord.payerAccountNumber &&
      fallbackFromRecord.payerAccountNumber === accountNumber
    ) {
      return 'payerChannel';
    }
    if (
      fallbackFromRecord.payeeAccountNumber &&
      fallbackFromRecord.payeeAccountNumber === accountNumber
    ) {
      return 'payeeChannel';
    }

    return undefined;
  }
};

export const resolveContractChannelKeys = (input: {
  supportedContract: SupportedContract;
  customerChannelKey?: string | null;
  accountNumber?: string;
  document?: unknown;
}): ResolvedContractChannelKeys => {
  const explicitCustomerChannelKey = normalizeChannelKey(
    input.customerChannelKey
  );
  const inferredCustomerChannelKey =
    explicitCustomerChannelKey ??
    (input.supportedContract.typeName === 'PayNote/PayNote'
      ? inferPayNoteCustomerChannelKey({
          accountNumber: input.accountNumber,
          document: input.document,
        })
      : undefined);
  const customerChannelKey =
    inferredCustomerChannelKey ?? explicitCustomerChannelKey;

  return {
    ...(customerChannelKey ? { customerChannelKey } : {}),
    operationsChannelKey:
      customerChannelKey ?? input.supportedContract.operationsChannelKey,
    userChannelKey:
      customerChannelKey ?? input.supportedContract.userChannelKey,
  };
};
