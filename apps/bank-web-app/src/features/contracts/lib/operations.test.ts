import { describe, it, expect } from 'vitest';
import { blue } from '@demo-bank-app/shared-bank-api-contract';
import {
  collectContractOperations,
  type ContractOperation,
} from './operations';

describe('collectContractOperations', () => {
  it('filters operations by channel key and hides missing channels', () => {
    const document = {
      contracts: {
        approve: {
          type: 'Conversation/Operation',
          name: 'Approve',
          description: 'Approve the request',
          channel: 'payeeChannel',
        },
        reject: {
          type: 'Conversation/Operation',
          description: 'Reject the request',
          channel: 'payeeChannel',
        },
        internal: {
          type: 'Conversation/Operation',
          description: 'Internal only',
          channel: 'internalChannel',
        },
        missingChannel: {
          type: 'Conversation/Operation',
        },
      },
    };

    const operations = collectContractOperations({
      document,
      operationsChannelKey: 'payeeChannel',
      blue,
    });

    expect(operations).toHaveLength(2);
    expect(operations.map((op: ContractOperation) => op.name)).toEqual([
      'approve',
      'reject',
    ]);
    expect(operations[0].label).toBe('Approve');
  });
});
