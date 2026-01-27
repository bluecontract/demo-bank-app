export const TABLE_PREFIXES = {
  ACCOUNT: 'ACCOUNT#',
  TRANSACTION: 'TXN#',
  USER: 'USER#',
  POSTING: 'POST#',
  ACCOUNT_NUMBER: 'ACCOUNT_NUMBER#',
  IDEMPOTENCY: 'IDEMPOTENCY#',
} as const;

export const SORT_KEYS = {
  META: 'META',
  BALANCE: 'BALANCE',
  RESERVE: 'RESERVE',
} as const;

export const GSI_NAMES = {
  BANKING_GSI1: 'BANKING_GSI1',
  BANKING_GSI2: 'BANKING_GSI2',
} as const;

export const GSI_PARTITION_KEYS = {
  BANKING_GSI1PK: 'BANKING_GSI1PK',
  BANKING_GSI2PK: 'BANKING_GSI2PK',
} as const;

export const GSI_SORT_KEYS = {
  BANKING_GSI1SK: 'BANKING_GSI1SK',
  BANKING_GSI2SK: 'BANKING_GSI2SK',
} as const;

export const CONDITION_EXPRESSIONS = {
  ATTRIBUTE_NOT_EXISTS: 'attribute_not_exists(SK)',
  BALANCE_VERSION_CHECK: '#version = :currentVersion',
} as const;

export const UPDATE_EXPRESSIONS = {
  UPDATE_BALANCE:
    'ADD ledgerBalanceMinor :ledger, availableBalanceMinor :available SET #version = #version + :inc',
  UPDATE_CREDIT_LIMIT:
    'SET ledgerBalanceMinor = :ledger, availableBalanceMinor = :available, creditLimitMinor = :creditLimit, #version = #version + :inc',
} as const;

export const EXPRESSION_ATTRIBUTE_NAMES = {
  VERSION: '#version',
} as const;

export const DYNAMO_ERROR_CODES = {
  CONDITIONAL_CHECK_FAILED: 'ConditionalCheckFailed',
} as const;
