import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as dependencies from './dependencies';
import * as banking from '@demo-bank-app/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { captureCardAuthorizationHandler } from './captureCardAuthorization';
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
  defaultMerchantCreditLimitMinor: 500_000,
};

const authHeaders = new Headers({ Authorization: 'Bearer processor-token' });

const baseRequest = {
  params: { authorizationId: 'hold-123' },
  body: { amountMinor: 1500 },
  headers: {
    'idempotency-key': 'idem-123',
  },
};

describe('captureCardAuthorizationHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: {} as any,
      contractRepository: {
        listContractsByHoldId: vi.fn().mockResolvedValue([]),
        getContract: vi.fn(),
        saveContract: vi.fn(),
      } as any,
      holdRepository: {
        getHold: vi.fn().mockResolvedValue(null),
      } as any,
      cardRepository: {} as any,
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

  it('returns captured response on success', async () => {
    vi.spyOn(banking, 'captureCardAuthorization').mockResolvedValue({
      status: 'CAPTURED',
      holdId: 'hold-123',
      transactionId: 'txn-123',
    } as any);

    const response = await captureCardAuthorizationHandler(baseRequest as any, {
      request: { headers: authHeaders },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'CAPTURED',
      authorizationId: 'hold-123',
      transactionId: 'txn-123',
    });

    const deps = await dependencies.getDependencies();
    expect(deps.contractRepository.listContractsByHoldId).toHaveBeenCalledWith(
      'hold-123'
    );
  });

  it('returns 400 when idempotency key missing', async () => {
    const response = await captureCardAuthorizationHandler(
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

  it('maps HoldNotFoundError to 404', async () => {
    vi.spyOn(banking, 'captureCardAuthorization').mockRejectedValueOnce(
      new banking.HoldNotFoundError('hold-123')
    );

    const response = await captureCardAuthorizationHandler(baseRequest as any, {
      request: { headers: authHeaders },
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: ERROR_CODES.AUTHORIZATION_NOT_FOUND,
      message: 'Authorization not found',
    });
  });

  it('maps HoldNotPendingError to 409', async () => {
    vi.spyOn(banking, 'captureCardAuthorization').mockRejectedValueOnce(
      new banking.HoldNotPendingError('hold-123', 'CAPTURED')
    );

    const response = await captureCardAuthorizationHandler(baseRequest as any, {
      request: { headers: authHeaders },
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: ERROR_CODES.AUTHORIZATION_NOT_PENDING,
      message: 'Hold hold-123 is not pending (status: CAPTURED)',
    });
  });

  it('maps HoldCaptureDisabledError to 409', async () => {
    vi.spyOn(banking, 'captureCardAuthorization').mockRejectedValueOnce(
      new banking.HoldCaptureDisabledError('hold-123')
    );

    const response = await captureCardAuthorizationHandler(baseRequest as any, {
      request: { headers: authHeaders },
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: ERROR_CODES.AUTHORIZATION_CAPTURE_DISABLED,
      message: 'Hold hold-123 capture is disabled',
    });
  });

  it('maps IdempotencyConflictError to 409', async () => {
    vi.spyOn(banking, 'captureCardAuthorization').mockRejectedValueOnce(
      new banking.IdempotencyConflictError('conflict')
    );

    const response = await captureCardAuthorizationHandler(baseRequest as any, {
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
      captureCardAuthorizationHandler(baseRequest as any, {
        request: { headers: new Headers() },
      })
    ).rejects.toBeInstanceOf(UnauthorizedRequestError);
  });
});
