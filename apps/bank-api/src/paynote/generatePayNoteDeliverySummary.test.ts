import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePayNoteDeliverySummaryHandler } from './generatePayNoteDeliverySummary';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import { ERROR_CODES } from '../shared/errors';

const hoistedOpenAI = vi.hoisted(() => {
  const responsesParseMock = vi.fn();

  class OpenAIStub {
    public responses = {
      parse: responsesParseMock,
    };

    constructor(public readonly options: { apiKey: string }) {}
  }

  return { responsesParseMock, OpenAIStub };
});

vi.mock('openai', () => ({
  default: hoistedOpenAI.OpenAIStub,
}));

const hoistedDeps = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

vi.mock('./dependencies', () => ({
  getDependencies: hoistedDeps.getDependenciesMock,
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoistedDeps.extractAuthInfoMock,
}));

describe('generatePayNoteDeliverySummaryHandler', () => {
  const payNoteTypeBlueId = paynoteBlueIds['PayNote/PayNote'];
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const getOpenAiApiKey = vi.fn().mockResolvedValue('api-key');
  const payNoteDeliveryRepository = {
    getDeliveryBySessionId: vi.fn(),
    updateDeliverySummary: vi.fn(),
  };

  beforeEach(() => {
    hoistedOpenAI.responsesParseMock.mockReset();
    hoistedDeps.getDependenciesMock.mockReset();
    hoistedDeps.extractAuthInfoMock.mockReset();
    payNoteDeliveryRepository.getDeliveryBySessionId.mockReset();
    payNoteDeliveryRepository.updateDeliverySummary.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
    getOpenAiApiKey.mockClear();

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      getOpenAiApiKey,
      payNoteDeliveryRepository,
    });

    hoistedDeps.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns 404 when delivery is missing or not visible', async () => {
    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValue(null);

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(404);
    expect(result.body.error).toBe(ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND);
  });

  it('returns cached summary when present and fresh', async () => {
    const payNoteDocument = {
      type: { blueId: payNoteTypeBlueId },
      name: 'Test PayNote',
      contracts: {},
    };

    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValueOnce({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      deliveryDocument: {
        payNoteBootstrapRequest: {
          document: payNoteDocument,
        },
      },
      deliveryUpdatedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      summary: {
        title: 'PayNote',
        oneLiner: 'A test PayNote.',
        state: {
          statusLabel: 'Pending',
          explanation: 'Pending review.',
          updatedAt: null,
        },
        keyFacts: [],
        warnings: [],
      },
      summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
      summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      summaryModel: 'gpt-5',
    });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(true);
    expect(result.body.summary.title).toBe('PayNote');
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
    expect(
      payNoteDeliveryRepository.updateDeliverySummary
    ).not.toHaveBeenCalled();
  });

  it('generates a new summary when missing', async () => {
    const payNoteDocument = {
      type: { blueId: payNoteTypeBlueId },
      name: 'Test PayNote',
      contracts: {},
    };

    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValueOnce({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      deliveryDocument: {
        payNoteBootstrapRequest: {
          document: payNoteDocument,
        },
      },
      deliveryUpdatedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: {
        title: 'PayNote',
        oneLiner: 'A test PayNote.',
        state: {
          statusLabel: 'Pending',
          explanation: 'Pending review.',
          updatedAt: null,
        },
        keyFacts: [],
        warnings: [],
      },
    });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(false);
    expect(result.body.summary.title).toBe('PayNote');
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalled();
    expect(getOpenAiApiKey).toHaveBeenCalled();
    expect(payNoteDeliveryRepository.updateDeliverySummary).toHaveBeenCalled();
  });
});
