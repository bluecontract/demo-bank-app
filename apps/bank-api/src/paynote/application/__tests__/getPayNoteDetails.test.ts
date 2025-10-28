import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeGetPayNoteDetails } from '../getPayNoteDetails';
import type { PaynoteDependencies } from '../../dependencies';

const hoistedMocks = vi.hoisted(() => ({
  getPayNoteDetailsMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

vi.mock('../../../auth/middleware', () => ({
  extractAuthInfo: hoistedMocks.extractAuthInfoMock,
}));

vi.mock('@demo-bank-app/paynotes', () => ({
  getPayNoteDetails: hoistedMocks.getPayNoteDetailsMock,
}));

const createDependencies = (): PaynoteDependencies => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any,
  getOpenAiApiKey: vi.fn(),
  getMyOsCredentials: vi.fn(),
  payNoteVerificationRepository: {} as any,
  bankingRepository: {} as any,
  holdRepository: {} as any,
  myOsClient: {} as any,
  bankingFacade: {} as any,
  blueIdCalculator: {
    fromYaml: vi.fn(),
    fromObject: vi.fn(),
    toReversedJson: vi.fn(),
  },
  clock: { now: () => new Date() },
  idGenerator: { generate: vi.fn() },
});

describe('executeGetPayNoteDetails', () => {
  const request = {
    params: {
      accountNumber: '1234567890',
      myosEventId: 'event-1',
    },
  } as any;

  const context = { request: {} as any };

  beforeEach(() => {
    hoistedMocks.getPayNoteDetailsMock.mockReset();
    hoistedMocks.extractAuthInfoMock.mockReset();
    hoistedMocks.extractAuthInfoMock.mockResolvedValue({ userId: 'user-123' });
  });

  it('returns 404 when account is not found', async () => {
    const dependencies = createDependencies();
    hoistedMocks.getPayNoteDetailsMock.mockResolvedValueOnce({
      type: 'account-not-found',
      logs: [],
    });

    const response = await executeGetPayNoteDetails({
      request,
      context,
      dependencies,
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ACCOUNT_NOT_FOUND');
  });

  it('returns success payload when details resolved', async () => {
    const dependencies = createDependencies();
    hoistedMocks.getPayNoteDetailsMock.mockResolvedValueOnce({
      type: 'success',
      logs: [
        { level: 'info', message: 'Done', context: { eventId: 'event-1' } },
      ],
      detail: {
        myosEventId: 'event-1',
      },
    });

    const response = await executeGetPayNoteDetails({
      request,
      context,
      dependencies,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ myosEventId: 'event-1' });
    expect(dependencies.logger.info).toHaveBeenCalledWith('Done', {
      eventId: 'event-1',
    });
    expect(hoistedMocks.getPayNoteDetailsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: '1234567890',
        userId: 'user-123',
      }),
      expect.objectContaining({
        blueIdCalculator: dependencies.blueIdCalculator,
        clock: dependencies.clock,
      })
    );
  });
});
