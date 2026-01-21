import { z } from 'zod';
import {
  createSanitizedOptionalStringSchema,
  createSanitizedStringSchema,
} from './sanitization';

export const ProblemDto = z.object({
  error: z.string(),
  message: z.string(),
  detail: z.string().optional(),
});

export type ProblemDto = z.infer<typeof ProblemDto>;

const MoneyMinor = z.number().int();
const HoldFailureCodeSchema = z.enum([
  'INSUFFICIENT_FUNDS',
  'STATE_MISMATCH',
  'VALIDATION',
  'INTERNAL',
]);

const ActivityIdSchema = z
  .string()
  .min(1, 'activityId is required')
  .describe(
    'Stable activity identifier. Transactions use TXN#<transactionId>; holds use HOLD#<holdId>.'
  );

const ActivityPayNoteReferenceSchema = z.object({
  payNoteDocumentId: z.string(),
});

const HoldStatusSchema = z.enum([
  'PENDING',
  'CAPTURED',
  'RELEASED',
  'EXPIRED',
  'FAILED',
]);

const HoldTimelineEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CREATED'),
    at: z.string().datetime({ offset: true }),
    createdByUserId: z.string().optional(),
    idempotencyKeyHash: z.string().optional(),
    payNoteDocumentId: z.string().optional(),
  }),
  z.object({
    type: z.literal('CAPTURED'),
    at: z.string().datetime({ offset: true }),
    transactionId: z.string(),
    counterpartyAccountNumber: z.string().optional(),
    payNoteDocumentId: z.string().optional(),
  }),
  z.object({
    type: z.literal('RELEASED'),
    at: z.string().datetime({ offset: true }),
    reason: z.string().optional(),
    payNoteDocumentId: z.string().optional(),
  }),
  z.object({
    type: z.literal('FAILED'),
    at: z.string().datetime({ offset: true }),
    code: HoldFailureCodeSchema,
    message: z.string().optional(),
    payNoteDocumentId: z.string().optional(),
  }),
]);

export const AccountDto = z.object({
  accountId: z.string().uuid(),
  accountNumber: z.string().length(10),
  name: z.string(),
  currency: z.literal('USD'),
  createdAt: z.string().datetime({ offset: true }),
  ledgerBalanceMinor: MoneyMinor,
  availableBalanceMinor: MoneyMinor,
  status: z.string(),
});

export const CreateAccountRequestDto = z.object({
  name: createSanitizedStringSchema(
    z
      .string()
      .min(1, 'Account name is required')
      .max(100, 'Account name must be 100 characters or less')
  ),
});

export const FundingReqDto = z.object({
  amountMinor: MoneyMinor.positive(),
});

export const TransferReqDto = z.object({
  sourceAccountId: z.string().uuid(),
  destinationAccountNumber: z.string().length(10),
  amountMinor: MoneyMinor.positive(),
  description: createSanitizedOptionalStringSchema(
    z.string().max(140).optional()
  ),
});

export const TransferResponseDto = z.object({
  txnId: z.string().uuid(),
});

export const IdempotencyKeyHeaderSchema = z.object({
  'idempotency-key': z.string(),
});

export const TransactionDto = z.object({
  txnId: z.string().uuid(),
  accountId: z.string().uuid(),
  side: z.enum(['DEBIT', 'CREDIT']),
  amountMinor: MoneyMinor,
  type: z.string(),
  status: z.string(),
  timestamp: z.string().datetime({ offset: true }),
  description: z.string().optional(),
  counterpartyAccountNumber: z.string(),
});

const CardStatusSchema = z.enum(['ACTIVE', 'BLOCKED', 'CLOSED', 'EXPIRED']);

export const CardSummaryDto = z.object({
  cardId: z.string(),
  accountId: z.string().uuid(),
  accountNumber: z.string().length(10),
  cardholderName: z.string(),
  panLast4: z.string().length(4),
  expiryMonth: z.number().int().min(1).max(12),
  expiryYear: z.number().int(),
  status: CardStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const IssueCardRequestDto = z.object({
  accountId: z.string().uuid(),
  cardholderName: createSanitizedOptionalStringSchema(
    z.string().max(100).optional()
  ),
});

export const CardDetailsDto = CardSummaryDto.extend({
  pan: z.string().length(16),
  cvc: z.string().length(3),
});

export const IssueCardResponseDto = CardDetailsDto;

export const CardListResponseDto = z.object({
  cards: z.array(CardSummaryDto),
});

export const CardMerchantDto = z.object({
  name: createSanitizedStringSchema(z.string().min(1).max(140)),
  statementDescriptor: createSanitizedOptionalStringSchema(
    z.string().max(140).optional()
  ),
});

const CardDeclineCodeSchema = z.enum([
  'card_not_found',
  'card_inactive',
  'expired_card',
  'invalid_cvc',
  'insufficient_funds',
  'invalid_amount',
  'invalid_currency',
]);

export const CardTransactionDetailsDto = z.object({
  retrievalReferenceNumber: z.string(),
  systemTraceAuditNumber: z.string(),
  transmissionDateTime: z.string(),
  authorizationCode: z.string(),
});

export const CardAuthorizationRequestDto = z.object({
  pan: z.string().length(16),
  expiryMonth: z.number().int().min(1).max(12),
  expiryYear: z.number().int(),
  cvc: z.string().length(3),
  amountMinor: MoneyMinor.positive(),
  currency: z.literal('USD'),
  merchant: CardMerchantDto,
  processorChargeId: z.string().min(1),
  description: createSanitizedOptionalStringSchema(
    z.string().max(140).optional()
  ),
});

export const CardAuthorizationResponseDto = z.object({
  status: z.enum(['APPROVED', 'DECLINED']),
  authorizationId: z.string().optional(),
  cardId: z.string().optional(),
  accountNumber: z.string().optional(),
  cardTransactionDetails: CardTransactionDetailsDto.optional(),
  declineCode: CardDeclineCodeSchema.optional(),
  message: z.string().optional(),
});

export const CardCaptureRequestDto = z.object({
  amountMinor: MoneyMinor.positive(),
});

export const CardCaptureResponseDto = z.object({
  status: z.literal('CAPTURED'),
  authorizationId: z.string(),
  transactionId: z.string(),
});

export const ActivityPostedTransactionDto = z.object({
  kind: z.literal('POSTED_TRANSACTION'),
  activityId: ActivityIdSchema,
  transactionId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  postedAt: z.string().datetime({ offset: true }),
  originHoldId: z.string().optional(),
  side: z.enum(['DEBIT', 'CREDIT']),
  type: z.string(),
  status: z.string(),
  counterpartyAccountNumber: z.string().optional(),
  cardId: z.string().optional(),
  cardLast4: z.string().optional(),
  merchantName: z.string().optional(),
  merchantStatementDescriptor: z.string().optional(),
  processorChargeId: z.string().optional(),
  payNote: ActivityPayNoteReferenceSchema.optional(),
});

export const ActivityHoldCreatedDto = z.object({
  kind: z.literal('HOLD_CREATED'),
  activityId: ActivityIdSchema,
  holdId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  createdAt: z.string().datetime({ offset: true }),
  counterpartyAccountNumber: z.string().optional(),
  createdByUserId: z.string().optional(),
  idempotencyKeyHash: z.string().optional(),
  cardId: z.string().optional(),
  cardLast4: z.string().optional(),
  merchantName: z.string().optional(),
  merchantStatementDescriptor: z.string().optional(),
  processorChargeId: z.string().optional(),
  payNote: ActivityPayNoteReferenceSchema.optional(),
});

export const ActivityHoldReleasedDto = z.object({
  kind: z.literal('HOLD_RELEASED'),
  activityId: ActivityIdSchema,
  holdId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  releasedAt: z.string().datetime({ offset: true }),
  releaseReason: z.string().optional(),
  cardId: z.string().optional(),
  cardLast4: z.string().optional(),
  merchantName: z.string().optional(),
  merchantStatementDescriptor: z.string().optional(),
  processorChargeId: z.string().optional(),
  payNote: ActivityPayNoteReferenceSchema.optional(),
});

export const ActivityHoldCapturedDto = z.object({
  kind: z.literal('HOLD_CAPTURED'),
  activityId: ActivityIdSchema,
  holdId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  capturedAt: z.string().datetime({ offset: true }),
  transactionId: z.string(),
  counterpartyAccountNumber: z.string(),
  cardId: z.string().optional(),
  cardLast4: z.string().optional(),
  merchantName: z.string().optional(),
  merchantStatementDescriptor: z.string().optional(),
  processorChargeId: z.string().optional(),
  payNote: ActivityPayNoteReferenceSchema.optional(),
});

export const ActivityHoldFailedDto = z.object({
  kind: z.literal('HOLD_FAILED'),
  activityId: ActivityIdSchema,
  holdId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  failedAt: z.string().datetime({ offset: true }),
  failureCode: HoldFailureCodeSchema,
  failureMessage: z.string().optional(),
  cardId: z.string().optional(),
  cardLast4: z.string().optional(),
  merchantName: z.string().optional(),
  merchantStatementDescriptor: z.string().optional(),
  processorChargeId: z.string().optional(),
  payNote: ActivityPayNoteReferenceSchema.optional(),
});

export const ActivityItemDto = z.discriminatedUnion('kind', [
  ActivityHoldCreatedDto,
  ActivityHoldReleasedDto,
  ActivityHoldCapturedDto,
  ActivityHoldFailedDto,
  ActivityPostedTransactionDto,
]);

export const ActivityResponseDto = z.object({
  items: z.array(ActivityItemDto),
  nextCursor: z.string().optional(),
});

const ActivityDetailPostedTransactionDto = z.object({
  kind: z.literal('POSTED_TRANSACTION'),
  activityId: ActivityIdSchema,
  transactionId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  postedAt: z.string().datetime({ offset: true }),
  originHoldId: z.string().optional(),
  side: z.enum(['DEBIT', 'CREDIT']),
  type: z.string(),
  status: z.string(),
  counterpartyAccountNumber: z.string().optional(),
  cardId: z.string().optional(),
  cardLast4: z.string().optional(),
  merchantName: z.string().optional(),
  merchantStatementDescriptor: z.string().optional(),
  processorChargeId: z.string().optional(),
  payNote: ActivityPayNoteReferenceSchema.optional(),
});

const ActivityDetailHoldDto = z.object({
  kind: z.literal('HOLD'),
  activityId: ActivityIdSchema,
  holdId: z.string(),
  amountMinor: MoneyMinor,
  currency: z.literal('USD'),
  status: HoldStatusSchema,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  releasedAt: z.string().datetime({ offset: true }).optional(),
  releaseReason: z.string().optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  captureTransactionId: z.string().optional(),
  failedAt: z.string().datetime({ offset: true }).optional(),
  failureCode: HoldFailureCodeSchema.optional(),
  failureMessage: z.string().optional(),
  counterpartyAccountNumber: z.string().optional(),
  cardId: z.string().optional(),
  cardLast4: z.string().optional(),
  merchantName: z.string().optional(),
  merchantStatementDescriptor: z.string().optional(),
  processorChargeId: z.string().optional(),
  timeline: z.array(HoldTimelineEventSchema),
  payNote: ActivityPayNoteReferenceSchema.optional(),
});

export const ActivityDetailDto = z.discriminatedUnion('kind', [
  ActivityDetailPostedTransactionDto,
  ActivityDetailHoldDto,
]);

export type ActivityDetailDto = z.infer<typeof ActivityDetailDto>;

export const PayNoteDetailsDto = z.object({
  payNoteDocumentId: z.string(),
  documentYaml: z.string().optional(),
  document: z.unknown().optional(),
  transactionRequest: z.unknown().optional(),
  triggerEvent: z.unknown().optional(),
  fetchedAt: z.string().datetime({ offset: true }),
});

export type PayNoteDetailsDto = z.infer<typeof PayNoteDetailsDto>;

export const PayNoteSummaryDto = z.object({
  name: z.string().optional(),
  amountMinor: MoneyMinor.optional(),
  currency: z.string().optional(),
});

export const PayNoteDeliverySummaryDto = z.object({
  deliveryId: z.string(),
  deliverySessionId: z.string().optional(),
  name: z.string().optional(),
  amountMinor: MoneyMinor.optional(),
  currency: z.string().optional(),
  deliveryStatus: z.string().optional(),
  transactionIdentificationStatus: z.string().optional(),
  clientDecisionStatus: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const PayNoteDeliveryListResponseDto = z.object({
  items: z.array(PayNoteDeliverySummaryDto),
});

export const PayNoteDeliveryDetailsDto = z.object({
  deliveryId: z.string(),
  deliverySessionId: z.string().optional(),
  deliveryStatus: z.string().optional(),
  transactionIdentificationStatus: z.string().optional(),
  clientDecisionStatus: z.string().optional(),
  cardTransactionDetails: CardTransactionDetailsDto.optional(),
  payNote: PayNoteSummaryDto.optional(),
  deliveryDocument: z.unknown(),
  payNoteDocument: z.unknown().optional(),
  accountNumber: z.string().optional(),
  holdId: z.string().optional(),
  transactionId: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const ContractSummaryDto = z.object({
  contractId: z.string(),
  typeBlueId: z.string(),
  displayName: z.string(),
  documentName: z.string().optional(),
  sessionId: z.string().optional(),
  documentId: z.string().optional(),
  status: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const ContractListResponseDto = z.object({
  items: z.array(ContractSummaryDto),
});

export const ContractDocumentSummaryKeyFactDto = z.object({
  label: z.string(),
  value: z.string(),
});

export const ContractDocumentSummaryStateDto = z.object({
  statusLabel: z.string(),
  explanation: z.string(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
});

export const ContractDocumentSummaryDto = z.object({
  title: z.string(),
  oneLiner: z.string(),
  state: ContractDocumentSummaryStateDto,
  keyFacts: z.array(ContractDocumentSummaryKeyFactDto),
  warnings: z.array(z.string()),
});

export const ContractDetailsDto = z.object({
  contractId: z.string(),
  typeBlueId: z.string(),
  displayName: z.string(),
  sessionId: z.string().optional(),
  documentId: z.string().optional(),
  status: z.string().optional(),
  statusUpdatedAt: z.string().datetime({ offset: true }).optional(),
  statusTimestamps: z.record(z.string()).optional(),
  triggerEvent: z.unknown().optional(),
  emittedEvents: z.array(z.unknown()).optional(),
  relatedTransactionIds: z.array(z.string()).optional(),
  relatedHoldIds: z.array(z.string()).optional(),
  accountNumber: z.string().optional(),
  document: z.unknown().optional(),
  summary: ContractDocumentSummaryDto.optional(),
  summaryUpdatedAt: z.string().datetime({ offset: true }).optional(),
  summarySourceUpdatedAt: z.string().datetime({ offset: true }).optional(),
  summaryModel: z.string().optional(),
  summaryError: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const ContractSummaryGenerationDto = z.object({
  summary: ContractDocumentSummaryDto,
  summaryUpdatedAt: z.string().datetime({ offset: true }),
  summarySourceUpdatedAt: z.string().datetime({ offset: true }),
  cached: z.boolean().optional(),
  model: z.string().optional(),
});

export const ContractOperationResponseDto = z.object({
  status: z.literal('ok'),
  myosStatus: z.number().int(),
  body: z.unknown().optional(),
});

export const NotImplementedResponseDto = z.object({
  message: z.string(),
});

export type NotImplementedResponseDto = z.infer<
  typeof NotImplementedResponseDto
>;
