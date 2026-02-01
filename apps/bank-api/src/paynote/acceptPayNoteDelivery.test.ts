import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { acceptPayNoteDeliveryHandler } from './acceptPayNoteDelivery';
import type { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';

const hoisted = vi.hoisted(() => ({
  runContractOperationHandlerMock: vi.fn(),
}));

vi.mock('../contracts/runContractOperation', () => ({
  runContractOperationHandler: hoisted.runContractOperationHandlerMock,
}));

describe('acceptPayNoteDeliveryHandler', () => {
  beforeEach(() => {
    hoisted.runContractOperationHandlerMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds acceptedAt and forwards the request to the contract operation handler', async () => {
    const expectedResponse = { status: 200, body: { ok: true } };
    hoisted.runContractOperationHandlerMock.mockResolvedValue(expectedResponse);

    const response = await acceptPayNoteDeliveryHandler(
      {
        params: { sessionId: 'session-1' },
        body: { note: 'approved' },
      } as any,
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );

    expect(hoisted.runContractOperationHandlerMock).toHaveBeenCalledWith(
      {
        params: {
          sessionId: 'session-1',
          operation: 'markPayNoteAcceptedByClient',
        },
        body: {
          note: 'approved',
          acceptedAt: '2024-02-01T00:00:00.000Z',
        },
      },
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );
    expect(response).toEqual(expectedResponse);
  });

  it('accepts non-object bodies and only passes acceptedAt', async () => {
    const expectedResponse = { status: 200, body: { ok: true } };
    hoisted.runContractOperationHandlerMock.mockResolvedValue(expectedResponse);

    await acceptPayNoteDeliveryHandler(
      {
        params: { sessionId: 'session-2' },
        body: 'ignored',
      } as any,
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );

    expect(hoisted.runContractOperationHandlerMock).toHaveBeenCalledWith(
      {
        params: {
          sessionId: 'session-2',
          operation: 'markPayNoteAcceptedByClient',
        },
        body: {
          acceptedAt: '2024-02-01T00:00:00.000Z',
        },
      },
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );
  });
});
