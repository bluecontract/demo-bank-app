import { describe, it, expect } from 'vitest';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import {
  getSupportedContractByTypeBlueId,
  getSupportedContractForDocument,
} from './supportedContracts';

describe('supported contract registry', () => {
  it('resolves by type BlueId', () => {
    const payNote = getSupportedContractByTypeBlueId(
      paynoteBlueIds['PayNote/PayNote']
    );
    const delivery = getSupportedContractByTypeBlueId(
      paynoteBlueIds['PayNote/PayNote Delivery']
    );

    expect(payNote?.typeName).toBe('PayNote/PayNote');
    expect(delivery?.typeName).toBe('PayNote/PayNote Delivery');
    expect(getSupportedContractByTypeBlueId('unknown')).toBeNull();
  });

  it('matches supported documents', () => {
    const payNote = getSupportedContractForDocument({
      type: 'PayNote/PayNote',
      name: 'Test PayNote',
    });
    const delivery = getSupportedContractForDocument({
      type: 'PayNote/PayNote Delivery',
      name: 'Delivery',
    });

    expect(payNote?.displayName).toBe('PayNote');
    expect(delivery?.displayName).toBe('PayNote Delivery');
  });
});
