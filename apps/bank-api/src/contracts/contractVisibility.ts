import conversationBlueIds from '@blue-repository/types/packages/conversation/blue-ids';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import type { ContractSummary } from '@demo-bank-app/contracts';

const hiddenContractTypeBlueIds = new Set<string>([
  paynoteBlueIds['PayNote/PayNote Delivery'],
  paynoteBlueIds['PayNote/Payment Mandate'],
  conversationBlueIds['Conversation/Customer Consent'],
]);

export const isContractHiddenFromCustomer = (
  contract: Pick<ContractSummary, 'typeBlueId'>
) => hiddenContractTypeBlueIds.has(contract.typeBlueId);

const hasSummaryPreview = (contract: Pick<ContractSummary, 'summaryPreview'>) =>
  Boolean(contract.summaryPreview);

export const filterCustomerVisibleContracts = (contracts: ContractSummary[]) =>
  contracts.filter(
    contract =>
      !isContractHiddenFromCustomer(contract) && hasSummaryPreview(contract)
  );
