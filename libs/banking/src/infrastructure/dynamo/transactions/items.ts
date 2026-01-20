import type { Transaction } from '../../../domain/entities/Transaction';
import { CONDITION_EXPRESSIONS, SORT_KEYS, TABLE_PREFIXES } from '../constants';

export interface TransactionHeaderItem {
  PK: string;
  SK: 'META';
  type: string;
  status: string;
  createdAt: string;
  description: string;
  transactionId: string;
  transactionIdempotencyKey?: string;
  originHoldId?: string;
  payNoteDocumentId?: string;
  cardId?: string;
  cardLast4?: string;
  merchantName?: string;
  merchantStatementDescriptor?: string;
  processorChargeId?: string;
}

export interface PostingItem {
  PK: string;
  SK: string;
  BANKING_GSI2PK: string;
  BANKING_GSI2SK: string;
  accountId: string;
  amount: number;
  side: string;
  accountNumber: string;
  counterpartyAccountNumber: string;
  type: TransactionHeaderItem['type'];
  status: TransactionHeaderItem['status'];
  createdAt: TransactionHeaderItem['createdAt'];
  description: TransactionHeaderItem['description'];
  transactionId: TransactionHeaderItem['transactionId'];
  originHoldId?: string;
  payNoteDocumentId?: string;
  cardId?: string;
  cardLast4?: string;
  merchantName?: string;
  merchantStatementDescriptor?: string;
  processorChargeId?: string;
}

export function buildTransactionHeaderPutItem(
  tableName: string,
  transaction: Transaction
) {
  const transactionHeaderItem: TransactionHeaderItem = {
    PK: `${TABLE_PREFIXES.TRANSACTION}${transaction.id}`,
    SK: SORT_KEYS.META,
    type: transaction.type,
    status: transaction.status,
    createdAt: transaction.createdAt.toISOString(),
    description: transaction.description,
    transactionId: transaction.id,
    transactionIdempotencyKey: transaction.transactionIdempotencyKey,
    ...(transaction.originHoldId
      ? { originHoldId: transaction.originHoldId }
      : {}),
    ...(transaction.payNoteDocumentId
      ? { payNoteDocumentId: transaction.payNoteDocumentId }
      : {}),
    ...(transaction.cardId ? { cardId: transaction.cardId } : {}),
    ...(transaction.cardLast4 ? { cardLast4: transaction.cardLast4 } : {}),
    ...(transaction.merchantName
      ? { merchantName: transaction.merchantName }
      : {}),
    ...(transaction.merchantStatementDescriptor
      ? { merchantStatementDescriptor: transaction.merchantStatementDescriptor }
      : {}),
    ...(transaction.processorChargeId
      ? { processorChargeId: transaction.processorChargeId }
      : {}),
  };

  return {
    Put: {
      TableName: tableName,
      Item: transactionHeaderItem,
      ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
    },
  };
}

export function buildPostingPutItems(
  tableName: string,
  transaction: Transaction
) {
  return transaction.postings.map((posting, index) => {
    const postingItem: PostingItem = {
      PK: `${TABLE_PREFIXES.TRANSACTION}${transaction.id}`,
      SK: `${TABLE_PREFIXES.POSTING}${index}`,
      BANKING_GSI2PK: `${TABLE_PREFIXES.ACCOUNT}${posting.accountId}`,
      BANKING_GSI2SK: `${
        TABLE_PREFIXES.POSTING
      }${transaction.createdAt.toISOString()}`,
      accountId: posting.accountId,
      amount: posting.amount.toCents(),
      side: posting.side,
      accountNumber: posting.accountNumber,
      counterpartyAccountNumber: posting.counterpartyAccountNumber,
      description: transaction.description,
      createdAt: transaction.createdAt.toISOString(),
      type: transaction.type,
      status: transaction.status,
      transactionId: transaction.id,
      ...(transaction.originHoldId
        ? { originHoldId: transaction.originHoldId }
        : {}),
      ...(transaction.payNoteDocumentId
        ? { payNoteDocumentId: transaction.payNoteDocumentId }
        : {}),
      ...(transaction.cardId ? { cardId: transaction.cardId } : {}),
      ...(transaction.cardLast4 ? { cardLast4: transaction.cardLast4 } : {}),
      ...(transaction.merchantName
        ? { merchantName: transaction.merchantName }
        : {}),
      ...(transaction.merchantStatementDescriptor
        ? {
            merchantStatementDescriptor:
              transaction.merchantStatementDescriptor,
          }
        : {}),
      ...(transaction.processorChargeId
        ? { processorChargeId: transaction.processorChargeId }
        : {}),
    };

    return {
      Put: {
        TableName: tableName,
        Item: postingItem,
        ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
      },
    };
  });
}
