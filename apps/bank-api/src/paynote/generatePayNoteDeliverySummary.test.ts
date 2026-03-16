import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generatePayNoteDeliverySummaryForSessionId,
  generatePayNoteDeliverySummaryHandler,
} from './generatePayNoteDeliverySummary';
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

const extractFactsFromFirstParseCall = (): Record<string, unknown> => {
  const parseCall = hoistedOpenAI.responsesParseMock.mock.calls[0];
  expect(parseCall).toBeDefined();
  const request = parseCall[0] as {
    input?: Array<{
      content?: Array<{ text?: string }>;
    }>;
  };
  const payload = request.input?.[1]?.content?.[0]?.text;
  expect(typeof payload).toBe('string');
  const match = (payload as string).match(/^<facts>\n?(.*)\n?<\/facts>$/s);
  expect(match?.[1]).toBeDefined();
  return JSON.parse(match![1]) as Record<string, unknown>;
};

describe('generatePayNoteDeliverySummaryHandler', () => {
  const payNoteTypeBlueId = paynoteBlueIds['PayNote/PayNote'];
  const summaryFixture = {
    story: {
      headline: 'PayNote',
      overview: ['A test PayNote proposal.'],
      bullets: ['Funds will be held until delivery is confirmed.'],
    },
    listPreview: 'PayNote proposal received.',
    nextSteps: {
      title: 'Next steps',
      items: ['Review and accept the proposal to proceed.'],
    },
    lastChange: {
      short: 'PayNote proposal received.',
      more: 'A new PayNote proposal is awaiting your decision.',
    },
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const getOpenAiApiKey = vi.fn().mockResolvedValue('api-key');
  const payNoteDeliveryRepository = {
    getDeliveryBySessionId: vi.fn(),
    updateDeliverySummary: vi.fn(),
  };
  const merchantDirectoryRepository = {
    getMerchantsByIds: vi.fn(),
  };

  beforeEach(() => {
    hoistedOpenAI.responsesParseMock.mockReset();
    hoistedDeps.getDependenciesMock.mockReset();
    hoistedDeps.extractAuthInfoMock.mockReset();
    payNoteDeliveryRepository.getDeliveryBySessionId.mockReset();
    payNoteDeliveryRepository.updateDeliverySummary.mockReset();
    merchantDirectoryRepository.getMerchantsByIds.mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
    getOpenAiApiKey.mockClear();
    merchantDirectoryRepository.getMerchantsByIds.mockResolvedValue([]);

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      getOpenAiApiKey,
      payNoteDeliveryRepository,
      merchantDirectoryRepository,
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

  it('returns 404 when summary is requested for a non-canonical session', async () => {
    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValue({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-canonical',
      deliverySessionIds: ['session-canonical', 'session-linked'],
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      deliveryDocument: {
        payNoteBootstrapRequest: {
          document: {
            type: { blueId: payNoteTypeBlueId },
            name: 'Test PayNote',
            contracts: {},
          },
        },
      },
      deliveryUpdatedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-linked' }, body: { force: true } } as any,
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
        story: {
          headline: 'PayNote',
          overview: ['A test PayNote proposal.'],
          bullets: [],
        },
        listPreview: 'PayNote proposal received.',
        nextSteps: {
          title: 'Next steps',
          items: ['Review and accept the proposal to proceed.'],
        },
        lastChange: {
          short: 'PayNote proposal received.',
          more: 'A new PayNote proposal is awaiting your decision.',
        },
      },
      summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
      summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      summaryModel: 'gpt-5',
    });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' }, body: { force: false } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(true);
    expect(result.body.summary.story.headline).toBe('PayNote');
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
    expect(
      payNoteDeliveryRepository.updateDeliverySummary
    ).not.toHaveBeenCalled();
  });

  it('generates a new summary when missing and forced', async () => {
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
      output_parsed: summaryFixture,
    });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' }, body: { force: true } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(false);
    expect(result.body.summary.story.headline).toBe('PayNote');
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalled();
    expect(getOpenAiApiKey).toHaveBeenCalled();
    expect(payNoteDeliveryRepository.updateDeliverySummary).toHaveBeenCalled();
  });

  it('overrides headline from payNote initial message while preserving LLM description', async () => {
    const payNoteDocument = {
      type: { blueId: payNoteTypeBlueId },
      name: 'Test PayNote',
      payNoteInitialStateDescription: {
        initialMessage: 'This is my limited offer for you',
      },
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
      output_parsed: summaryFixture,
    });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' }, body: { force: true } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(false);
    expect(result.body.summary.story.headline).toBe(
      'This is my limited offer for you'
    );
    expect(result.body.summary.listPreview).toBe('PayNote proposal received.');
    expect(result.body.summary.story.overview).toEqual(
      summaryFixture.story.overview
    );
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalled();
    expect(getOpenAiApiKey).toHaveBeenCalled();
    expect(
      payNoteDeliveryRepository.updateDeliverySummary
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        summaryError: null,
      })
    );
  });

  it('uses PayNote mock summary fields when LLM summary is disabled', async () => {
    const payNoteDocument = {
      type: { blueId: payNoteTypeBlueId },
      name: 'Mocked PayNote',
      LLM_SUMMARY_DISABLED: true,
      payNoteInitialStateDescription: {
        summary: 'Mock proposal summary',
        details: '## Detailed markdown text',
      },
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

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' }, body: { force: true } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.summary.story.headline).toBe('Mock proposal summary');
    expect(result.body.summary.story.overview).toEqual([
      'Mock proposal summary',
    ]);
    expect(result.body.summary.lastChange.short).toBe('Mock proposal summary');
    expect(result.body.summary.lastChange.more).toBe('Mock proposal summary');
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
    expect(
      payNoteDeliveryRepository.updateDeliverySummary
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        summaryError: null,
      })
    );
  });

  it('passes USD paynote amountDisplay as $x.xx', async () => {
    const payNoteDocument = {
      type: { blueId: payNoteTypeBlueId },
      name: 'Test PayNote',
      amount: { total: 500 },
      currency: 'USD',
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
      output_parsed: summaryFixture,
    });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' }, body: { force: true } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    const facts = extractFactsFromFirstParseCall();
    const payNoteSummary = facts.payNoteSummary as
      | Record<string, unknown>
      | undefined;
    expect(payNoteSummary?.amountDisplay).toBe('$5.00');
  });

  it('resolves merchant IDs via tool calling when requested by the model', async () => {
    const payNoteDocument = {
      type: { blueId: payNoteTypeBlueId },
      name: 'Demo Voucher CashBack',
      amount: { total: 500 },
      currency: 'USD',
      contracts: {},
    };

    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValueOnce({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      merchantId: 'merchant-1',
      deliveryDocument: {
        payNoteBootstrapRequest: {
          document: payNoteDocument,
        },
      },
      deliveryUpdatedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    merchantDirectoryRepository.getMerchantsByIds.mockResolvedValueOnce([
      {
        merchantId: 'merchant-1',
        name: 'Demo Restaurant',
      },
    ]);

    hoistedOpenAI.responsesParseMock
      .mockResolvedValueOnce({
        id: 'resp-tool-1',
        output: [
          {
            type: 'function_call',
            name: 'resolve_merchant_names',
            call_id: 'call-1',
            arguments: '{"merchantIds":["merchant-1"]}',
            parsed_arguments: {
              merchantIds: ['merchant-1'],
            },
          },
        ],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        id: 'resp-tool-2',
        output_parsed: summaryFixture,
        output: [],
      });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' }, body: { force: true } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalledTimes(2);
    expect(merchantDirectoryRepository.getMerchantsByIds).toHaveBeenCalledWith([
      'merchant-1',
    ]);

    const secondCallRequest = hoistedOpenAI.responsesParseMock.mock
      .calls[1]?.[0] as
      | {
          previous_response_id?: string;
          input?: Array<{
            type?: string;
            output?: string;
            call_id?: string;
          }>;
        }
      | undefined;
    expect(secondCallRequest?.previous_response_id).toBe('resp-tool-1');
    expect(secondCallRequest?.input?.[0]?.type).toBe('function_call_output');
    expect(secondCallRequest?.input?.[0]?.call_id).toBe('call-1');
    expect(secondCallRequest?.input?.[0]?.output).toContain('Demo Restaurant');
  });

  it('adds customer-facing recurring payment notes for subscription proposals', async () => {
    const payNoteDocument = {
      type: { blueId: payNoteTypeBlueId },
      name: 'Monthly $12.00 subscription with up to 12 charges',
      contracts: {},
    };

    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValueOnce({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      transactionId: 'txn-1',
      paymentMandateStatus: 'pending',
      merchantId: 'merchant-123',
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
      output_parsed: summaryFixture,
    });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' }, body: { force: true } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    const facts = extractFactsFromFirstParseCall();
    const contractFacts = facts.contract as Record<string, unknown> | undefined;
    expect(contractFacts?.transactionId).toBe('txn-1');
    expect(contractFacts?.paymentMandateStatus).toBe('pending');
    expect(contractFacts?.merchantId).toBe('merchant-123');

    const integrationNotes = facts.integrationNotes as string[] | undefined;
    expect(integrationNotes).toEqual(expect.any(Array));
    expect(
      integrationNotes?.some(note =>
        note.includes('finalize the current card purchase')
      )
    ).toBe(true);
    expect(
      integrationNotes?.some(note => note.includes('future recurring charges'))
    ).toBe(true);
  });

  it('adds cashback and monitoring consent notes for voucher proposals', async () => {
    const payNoteDocument = {
      type: { blueId: payNoteTypeBlueId },
      name: 'Demo Voucher CashBack',
      amount: { total: 500 },
      currency: 'USD',
      monitoringSubscriptions: [
        { subscriptionId: 'card-monitoring:merchant-1' },
      ],
      contracts: {},
    };

    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValueOnce({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      transactionId: 'txn-1',
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
      output_parsed: summaryFixture,
    });

    const result = await generatePayNoteDeliverySummaryHandler(
      { params: { sessionId: 'session-1' }, body: { force: true } } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    const facts = extractFactsFromFirstParseCall();
    const integrationNotes = facts.integrationNotes as string[] | undefined;
    expect(integrationNotes).toEqual(expect.any(Array));
    expect(integrationNotes?.some(note => note.includes('secures $5.00'))).toBe(
      true
    );
    expect(
      integrationNotes?.some(note =>
        note.includes('consent to monitor eligible card payments')
      )
    ).toBe(true);
  });

  it('regenerates summary when source epoch changed', async () => {
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
      deliveryEpoch: 1,
      deliveryDocument: {
        payNoteBootstrapRequest: {
          document: payNoteDocument,
        },
      },
      deliveryUpdatedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      summary: summaryFixture,
      summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
      summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      summarySourceEpoch: 0,
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generatePayNoteDeliverySummaryForSessionId({
      sessionId: 'session-1',
      force: false,
      payNoteDeliveryRepository: payNoteDeliveryRepository as any,
      getOpenAiApiKey,
      logger: logger as any,
    });

    expect(result).not.toBeNull();
    expect(result?.cached).toBe(false);
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalled();
    expect(
      payNoteDeliveryRepository.updateDeliverySummary
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        summarySourceEpoch: 1,
      })
    );
  });

  it('skips worker summary generation for non-canonical sessions', async () => {
    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValueOnce({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-canonical',
      deliverySessionIds: ['session-canonical', 'session-linked'],
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      deliveryDocument: {
        payNoteBootstrapRequest: {
          document: {
            type: { blueId: payNoteTypeBlueId },
            name: 'Test PayNote',
            contracts: {},
          },
        },
      },
      deliveryUpdatedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await generatePayNoteDeliverySummaryForSessionId({
      sessionId: 'session-linked',
      force: true,
      payNoteDeliveryRepository: payNoteDeliveryRepository as any,
      getOpenAiApiKey,
      logger: logger as any,
    });

    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      'PayNote proposal summary skipped (non-canonical session)',
      expect.objectContaining({
        sessionId: 'session-linked',
        canonicalSessionId: 'session-canonical',
        deliveryId: 'delivery-1',
      })
    );
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
  });
});
