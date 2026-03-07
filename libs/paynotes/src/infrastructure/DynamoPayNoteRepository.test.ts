import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Blue, BlueNode } from '@blue-labs/language';
import { DynamoPayNoteRepository } from './DynamoPayNoteRepository';

const mockSend = vi.fn();
const mockDocumentClient = {
  send: mockSend,
};

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => mockDocumentClient),
  },
  PutCommand: vi.fn(payload => payload),
  GetCommand: vi.fn(payload => payload),
  UpdateCommand: vi.fn(payload => payload),
  DeleteCommand: vi.fn(payload => payload),
}));

const { PutCommand, GetCommand, UpdateCommand, DeleteCommand } = await import(
  '@aws-sdk/lib-dynamodb'
);
const mockPutCommand = vi.mocked(PutCommand);
const mockGetCommand = vi.mocked(GetCommand);
const mockUpdateCommand = vi.mocked(UpdateCommand);
const mockDeleteCommand = vi.mocked(DeleteCommand);

const createRepository = () =>
  new DynamoPayNoteRepository({
    tableName: 'test-table',
    region: 'us-east-1',
  });

const buildResolvedPayload = () => {
  const typeNode = new BlueNode()
    .setBlueId('type-root')
    .setName('TypeRoot')
    .setDescription('Resolved type metadata should not be persisted');
  const node = new BlueNode().setType(typeNode).setProperties({
    nested: new BlueNode().setType(typeNode.clone()).setValue('payload'),
  });
  return new Blue().nodeToJson(node, 'official');
};

describe('DynamoPayNoteRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists merchantId when saving paynotes', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-1',
      sessionIds: ['session-1'],
      merchantId: 'merchant-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const updatePayload = mockUpdateCommand.mock.calls[0]?.[0];
    expect(updatePayload?.ExpressionAttributeValues?.[':merchantId']).toBe(
      'merchant-1'
    );
  });

  it('persists last source event epoch when provided', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-epoch',
      sessionIds: ['session-epoch'],
      lastSourceEventEpoch: 3,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const updatePayload = mockUpdateCommand.mock.calls[0]?.[0];
    expect(
      updatePayload?.ExpressionAttributeValues?.[':lastSourceEventEpoch']
    ).toBe(3);
  });

  it('maps merchantId on get', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'PAYNOTE#paynote-doc-1',
        SK: 'META',
        entityType: 'PAYNOTE',
        payNoteDocumentId: 'paynote-doc-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    });
    const repository = createRepository();

    const result = await repository.getPayNote('paynote-doc-1');

    expect(result?.merchantId).toBe('merchant-1');
  });

  it('uses strongly consistent read when loading paynote by document id', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const repository = createRepository();

    await repository.getPayNote('paynote-doc-consistent');

    const getPayload = mockGetCommand.mock.calls[0]?.[0];
    expect(getPayload?.ConsistentRead).toBe(true);
  });

  it('uses strongly consistent reads when loading paynote by session id', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          PK: 'PAYNOTE_SESSION#session-consistent',
          SK: 'META',
          entityType: 'PAYNOTE_SESSION',
          sessionId: 'session-consistent',
          payNoteDocumentId: 'paynote-doc-consistent',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        Item: {
          PK: 'PAYNOTE#paynote-doc-consistent',
          SK: 'META',
          entityType: 'PAYNOTE',
          payNoteDocumentId: 'paynote-doc-consistent',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });
    const repository = createRepository();

    await repository.getPayNoteBySessionId('session-consistent');

    const sessionLookupPayload = mockGetCommand.mock.calls[0]?.[0];
    const payNoteLookupPayload = mockGetCommand.mock.calls[1]?.[0];
    expect(sessionLookupPayload?.ConsistentRead).toBe(true);
    expect(payNoteLookupPayload?.ConsistentRead).toBe(true);
  });

  it('does not remove last capture lock id when omitted in subsequent save', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-1',
      sessionIds: ['session-1'],
      lastCaptureLockEventId: 'capture-lock-event-id',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-1',
      sessionIds: ['session-1'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z',
    });

    const secondUpdatePayload = mockUpdateCommand.mock.calls[1]?.[0];
    const updateExpression = String(secondUpdatePayload?.UpdateExpression);
    expect(updateExpression).not.toContain('#lastCaptureLockEventId');
    expect(updateExpression).not.toContain('REMOVE #lastCaptureLockEventId');
  });

  it('does not remove last source event epoch when omitted in subsequent save', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-epoch-2',
      sessionIds: ['session-epoch-2'],
      lastSourceEventEpoch: 5,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-epoch-2',
      sessionIds: ['session-epoch-2'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z',
    });

    const secondUpdatePayload = mockUpdateCommand.mock.calls[1]?.[0];
    const updateExpression = String(secondUpdatePayload?.UpdateExpression);
    expect(updateExpression).not.toContain('#lastSourceEventEpoch');
    expect(updateExpression).not.toContain('REMOVE #lastSourceEventEpoch');
  });

  it('does not send unused capture lock placeholders when values are omitted', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-2',
      sessionIds: ['session-2'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const updatePayload = mockUpdateCommand.mock.calls[0]?.[0];
    expect(updatePayload?.ExpressionAttributeNames).not.toHaveProperty(
      '#lastCaptureLockEventId'
    );
    expect(updatePayload?.ExpressionAttributeNames).not.toHaveProperty(
      '#lastCaptureUnlockEventId'
    );
  });

  it('does not remove transfer mandate attempt mapping when omitted in subsequent save', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-transfer-map',
      sessionIds: ['session-transfer-map'],
      transferMandateAttemptsByHoldId: {
        'hold-1': {
          chargeAttemptId: 'attempt-1',
          mandateDocumentId: 'mandate-doc-1',
          mandateSessionId: 'mandate-session-1',
        },
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-transfer-map',
      sessionIds: ['session-transfer-map'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z',
    });

    const secondUpdatePayload = mockUpdateCommand.mock.calls[1]?.[0];
    const updateExpression = String(secondUpdatePayload?.UpdateExpression);
    expect(updateExpression).not.toContain('#transferMandateAttemptsByHoldId');
    expect(updateExpression).not.toContain(
      'REMOVE #transferMandateAttemptsByHoldId'
    );
  });

  it('stores compact blue payloads for document and events', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();
    const expandedPayload = buildResolvedPayload();

    await repository.savePayNote({
      payNoteDocumentId: 'paynote-doc-compact',
      sessionIds: ['session-compact'],
      document: expandedPayload as Record<string, unknown>,
      transactionRequest: [expandedPayload],
      triggerEvent: expandedPayload,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const updatePayload = mockUpdateCommand.mock.calls[0]?.[0];
    const document = updatePayload?.ExpressionAttributeValues?.[
      ':document'
    ] as Record<string, unknown>;
    const triggerEvent = updatePayload?.ExpressionAttributeValues?.[
      ':triggerEvent'
    ] as Record<string, unknown>;
    const transactionRequestRaw = updatePayload?.ExpressionAttributeValues?.[
      ':transactionRequest'
    ] as unknown;
    const transactionRequest = Array.isArray(transactionRequestRaw)
      ? (transactionRequestRaw as Array<Record<string, unknown>>)
      : Array.isArray(
          (transactionRequestRaw as { items?: unknown[] } | undefined)?.items
        )
      ? ((transactionRequestRaw as { items: unknown[] }).items as Array<
          Record<string, unknown>
        >)
      : [];

    expect((document.type as Record<string, unknown>)?.blueId).toBe(
      'type-root'
    );
    expect((triggerEvent.type as Record<string, unknown>)?.blueId).toBe(
      'type-root'
    );
    expect(
      (transactionRequest[0]?.type as Record<string, unknown>)?.blueId
    ).toBe('type-root');
  });

  it('marks paynote event idempotency claim as processing', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const firstClaim = await repository.markEventProcessed('evt-1');

    expect(firstClaim).toBe(true);
    const putPayload = mockPutCommand.mock.calls[0]?.[0];
    expect(putPayload?.Item?.status).toBe('processing');
    expect(putPayload?.Item?.ttl).toBeGreaterThanOrEqual(nowSeconds + 9 * 60);
    expect(putPayload?.Item?.ttl).toBeLessThanOrEqual(nowSeconds + 10 * 60 + 1);
  });

  it('finalizes paynote event processing by setting completed status', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();
    const nowSeconds = Math.floor(Date.now() / 1000);

    await repository.finalizeEventProcessing('evt-2');

    const updatePayload = mockUpdateCommand.mock.calls[0]?.[0];
    expect(updatePayload?.ExpressionAttributeValues?.[':completed']).toBe(
      'completed'
    );
    expect(updatePayload?.ExpressionAttributeValues?.[':ttl']).toBeGreaterThan(
      nowSeconds + 6 * 24 * 60 * 60
    );
  });

  it('returns event processing status for existing idempotency entries', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'EVENT#evt-lookup',
        SK: 'META',
        entityType: 'EVENT',
        eventId: 'evt-lookup',
        status: 'processing',
      },
    });
    const repository = createRepository();

    const status = await repository.getEventProcessingStatus('evt-lookup');

    expect(status).toBe('processing');
    const getPayload = mockGetCommand.mock.calls[0]?.[0];
    expect(getPayload?.ConsistentRead).toBe(true);
  });

  it('ignores finalize conditional failures for expired processing locks', async () => {
    mockSend.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });
    const repository = createRepository();

    await expect(
      repository.finalizeEventProcessing('evt-expired')
    ).resolves.toBeUndefined();
  });

  it('releases paynote event processing only when claim is still processing', async () => {
    mockSend.mockResolvedValue({});
    const repository = createRepository();

    await repository.releaseEventProcessing('evt-3');

    const deletePayload = mockDeleteCommand.mock.calls[0]?.[0];
    expect(deletePayload?.ConditionExpression).toBe('#status = :processing');
  });

  it('ignores release conditional failures for already-finalized events', async () => {
    mockSend.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });
    const repository = createRepository();

    await expect(
      repository.releaseEventProcessing('evt-4')
    ).resolves.toBeUndefined();
  });
});
