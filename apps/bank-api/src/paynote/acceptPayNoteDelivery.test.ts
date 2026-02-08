import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { acceptPayNoteDeliveryHandler } from './acceptPayNoteDelivery';
import type { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { ERROR_CODES } from '../shared/errors';

const hoisted = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
  runPayNoteDeliveryDecisionMock: vi.fn(),
}));

vi.mock('./dependencies', () => ({
  getDependencies: hoisted.getDependenciesMock,
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoisted.extractAuthInfoMock,
}));

vi.mock('./runPayNoteDeliveryDecision', () => ({
  runPayNoteDeliveryDecision: hoisted.runPayNoteDeliveryDecisionMock,
}));

describe('acceptPayNoteDeliveryHandler', () => {
  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    hoisted.runPayNoteDeliveryDecisionMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));

    hoisted.extractAuthInfoMock.mockResolvedValue({ userId: 'user-1' });

    hoisted.getDependenciesMock.mockResolvedValue({
      payNoteDeliveryRepository: {
        getDeliveryBySessionId: vi.fn().mockResolvedValue({
          deliveryId: 'delivery-1',
          deliveryDocumentId: 'delivery-doc-1',
          deliverySessionId: 'session-1',
          userId: 'user-1',
          transactionIdentificationStatus: 'identified',
          clientDecisionStatus: 'pending',
          createdAt: '2024-02-01T00:00:00.000Z',
          updatedAt: '2024-02-01T00:00:00.000Z',
        }),
        saveDelivery: vi.fn(),
      },
      myOsClient: {
        getCredentials: vi.fn(),
        runDocumentOperation: vi.fn(),
      },
      holdRepository: {
        disableHoldCapture: vi.fn(),
      },
      contractRepository: {
        getContractByDocumentId: vi.fn().mockResolvedValue({
          contractId: 'contract-1',
          sessionId: 'session-1',
          documentId: 'delivery-doc-1',
        }),
        saveContract: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds acceptedAt and forwards the request to the delivery decision handler', async () => {
    const expectedResponse = { status: 200, body: { ok: true } };
    hoisted.runPayNoteDeliveryDecisionMock.mockResolvedValue(expectedResponse);

    const response = await acceptPayNoteDeliveryHandler(
      {
        params: { sessionId: 'session-1' },
        body: { note: 'approved' },
      } as any,
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );

    expect(hoisted.runPayNoteDeliveryDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'acceptPayNote',
        contract: expect.objectContaining({
          contractId: 'contract-1',
          sessionId: 'session-1',
        }),
        requestBody: {
          note: 'approved',
          acceptedAt: '2024-02-01T00:00:00.000Z',
        },
      })
    );
    expect(response).toEqual(expectedResponse);
  });

  it('accepts non-object bodies and only passes acceptedAt', async () => {
    const expectedResponse = { status: 200, body: { ok: true } };
    hoisted.runPayNoteDeliveryDecisionMock.mockResolvedValue(expectedResponse);

    await acceptPayNoteDeliveryHandler(
      {
        params: { sessionId: 'session-1' },
        body: 'ignored',
      } as any,
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );

    expect(hoisted.runPayNoteDeliveryDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'acceptPayNote',
        contract: expect.objectContaining({
          contractId: 'contract-1',
          sessionId: 'session-1',
        }),
        requestBody: {
          acceptedAt: '2024-02-01T00:00:00.000Z',
        },
      })
    );
  });

  it('returns 409 when canonical contract is not ready', async () => {
    hoisted.getDependenciesMock.mockResolvedValueOnce({
      payNoteDeliveryRepository: {
        getDeliveryBySessionId: vi.fn().mockResolvedValue({
          deliveryId: 'delivery-1',
          deliveryDocumentId: 'delivery-doc-1',
          deliverySessionId: 'session-1',
          userId: 'user-1',
          transactionIdentificationStatus: 'identified',
          clientDecisionStatus: 'pending',
          createdAt: '2024-02-01T00:00:00.000Z',
          updatedAt: '2024-02-01T00:00:00.000Z',
        }),
        saveDelivery: vi.fn(),
      },
      myOsClient: {
        getCredentials: vi.fn(),
        runDocumentOperation: vi.fn(),
      },
      holdRepository: {
        disableHoldCapture: vi.fn(),
      },
      contractRepository: {
        getContractByDocumentId: vi.fn().mockResolvedValue(null),
        saveContract: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    const response = await acceptPayNoteDeliveryHandler(
      {
        params: { sessionId: 'session-1' },
        body: { note: 'approved' },
      } as any,
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(ERROR_CODES.CONTRACT_NOT_FOUND);
    expect(hoisted.runPayNoteDeliveryDecisionMock).not.toHaveBeenCalled();
  });

  it('returns 404 for non-canonical delivery session', async () => {
    hoisted.getDependenciesMock.mockResolvedValueOnce({
      payNoteDeliveryRepository: {
        getDeliveryBySessionId: vi.fn().mockResolvedValue({
          deliveryId: 'delivery-1',
          deliveryDocumentId: 'delivery-doc-1',
          deliverySessionId: 'session-canonical',
          deliverySessionIds: ['session-canonical', 'session-linked'],
          userId: 'user-1',
          transactionIdentificationStatus: 'identified',
          clientDecisionStatus: 'pending',
          createdAt: '2024-02-01T00:00:00.000Z',
          updatedAt: '2024-02-01T00:00:00.000Z',
        }),
        saveDelivery: vi.fn(),
      },
      myOsClient: {
        getCredentials: vi.fn(),
        runDocumentOperation: vi.fn(),
      },
      holdRepository: {
        disableHoldCapture: vi.fn(),
      },
      contractRepository: {
        getContractByDocumentId: vi.fn().mockResolvedValue({
          contractId: 'contract-1',
          sessionId: 'session-canonical',
          documentId: 'delivery-doc-1',
        }),
        saveContract: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    const response = await acceptPayNoteDeliveryHandler(
      {
        params: { sessionId: 'session-linked' },
        body: { note: 'approved' },
      } as any,
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND);
    expect(hoisted.runPayNoteDeliveryDecisionMock).not.toHaveBeenCalled();
  });
});
