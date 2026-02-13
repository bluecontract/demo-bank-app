import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideContractPendingActionHandler } from './decideContractPendingAction';
import { ERROR_CODES } from '../shared/errors';

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

describe('decideContractPendingActionHandler', () => {
  const contractRepository = {
    getContractBySessionId: vi.fn(),
    saveContract: vi.fn(),
    addContractHistoryEntry: vi.fn(),
  };

  const myOsClient = {
    getCredentials: vi.fn(),
    bootstrapDocument: vi.fn(),
    fetchDocument: vi.fn(),
    runDocumentOperation: vi.fn(),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    contractRepository.getContractBySessionId.mockReset();
    contractRepository.saveContract.mockReset();
    contractRepository.addContractHistoryEntry.mockReset();
    myOsClient.getCredentials.mockReset();
    myOsClient.bootstrapDocument.mockReset();
    myOsClient.fetchDocument.mockReset();
    myOsClient.runDocumentOperation.mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      contractRepository,
      myOsClient,
      logger,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('accepts monitoring pending action and reports decision via guarantorUpdate', async () => {
    contractRepository.getContractBySessionId.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      userId: 'user-1',
      pendingActions: [
        {
          actionId: 'card-monitoring:merchant-1:consent',
          type: 'monitoringConsentApproval',
          status: 'pending',
          title: 'Allow card transaction monitoring',
          targetMerchantId: 'merchant-1',
          requestedEvents: ['transaction'],
          requestId: 'request-1',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      monitoringSubscriptions: [
        {
          subscriptionId: 'card-monitoring:merchant-1',
          targetMerchantId: 'merchant-1',
          requestedEvents: ['transaction'],
          status: 'pending',
          pendingActionId: 'card-monitoring:merchant-1:consent',
          requestId: 'request-1',
          requestEventId: 'event-1',
          requestEventIndex: 0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    myOsClient.getCredentials.mockResolvedValue({
      apiKey: 'key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.local',
    });
    myOsClient.runDocumentOperation.mockResolvedValue({
      ok: true,
      status: 200,
      body: {},
    });
    myOsClient.bootstrapDocument.mockResolvedValue({
      ok: true,
      status: 200,
      body: { sessionId: 'bootstrap-session-1' },
    });
    myOsClient.fetchDocument.mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {},
      },
    });

    const response = await decideContractPendingActionHandler(
      {
        params: {
          sessionId: 'session-1',
          actionId: 'card-monitoring:merchant-1:consent',
        },
        body: {
          decision: 'accepted',
        },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      myosStatus: 200,
    });
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            actionId: 'card-monitoring:merchant-1:consent',
            status: 'accepted',
          }),
        ]),
        monitoringSubscriptions: expect.arrayContaining([
          expect.objectContaining({
            subscriptionId: 'card-monitoring:merchant-1',
            status: 'active',
          }),
        ]),
      })
    );
  });

  it('returns 409 when pending action cannot be decided', async () => {
    contractRepository.getContractBySessionId.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      userId: 'user-1',
      pendingActions: [],
      monitoringSubscriptions: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const response = await decideContractPendingActionHandler(
      {
        params: {
          sessionId: 'session-1',
          actionId: 'missing-action',
        },
        body: {
          decision: 'accepted',
        },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  it('accepts charge mandate pending action and emits card charge response', async () => {
    contractRepository.getContractBySessionId.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      userId: 'user-1',
      merchantId: 'merchant-1',
      pendingActions: [
        {
          actionId: 'card-charge-mandate:event-1:0',
          type: 'chargeMandateApproval',
          status: 'pending',
          title: 'Approve payment mandate',
          requestId: 'charge-request-1',
          payload: {
            amountMinor: 2500,
            direction: 'linked',
          },
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    myOsClient.getCredentials.mockResolvedValue({
      apiKey: 'key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.local',
    });
    myOsClient.bootstrapDocument.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        sessionId: 'mandate-session-1',
      },
    });
    myOsClient.fetchDocument.mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'mandate-doc-1',
        sessionId: 'mandate-session-1',
        document: {
          type: 'PayNote/Payment Mandate',
        },
      },
    });
    myOsClient.runDocumentOperation.mockResolvedValue({
      ok: true,
      status: 200,
      body: {},
    });

    const response = await decideContractPendingActionHandler(
      {
        params: {
          sessionId: 'session-1',
          actionId: 'card-charge-mandate:event-1:0',
        },
        body: {
          decision: 'accepted',
        },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          document: expect.objectContaining({
            type: 'PayNote/Payment Mandate',
            granterType: 'customer',
            granteeType: 'documentId',
            granteeId: 'doc-1',
            amountLimit: 2500,
          }),
        }),
      })
    );
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            actionId: 'card-charge-mandate:event-1:0',
            type: 'chargeMandateApproval',
            status: 'accepted',
          }),
        ]),
      })
    );
  });

  it('rejects charge mandate pending action and emits rejected card charge response', async () => {
    contractRepository.getContractBySessionId.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      userId: 'user-1',
      merchantId: 'merchant-1',
      pendingActions: [
        {
          actionId: 'card-charge-mandate:event-1:0',
          type: 'chargeMandateApproval',
          status: 'pending',
          title: 'Approve payment mandate',
          requestId: 'charge-request-1',
          payload: {
            amountMinor: 2500,
            direction: 'reverse',
          },
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    myOsClient.getCredentials.mockResolvedValue({
      apiKey: 'key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.local',
    });
    myOsClient.runDocumentOperation.mockResolvedValue({
      ok: true,
      status: 200,
      body: {},
    });

    const response = await decideContractPendingActionHandler(
      {
        params: {
          sessionId: 'session-1',
          actionId: 'card-charge-mandate:event-1:0',
        },
        body: {
          decision: 'rejected',
        },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            actionId: 'card-charge-mandate:event-1:0',
            type: 'chargeMandateApproval',
            status: 'rejected',
          }),
        ]),
      })
    );
  });
});
