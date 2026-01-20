import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runContractOperationHandler } from './runContractOperation';
import { ERROR_CODES } from '../shared/errors';
import { blue } from '@demo-bank-app/paynotes';

const hoisted = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

vi.mock('../paynote/dependencies', () => ({
  getDependencies: hoisted.getDependenciesMock,
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoisted.extractAuthInfoMock,
}));

const buildPayNotePayload = () => {
  const yaml = `name: Demo PayNote
currency: USD
amount:
  total: 12500
`;
  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ name: 'PayNote/PayNote' }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

describe('runContractOperationHandler', () => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
  };

  const payNoteDeliveryRepository = {
    getDeliveryBySessionId: vi.fn(),
    saveDelivery: vi.fn(),
  };

  const myOsClient = {
    getCredentials: vi.fn(),
    runDocumentOperation: vi.fn(),
    bootstrapDocument: vi.fn(),
  };

  const holdRepository = {
    disableHoldCapture: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T12:00:00.000Z'));

    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.error.mockReset();
    logger.warn.mockReset();
    payNoteDeliveryRepository.getDeliveryBySessionId.mockReset();
    payNoteDeliveryRepository.saveDelivery.mockReset();
    myOsClient.getCredentials.mockReset();
    myOsClient.runDocumentOperation.mockReset();
    myOsClient.bootstrapDocument.mockReset();
    holdRepository.disableHoldCapture.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      payNoteDeliveryRepository,
      myOsClient,
      holdRepository,
      logger,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a delivery, disables capture, and bootstraps the paynote', async () => {
    const payNotePayload = buildPayNotePayload();

    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValue({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      clientDecisionStatus: 'pending',
      holdId: 'hold-1',
      deliveryDocument: {
        payNote: payNotePayload,
      },
      createdAt: '2024-02-01T10:00:00.000Z',
      updatedAt: '2024-02-01T10:00:00.000Z',
    });

    myOsClient.getCredentials.mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.example.com',
    });
    myOsClient.runDocumentOperation.mockResolvedValue({
      ok: true,
      status: 200,
    });
    myOsClient.bootstrapDocument.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const response = await runContractOperationHandler(
      {
        params: {
          sessionId: 'session-1',
          operation: 'markPayNoteAcceptedByClient',
        },
        body: {},
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'markPayNoteAcceptedByClient',
        payload: expect.objectContaining({
          acceptedAt: '2024-02-01T12:00:00.000Z',
        }),
      })
    );
    expect(holdRepository.disableHoldCapture).toHaveBeenCalledWith('hold-1');
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          document: expect.any(Object),
        }),
      })
    );
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        clientDecisionStatus: 'accepted',
        decisionRecordedAt: '2024-02-01T12:00:00.000Z',
        payNoteBootstrapRequestedAt: '2024-02-01T12:00:00.000Z',
      })
    );
  });

  it('rejects when delivery is already decided', async () => {
    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValue({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      clientDecisionStatus: 'accepted',
      createdAt: '2024-02-01T10:00:00.000Z',
      updatedAt: '2024-02-01T10:00:00.000Z',
    });

    const response = await runContractOperationHandler(
      {
        params: {
          sessionId: 'session-1',
          operation: 'markPayNoteRejectedByClient',
        },
        body: {},
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(
      ERROR_CODES.PAYNOTE_DELIVERY_DECISION_ALREADY_RECORDED
    );
    expect(myOsClient.runDocumentOperation).not.toHaveBeenCalled();
  });
});
