import conversationBlueIds from '@blue-repository/types/packages/conversation/blue-ids';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import type { ContractSummary } from '@demo-bank-app/contracts';

type ContractSummaryOverrides = Partial<ContractSummary> &
  Pick<ContractSummary, 'contractId'>;

const buildContractSummary = (
  overrides: ContractSummaryOverrides
): ContractSummary => ({
  contractId: overrides.contractId,
  typeBlueId: overrides.typeBlueId ?? paynoteBlueIds['PayNote/PayNote'],
  displayName: overrides.displayName ?? 'PayNote',
  documentName: overrides.documentName,
  sessionId: overrides.sessionId ?? 'session-1',
  documentId: overrides.documentId,
  status: overrides.status ?? 'accepted',
  archivedAt: overrides.archivedAt,
  summaryPreview: overrides.summaryPreview,
  summaryUpdatedAt: overrides.summaryUpdatedAt,
  summarySourceUpdatedAt: overrides.summarySourceUpdatedAt,
  createdAt: overrides.createdAt ?? '2024-01-01T00:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2024-01-02T12:00:00.000Z',
});

export const createContractSummaryFixtures = () => {
  const visible = buildContractSummary({ contractId: 'contract-1' });
  const delivery = buildContractSummary({
    contractId: 'contract-2',
    typeBlueId: paynoteBlueIds['PayNote/PayNote Delivery'],
    displayName: 'PayNote Delivery',
    sessionId: 'session-2',
    status: 'pending',
  });
  const consent = buildContractSummary({
    contractId: 'contract-3',
    typeBlueId: conversationBlueIds['Conversation/Customer Consent'],
    displayName: 'Customer Consent',
    sessionId: 'session-3',
  });

  return {
    all: [visible, delivery, consent],
    visible: [visible],
  };
};
