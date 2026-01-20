import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as dependencies from './dependencies';
import * as banking from '@demo-bank-app/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { authorizeCardHandler } from './authorizeCard';
import { ERROR_CODES } from '../shared/errors';
import { UnauthorizedRequestError } from '../auth/errors';

const mockLogger: PowertoolsLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  addContext: vi.fn(),
  setCorrelationId: vi.fn(),
} as any;

const mockMetrics = {
  addMetric: vi.fn(),
  addMetadata: vi.fn(),
  publishStoredMetrics: vi.fn(),
  setDefaultDimensions: vi.fn(),
} as unknown as PowertoolsMetrics;

const mockConfig = {
  cardConfig: {
    cardBinPrefix: '123456',
    cardProcessorToken: 'processor-token',
  },
};

const authHeaders = new Headers({ Authorization: 'Bearer processor-token' });

const baseRequest = {
  body: {
    pan: '1234567890123456',
    expiryMonth: 12,
    expiryYear: 2030,
    cvc: '123',
    amountMinor: 1500,
    currency: 'USD',
    merchant: { name: 'Demo Shop' },
    processorChargeId: 'ch_123',
    description: 'Demo purchase',
  },
  headers: {
    'idempotency-key': 'idem-123',
  },
};

describe('authorizeCardHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: {} as any,
      cardRepository: {} as any,
      holdRepository: {} as any,
      cardHasher: {} as any,
      accountNumberGenerator: {} as any,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns approved authorization result', async () => {
    vi.spyOn(banking, 'authorizeCard').mockResolvedValue({
      status: 'APPROVED',
      hold: {
        holdId: 'hold-123',
        cardTransactionDetails: {
          retrievalReferenceNumber: '123456789012',
          systemTraceAuditNumber: '654321',
          transmissionDateTime: '0624153045',
          authorizationCode: 'A1B2C3',
        },
      },
      card: { cardId: 'card-123', accountNumber: '1234567890' },
    } as any);

    const response = await authorizeCardHandler(baseRequest as any, {
      request: { headers: authHeaders },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'APPROVED',
      authorizationId: 'hold-123',
      cardId: 'card-123',
      accountNumber: '1234567890',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0624153045',
        authorizationCode: 'A1B2C3',
      },
    });
  });

  it('returns declined authorization result', async () => {
    vi.spyOn(banking, 'authorizeCard').mockResolvedValue({
      status: 'DECLINED',
      declineCode: 'invalid_cvc',
      message: 'Invalid CVC',
    } as any);

    const response = await authorizeCardHandler(baseRequest as any, {
      request: { headers: authHeaders },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'DECLINED',
      declineCode: 'invalid_cvc',
      message: 'Invalid CVC',
    });
  });

  it('returns 400 when idempotency key missing', async () => {
    const response = await authorizeCardHandler(
      {
        ...baseRequest,
        headers: {},
      } as any,
      { request: { headers: authHeaders } }
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: ERROR_CODES.MISSING_IDEMPOTENCY_KEY,
      message: 'Idempotency-Key header is required',
    });
  });

  it('returns 409 for idempotency conflict', async () => {
    vi.spyOn(banking, 'authorizeCard').mockRejectedValueOnce(
      new banking.IdempotencyConflictError('conflict')
    );

    const response = await authorizeCardHandler(baseRequest as any, {
      request: { headers: authHeaders },
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: ERROR_CODES.IDEMPOTENCY_CONFLICT,
      message: 'conflict',
    });
  });

  it('rejects requests without processor auth', async () => {
    await expect(
      authorizeCardHandler(baseRequest as any, {
        request: { headers: new Headers() },
      })
    ).rejects.toBeInstanceOf(UnauthorizedRequestError);
  });
});
