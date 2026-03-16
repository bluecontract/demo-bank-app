import { readFileSync } from 'node:fs';
import { Blue } from '@blue-labs/language';
import { createDefaultMergingProcessor } from '@blue-labs/document-processor';
import { repository } from '@blue-repository/types';
import type { TestCardTransactionDetails } from './simplePayNoteBuilders';

const blue = new Blue({
  repositories: [repository],
  mergingProcessor: createDefaultMergingProcessor(),
});

const FIXTURES_DIR = new URL('../fixtures/documents/', import.meta.url);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const readDocumentFixture = (fileName: string) =>
  readFileSync(new URL(fileName, FIXTURES_DIR), 'utf8');

const applyCardTransactionDetails = (input: {
  document: Record<string, unknown>;
  cardTransactionDetails: TestCardTransactionDetails;
  merchantId?: string;
}) => {
  const cardTransactionDetails = isRecord(input.document.cardTransactionDetails)
    ? input.document.cardTransactionDetails
    : {};

  cardTransactionDetails.retrievalReferenceNumber =
    input.cardTransactionDetails.retrievalReferenceNumber;
  cardTransactionDetails.systemTraceAuditNumber =
    input.cardTransactionDetails.systemTraceAuditNumber;
  cardTransactionDetails.transmissionDateTime =
    input.cardTransactionDetails.transmissionDateTime;
  cardTransactionDetails.authorizationCode =
    input.cardTransactionDetails.authorizationCode;

  if (input.merchantId) {
    cardTransactionDetails.merchantId = input.merchantId;
  }

  input.document.cardTransactionDetails = cardTransactionDetails;
};

export const buildSubscriptionPayNoteFromFixture = (input: {
  merchantId: string;
  cardTransactionDetails: TestCardTransactionDetails;
}) => {
  const yaml = readDocumentFixture('DemoSubscription.local.txt').replace(
    /^ {4}merchantId: c35e2720-f193-4d33-892a-d0ec56c42340$/m,
    `    merchantId: ${input.merchantId}`
  );

  const document = blue.nodeToJson(blue.yamlToNode(yaml)) as Record<
    string,
    unknown
  >;

  applyCardTransactionDetails({
    document,
    cardTransactionDetails: input.cardTransactionDetails,
    merchantId: input.merchantId,
  });

  return document;
};

export const buildVoucherMonitoringPayNote = (input: {
  sponsorMerchantId: string;
  sponsorAccountNumber: string;
  customerAccountNumber: string;
  targetMerchantId: string;
  amountMinor: number;
}) =>
  blue.nodeToJson(
    blue.yamlToNode(
      `type: PayNote/PayNote
name: Restaurant Cashback Voucher
LLM_SUMMARY_DISABLED: true
merchantId: ${input.sponsorMerchantId}
currency: USD
amount:
  total: ${input.amountMinor}
payerAccountNumber: "${input.sponsorAccountNumber}"
payeeAccountNumber: "${input.customerAccountNumber}"
voucher:
  targetMerchantId: ${input.targetMerchantId}
state:
  remainingMinor: ${input.amountMinor}
  paidOutMinor: 0
  monitoringStatus: idle
reportedTransactionIds: {}
payNoteInitialStateDescription:
  summary: Merchant reserves cashback and monitoring unlocks capture for eligible restaurant purchases.
  details: |
    The merchant first reserves cashback funds.
    The bank then asks for monitoring consent and reports normal card captures at the eligible restaurant.
  initialMessage: Approve restaurant cashback monitoring to activate your voucher.
contracts:
  guarantorChannel:
    type: MyOS/MyOS Timeline Channel
  initLifecycleChannel:
    type: Core/Lifecycle Event Channel
    event:
      type: Core/Document Processing Initiated
  eventsChannel:
    type: Core/Triggered Event Channel
  requestMonitoringOnInit:
    type: Conversation/Sequential Workflow
    channel: initLifecycleChannel
    steps:
      - name: Decide Voucher Init
        type: Conversation/JavaScript Code
        code: |
          const targetMerchantId = String(
            document('/voucher/targetMerchantId') ?? ''
          ).trim();
          const amountMinor = Number(document('/state/remainingMinor') ?? 0);
          if (!targetMerchantId || !(amountMinor > 0)) {
            return { changeset: [], events: [] };
          }

          return {
            changeset: [
              {
                op: 'replace',
                path: '/state/monitoringStatus',
                val: 'requested'
              }
            ],
            events: [
              {
                type: 'PayNote/Reserve Funds Requested',
                requestId: 'voucher-reserve',
                amount: amountMinor
              },
              {
                type: 'PayNote/Start Card Transaction Monitoring Requested',
                requestId: 'voucher-monitoring',
                targetMerchantId,
                events: ['transaction']
              }
            ]
          };
      - name: Apply Voucher Init
        type: Conversation/Update Document
        changeset: "\${steps['Decide Voucher Init'].changeset}"
  onMonitoringStarted:
    type: Conversation/Sequential Workflow
    channel: eventsChannel
    event:
      type: 'PayNote/Card Transaction Monitoring Started'
    steps:
      - name: Set Monitoring Started
        type: Conversation/Update Document
        changeset:
          - op: replace
            path: /state/monitoringStatus
            val: started
  onMonitoringRejected:
    type: Conversation/Sequential Workflow
    channel: eventsChannel
    event:
      type: 'PayNote/Card Transaction Monitoring Request Rejected'
    steps:
      - name: Set Monitoring Rejected
        type: Conversation/Update Document
        changeset:
          - op: replace
            path: /state/monitoringStatus
            val: rejected
  onCardTransactionReport:
    type: Conversation/Sequential Workflow
    channel: eventsChannel
    event:
      type: 'PayNote/Card Transaction Report'
    steps:
      - name: Decide Cashback Capture
        type: Conversation/JavaScript Code
        code: |
          const txnId = String(event.transactionId ?? '').trim();
          if (!txnId) {
            return { changeset: [], events: [] };
          }

          const alreadyProcessed = document('/reportedTransactionIds/' + txnId);
          if (alreadyProcessed) {
            return { changeset: [], events: [] };
          }

          const monitoringStatus = String(
            document('/state/monitoringStatus') ?? 'idle'
          );
          const targetMerchantId = String(
            document('/voucher/targetMerchantId') ?? ''
          ).trim();
          const reportMerchantId = String(event.merchantId ?? '').trim();
          const reportStatus = String(event.status ?? '').trim();
          const reportAmountMinor = Number(event.amountMinor ?? 0);
          const remainingMinor = Number(document('/state/remainingMinor') ?? 0);
          const changeset = [
            { op: 'replace', path: '/reportedTransactionIds/' + txnId, val: '1' }
          ];

          const isCaptureLikeStatus =
            reportStatus === 'captured' ||
            reportStatus === 'partially captured';

          if (
            monitoringStatus !== 'started' ||
            !isCaptureLikeStatus ||
            !targetMerchantId ||
            reportMerchantId !== targetMerchantId ||
            !(reportAmountMinor > 0) ||
            !(remainingMinor > 0)
          ) {
            return { changeset, events: [] };
          }

          const captureAmountMinor = Math.min(remainingMinor, reportAmountMinor);
          if (!(captureAmountMinor > 0)) {
            return { changeset, events: [] };
          }

          const paidOutMinor = Number(document('/state/paidOutMinor') ?? 0);
          changeset.push({
            op: 'replace',
            path: '/state/remainingMinor',
            val: remainingMinor - captureAmountMinor
          });
          changeset.push({
            op: 'replace',
            path: '/state/paidOutMinor',
            val: paidOutMinor + captureAmountMinor
          });

          return {
            changeset,
            events: [
              {
                type: 'PayNote/Capture Funds Requested',
                requestId: 'voucher-capture:' + txnId,
                amount: captureAmountMinor
              }
            ]
          };
      - name: Apply Cashback Decision
        type: Conversation/Update Document
        changeset: "\${steps['Decide Cashback Capture'].changeset}"
`
    )
  ) as Record<string, unknown>;
