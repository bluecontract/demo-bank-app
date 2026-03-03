import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import type { MerchantDirectoryRepository } from '@demo-bank-app/auth';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';

const MERCHANT_LOOKUP_TOOL_NAME = 'resolve_merchant_names';
const MAX_MERCHANT_IDS_PER_CALL = 50;
const MAX_TOOL_ROUNDS = 4;

export type MerchantDirectoryLookupRepository = Pick<
  MerchantDirectoryRepository,
  'getMerchantsByIds'
>;

const MERCHANT_LOOKUP_TOOL = {
  type: 'function' as const,
  name: MERCHANT_LOOKUP_TOOL_NAME,
  description:
    'Resolve merchant IDs to merchant display names for customer-facing summaries.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      merchantIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: MAX_MERCHANT_IDS_PER_CALL,
      },
    },
    required: ['merchantIds'],
  },
};

const normalizeMerchantIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  value.forEach(item => {
    if (typeof item !== 'string') {
      return;
    }
    const trimmed = item.trim();
    if (trimmed) {
      unique.add(trimmed);
    }
  });

  return Array.from(unique).slice(0, MAX_MERCHANT_IDS_PER_CALL);
};

const extractMerchantIdsFromToolCall = (toolCall: {
  arguments: string;
  parsed_arguments?: unknown;
}): string[] => {
  if (
    toolCall.parsed_arguments &&
    typeof toolCall.parsed_arguments === 'object'
  ) {
    const parsed = toolCall.parsed_arguments as { merchantIds?: unknown };
    const fromParsed = normalizeMerchantIds(parsed.merchantIds);
    if (fromParsed.length) {
      return fromParsed;
    }
  }

  try {
    const parsed = JSON.parse(toolCall.arguments) as { merchantIds?: unknown };
    return normalizeMerchantIds(parsed.merchantIds);
  } catch {
    return [];
  }
};

const resolveMerchantNamesByIds = async (input: {
  merchantIds: string[];
  merchantDirectoryRepository: MerchantDirectoryLookupRepository;
  cache: Map<string, string | null>;
  logger?: PowertoolsLogger;
  logContext?: Record<string, unknown>;
}) => {
  const {
    merchantIds,
    merchantDirectoryRepository,
    cache,
    logger,
    logContext,
  } = input;

  const toLoad = merchantIds.filter(id => !cache.has(id));
  if (toLoad.length) {
    try {
      const entries = await merchantDirectoryRepository.getMerchantsByIds(
        toLoad
      );
      const namesById = new Map(
        entries.map(entry => [entry.merchantId, entry.name] as const)
      );
      toLoad.forEach(id => {
        cache.set(id, namesById.get(id) ?? null);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn?.('Merchant lookup tool call failed', {
        error: message,
        merchantIds: toLoad,
        ...logContext,
      });
      toLoad.forEach(id => cache.set(id, null));
    }
  }

  const merchantNamesById: Record<string, string | null> = {};
  const unresolvedMerchantIds: string[] = [];
  merchantIds.forEach(id => {
    const resolvedName = cache.get(id) ?? null;
    merchantNamesById[id] = resolvedName;
    if (!resolvedName) {
      unresolvedMerchantIds.push(id);
    }
  });

  return { merchantNamesById, unresolvedMerchantIds };
};

type OpenAiResponsesParseResult = Awaited<
  ReturnType<OpenAI['responses']['parse']>
>;

export const runStructuredSummaryWithMerchantLookup = async <
  TSchema extends z.ZodTypeAny
>(input: {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  facts: Record<string, unknown>;
  schema: TSchema;
  schemaName: string;
  timeoutMs: number;
  logger?: PowertoolsLogger;
  logContext?: Record<string, unknown>;
  merchantDirectoryRepository?: MerchantDirectoryLookupRepository;
}): Promise<OpenAiResponsesParseResult> => {
  const {
    client,
    model,
    systemPrompt,
    facts,
    schema,
    schemaName,
    timeoutMs,
    merchantDirectoryRepository,
    logger,
    logContext,
  } = input;

  const payload = `<facts>\n${JSON.stringify(facts)}\n</facts>`;
  const requestBase = {
    model,
    reasoning: { effort: 'minimal' as const },
    text: {
      format: zodTextFormat(schema, schemaName),
    },
  };

  let response = await client.responses.parse(
    {
      ...requestBase,
      input: [
        {
          role: 'system' as const,
          content: [{ type: 'input_text' as const, text: systemPrompt }],
        },
        {
          role: 'user' as const,
          content: [{ type: 'input_text' as const, text: payload }],
        },
      ],
      ...(merchantDirectoryRepository ? { tools: [MERCHANT_LOOKUP_TOOL] } : {}),
    },
    {
      timeout: timeoutMs,
      maxRetries: 0,
    }
  );

  if (!merchantDirectoryRepository) {
    return response;
  }

  if ((response as { output_parsed?: unknown }).output_parsed) {
    return response;
  }

  const cache = new Map<string, string | null>();
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const outputItems = Array.isArray(response.output) ? response.output : [];
    const toolCalls = outputItems.filter(
      item =>
        item.type === 'function_call' && item.name === MERCHANT_LOOKUP_TOOL_NAME
    ) as Array<
      OpenAI.Responses.ResponseFunctionToolCall & { parsed_arguments?: unknown }
    >;

    if (!toolCalls.length) {
      return response;
    }

    const toolOutputs = await Promise.all(
      toolCalls.map(async toolCall => {
        const merchantIds = extractMerchantIdsFromToolCall(toolCall);
        const lookupResult = merchantIds.length
          ? await resolveMerchantNamesByIds({
              merchantIds,
              merchantDirectoryRepository,
              cache,
              logger,
              logContext,
            })
          : { merchantNamesById: {}, unresolvedMerchantIds: [] };

        return {
          type: 'function_call_output' as const,
          call_id: toolCall.call_id,
          output: JSON.stringify(lookupResult),
        };
      })
    );

    response = await client.responses.parse(
      {
        ...requestBase,
        previous_response_id: response.id,
        input: toolOutputs,
        tools: [MERCHANT_LOOKUP_TOOL],
      },
      {
        timeout: timeoutMs,
        maxRetries: 0,
      }
    );
  }

  logger?.warn?.('Merchant lookup tool calling reached max rounds', {
    maxRounds: MAX_TOOL_ROUNDS,
    ...logContext,
  });
  return response;
};
