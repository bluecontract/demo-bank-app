import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rejectPayNoteDeliveryHandler } from './rejectPayNoteDelivery';
import type { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';

const hoisted = vi.hoisted(() => ({
  runContractOperationHandlerMock: vi.fn(),
}));

vi.mock('../contracts/runContractOperation', () => ({
  runContractOperationHandler: hoisted.runContractOperationHandlerMock,
}));

describe('rejectPayNoteDeliveryHandler', () => {
  beforeEach(() => {
    hoisted.runContractOperationHandlerMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds rejectedAt and forwards reason to the contract operation handler', async () => {
    const expectedResponse = { status: 200, body: { ok: true } };
    hoisted.runContractOperationHandlerMock.mockResolvedValue(expectedResponse);

    const response = await rejectPayNoteDeliveryHandler(
      {
        params: { sessionId: 'session-1' },
        body: { reason: 'not needed' },
      } as any,
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );

    expect(hoisted.runContractOperationHandlerMock).toHaveBeenCalledWith(
      {
        params: {
          sessionId: 'session-1',
          operation: 'markPayNoteRejectedByClient',
        },
        body: {
          reason: 'not needed',
          rejectedAt: '2024-02-01T00:00:00.000Z',
        },
      },
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );
    expect(response).toEqual(expectedResponse);
  });

  it('omits reason when not provided', async () => {
    hoisted.runContractOperationHandlerMock.mockResolvedValue({
      status: 200,
      body: { ok: true },
    });

    await rejectPayNoteDeliveryHandler(
      {
        params: { sessionId: 'session-2' },
        body: undefined,
      } as any,
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );

    expect(hoisted.runContractOperationHandlerMock).toHaveBeenCalledWith(
      {
        params: {
          sessionId: 'session-2',
          operation: 'markPayNoteRejectedByClient',
        },
        body: {
          rejectedAt: '2024-02-01T00:00:00.000Z',
        },
      },
      { request: {} as MaybeAuthenticatedTsRestRequestContext }
    );
  });
});
