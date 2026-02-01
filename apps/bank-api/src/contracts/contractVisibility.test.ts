import { describe, expect, it } from 'vitest';
import conversationBlueIds from '@blue-repository/types/packages/conversation/blue-ids';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import {
  filterCustomerVisibleContracts,
  isContractHiddenFromCustomer,
} from './contractVisibility';
import { createContractSummaryFixtures } from './contractSummaryFixtures';

describe('contractVisibility', () => {
  it('detects hidden contract types', () => {
    expect(
      isContractHiddenFromCustomer({
        typeBlueId: paynoteBlueIds['PayNote/PayNote Delivery'],
      })
    ).toBe(true);

    expect(
      isContractHiddenFromCustomer({
        typeBlueId: conversationBlueIds['Conversation/Customer Consent'],
      })
    ).toBe(true);

    expect(
      isContractHiddenFromCustomer({
        typeBlueId: paynoteBlueIds['PayNote/PayNote'],
      })
    ).toBe(false);
  });

  it('filters out hidden contract summaries', () => {
    const { all, visible } = createContractSummaryFixtures();

    expect(filterCustomerVisibleContracts(all)).toEqual(visible);
  });
});
