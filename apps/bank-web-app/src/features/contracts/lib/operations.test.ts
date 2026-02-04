import { describe, it, expect } from 'vitest';
import { blue } from '../../../lib/blue';
import {
  collectContractOperations,
  type ContractOperation,
} from './operations';

describe('collectContractOperations', () => {
  it('filters operations by channel key and hides missing channels', () => {
    const document = {
      contracts: {
        allParticipantsChannel: {
          type: 'Conversation/Composite Timeline Channel',
          channels: ['payeeChannel', 'guarantorChannel'],
        },
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
        incrementCounter: {
          type: 'Conversation/Operation',
          description: 'Increment the counter',
          channel: 'allParticipantsChannel',
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

    expect(operations).toHaveLength(3);
    expect(operations.map((op: ContractOperation) => op.name)).toEqual([
      'approve',
      'reject',
      'incrementCounter',
    ]);
    expect(operations[0].label).toBe('Approve');
  });
});
