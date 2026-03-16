import { describe, expect, it } from 'vitest';
import {
  readEventObjectDocumentId,
  readFetchedDocumentId,
  readInitializedDocumentId,
} from './webhookUtils';

describe('webhookUtils', () => {
  it('prefers initialized document id over event object blueId', () => {
    const value = {
      blueId: 'epoch-blue-id',
      document: {
        initialized: {
          documentId: {
            value: 'doc-1',
          },
        },
      },
    };

    expect(readEventObjectDocumentId(value)).toBe('doc-1');
  });

  it('reads initialized document id from document payload', () => {
    expect(
      readInitializedDocumentId({
        initialized: {
          documentId: {
            value: 'doc-2',
          },
        },
      })
    ).toBe('doc-2');
  });

  it('falls back to event object blueId for document-created style payloads', () => {
    expect(
      readEventObjectDocumentId({
        blueId: 'doc-3',
        document: {
          name: 'No initialized metadata',
        },
      })
    ).toBe('doc-3');
  });

  it('does not treat epoch snapshot blueId as document id', () => {
    expect(
      readEventObjectDocumentId({
        blueId: 'epoch-blue-id',
        epoch: 1,
        document: {
          name: 'Epoch snapshot',
        },
      })
    ).toBeUndefined();
  });

  it('prefers initialized document id over fetched runtime document id', () => {
    expect(
      readFetchedDocumentId({
        documentId: 'doc-runtime-1',
        document: {
          initialized: {
            documentId: {
              value: 'doc-stable-1',
            },
          },
        },
      })
    ).toBe('doc-stable-1');
  });
});
