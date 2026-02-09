import { ServerInferRequest } from '@ts-rest/core';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { dump as yamlDump } from 'js-yaml';
import {
  bankApiContract,
  blue,
  ContractAiChatResponseDto,
  collectContractOperations,
  buildRequestModel,
  getSupportedContractByTypeBlueId,
  resolveContractChannelKeys,
} from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { buildContractAiChatPrompt } from './aiChatPrompts';

const DEFAULT_MODEL = 'gpt-5';
const CHAT_TIMEOUT_MS = Number(
  process.env.CONTRACT_AI_CHAT_TIMEOUT_MS ?? '45000'
);
const CHAT_TIMEOUT = Number.isFinite(CHAT_TIMEOUT_MS) ? CHAT_TIMEOUT_MS : 45000;

const SYSTEM_PROMPT = buildContractAiChatPrompt();

const formatYaml = (value: unknown) => {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return yamlDump(value, { noRefs: true }).trimEnd();
  } catch {
    return '';
  }
};

const extractDocumentName = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = (value as { name?: unknown }).name;
  if (typeof name !== 'string') {
    return null;
  }

  const trimmed = name.trim();
  return trimmed ? trimmed : null;
};

export const contractAiChatHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['contractAiChat']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, logger, getOpenAiApiKey } =
    await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;

  const contract = await contractRepository.getContractBySessionId(sessionId);

  if (!contract || contract.userId !== userId) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract not found',
    });
  }

  const supportedContract = getSupportedContractByTypeBlueId(
    contract.typeBlueId
  );

  if (!supportedContract) {
    return problemResponse({
      status: 400,
      code: ERROR_CODES.UNSUPPORTED_CONTRACT_TYPE,
      message: 'Unsupported contract type',
    });
  }

  if (!contract.document) {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Contract document is missing',
    });
  }

  const channels = resolveContractChannelKeys({
    supportedContract,
    customerChannelKey: contract.customerChannelKey,
    accountNumber: contract.accountNumber,
    document: contract.document,
  });
  const operationsChannelKey = channels.operationsChannelKey;
  const operations = collectContractOperations({
    document: contract.document,
    operationsChannelKey,
    blue,
  });
  const filteredOperations =
    supportedContract.typeName === 'PayNote/PayNote Delivery'
      ? operations.filter(operation =>
          ['acceptPayNote', 'rejectPayNote'].includes(operation.name)
        )
      : operations;

  const eligibleOperationKeys = new Set(filteredOperations.map(op => op.name));

  const operationsContext = filteredOperations.map(operation => ({
    key: operation.name,
    label: operation.label,
    description: operation.description ?? null,
    requestModel: operation.request
      ? buildRequestModel(operation.request, blue, 'Request')
      : null,
  }));

  const documentName =
    extractDocumentName(contract.document) ??
    contract.displayName ??
    'Contract';

  const contextPayload = {
    actorChannel: operationsChannelKey,
    eligibleOperations: operationsContext,
    sessionId,
    documentName,
    contract: {
      contractId: contract.contractId,
      typeBlueId: contract.typeBlueId,
      displayName: contract.displayName,
      status: contract.status ?? null,
      updatedAt: contract.updatedAt,
    },
    documentYaml: formatYaml(contract.document),
  };

  try {
    const apiKey = await getOpenAiApiKey();
    const client = new OpenAI({ apiKey });
    const model = process.env.CONTRACT_AI_CHAT_MODEL?.trim() || DEFAULT_MODEL;

    const response = await client.responses.parse(
      {
        model,
        reasoning: { effort: 'minimal' },
        input: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: `<context>\n${JSON.stringify(contextPayload)}\n</context>`,
          },
          ...request.body.messages.map(message => ({
            role: message.role,
            content: message.content,
          })),
        ],
        text: {
          format: zodTextFormat(ContractAiChatResponseDto, 'ContractAiChat'),
        },
      },
      { timeout: CHAT_TIMEOUT, maxRetries: 0 }
    );

    const parsed = (response as { output_parsed?: unknown }).output_parsed;
    const result = ContractAiChatResponseDto.safeParse(parsed);
    if (!result.success) {
      logger.error('AI chat response failed schema validation', {
        sessionId,
        issues: result.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return problemResponse({
        status: 500,
        code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
        message: 'AI chat response was invalid',
      });
    }

    const normalizeOutput = (
      output: typeof result.data
    ): typeof result.data => {
      if (output.status !== 'ready') {
        return {
          ...output,
          nextProcessingState:
            output.status === 'needs_more_info' ? 'collect' : 'none',
          operationRequest: null,
        };
      }

      if (!output.operationRequest) {
        return {
          assistantMessage:
            'I could not identify the requested operation. Ask “What ops can I do?” to see the eligible operations.',
          status: 'needs_more_info',
          nextProcessingState: 'collect',
          focus: null,
          operationRequest: null,
        };
      }

      return output;
    };

    let safeOutput = normalizeOutput(result.data);

    if (safeOutput.status === 'ready') {
      const operationRequest = safeOutput.operationRequest;
      if (!operationRequest) {
        safeOutput = {
          assistantMessage:
            'I could not identify the requested operation. Ask “What ops can I do?” to see the eligible operations.',
          status: 'needs_more_info',
          nextProcessingState: 'collect',
          focus: null,
          operationRequest: null,
        };
      } else if (!eligibleOperationKeys.has(operationRequest.operation)) {
        safeOutput = {
          assistantMessage:
            'That action is not available for this contract. Ask “What ops can I do?” to see the eligible operations.',
          status: 'cannot_do',
          nextProcessingState: 'none',
          focus: null,
          operationRequest: null,
        };
      }
    }

    return {
      status: 200 as const,
      body: safeOutput,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate AI chat response', {
      sessionId,
      error: message,
    });
    return problemResponse({
      status: 500,
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      message: 'Failed to generate AI chat response',
    });
  }
};
