import { describe, it, expect } from 'vitest';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import {
  getSupportedContractByTypeBlueId,
  getSupportedContractForDocument,
  resolveContractChannelKeys,
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

  it('resolves PayNote customer channel from accountNumber and document', () => {
    const payNote = getSupportedContractByTypeBlueId(
      paynoteBlueIds['PayNote/PayNote']
    );

    expect(payNote).toBeTruthy();

    const payerChannel = resolveContractChannelKeys({
      supportedContract: payNote!,
      accountNumber: '1111111111',
      document: {
        type: 'PayNote/PayNote',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      },
    });

    expect(payerChannel.customerChannelKey).toBe('payerChannel');
    expect(payerChannel.operationsChannelKey).toBe('payerChannel');
    expect(payerChannel.userChannelKey).toBe('payerChannel');

    const payeeChannel = resolveContractChannelKeys({
      supportedContract: payNote!,
      accountNumber: '2222222222',
      document: {
        type: 'PayNote/PayNote',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      },
    });

    expect(payeeChannel.customerChannelKey).toBe('payeeChannel');
    expect(payeeChannel.operationsChannelKey).toBe('payeeChannel');
    expect(payeeChannel.userChannelKey).toBe('payeeChannel');
  });

  it('prefers explicit customer channel over inferred/default', () => {
    const payNote = getSupportedContractByTypeBlueId(
      paynoteBlueIds['PayNote/PayNote']
    );

    expect(payNote).toBeTruthy();

    const resolved = resolveContractChannelKeys({
      supportedContract: payNote!,
      customerChannelKey: 'payeeChannel',
      accountNumber: '1111111111',
      document: {
        type: 'PayNote/PayNote',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      },
    });

    expect(resolved.customerChannelKey).toBe('payeeChannel');
    expect(resolved.operationsChannelKey).toBe('payeeChannel');
    expect(resolved.userChannelKey).toBe('payeeChannel');
  });

  it('resolves Merchant To Customer PayNote to payeeChannel first', () => {
    const payNote = getSupportedContractByTypeBlueId(
      paynoteBlueIds['PayNote/PayNote']
    );

    expect(payNote).toBeTruthy();

    const resolved = resolveContractChannelKeys({
      supportedContract: payNote!,
      accountNumber: '1111111111',
      document: {
        type: 'PayNote/Merchant To Customer PayNote',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      },
    });

    expect(resolved.customerChannelKey).toBe('payeeChannel');
    expect(resolved.operationsChannelKey).toBe('payeeChannel');
    expect(resolved.userChannelKey).toBe('payeeChannel');
  });

  it('falls back to payerChannel for Card Transaction PayNote', () => {
    const payNote = getSupportedContractByTypeBlueId(
      paynoteBlueIds['PayNote/PayNote']
    );

    expect(payNote).toBeTruthy();

    const resolved = resolveContractChannelKeys({
      supportedContract: payNote!,
      document: {
        type: 'PayNote/Card Transaction PayNote',
      },
    });

    expect(resolved.customerChannelKey).toBe('payerChannel');
    expect(resolved.operationsChannelKey).toBe('payerChannel');
    expect(resolved.userChannelKey).toBe('payerChannel');
  });
});
