import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executePayNoteWebhook } from '../webhook';
import type { PaynoteDependencies } from '../../dependencies';

const hoistedMocks = vi.hoisted(() => ({
  handleWebhookEventMock: vi.fn(),
}));

vi.mock('@demo-bank-app/paynotes', () => ({
  handleWebhookEvent: hoistedMocks.handleWebhookEventMock,
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

describe('executePayNoteWebhook', () => {
  beforeEach(() => {
    hoistedMocks.handleWebhookEventMock.mockReset();
  });

  it('returns ok response when payload lacks id', async () => {
    const dependencies = createDependencies();

    const response = await executePayNoteWebhook({
      request: { body: {} } as any,
      dependencies,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      note: 'PayNote webhook received payload without valid id',
    });
    expect(dependencies.logger.error).toHaveBeenCalled();
    expect(hoistedMocks.handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('forwards handleWebhookEvent results', async () => {
    const dependencies = createDependencies();
    hoistedMocks.handleWebhookEventMock.mockResolvedValueOnce({
      note: undefined,
      logs: [
        { level: 'info', message: 'Processed', context: { id: 'event-1' } },
      ],
    });

    const response = await executePayNoteWebhook({
      request: { body: { id: 'event-1' } } as any,
      dependencies,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(dependencies.logger.info).toHaveBeenCalledWith('Processed', {
      id: 'event-1',
    });
    expect(hoistedMocks.handleWebhookEventMock).toHaveBeenCalledWith(
      { eventId: 'event-1' },
      expect.objectContaining({
        myOsClient: dependencies.myOsClient,
        bankingFacade: dependencies.bankingFacade,
      })
    );
  });
});
