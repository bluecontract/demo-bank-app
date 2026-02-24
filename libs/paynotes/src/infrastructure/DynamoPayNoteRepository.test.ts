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
}));

const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
const mockUpdateCommand = vi.mocked(UpdateCommand);

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
});
