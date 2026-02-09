import type {
  ContractDocumentSummary,
  ContractSummarySnapshot,
  ContractSummaryUpdate,
} from '../application/ports';

const normalizeSummaryText = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const resolveSummaryPreview = (
  summary?: ContractDocumentSummary | null,
  fallbackPreview?: string | null
): string | undefined =>
  normalizeSummaryText(summary?.story?.headline) ??
  normalizeSummaryText(summary?.lastChange?.short) ??
  normalizeSummaryText(summary?.listPreview) ??
  normalizeSummaryText(fallbackPreview);

const isFiniteInteger = (value: number) =>
  Number.isFinite(value) && Math.floor(value) === value;

const assertValidSummarySource = (update: ContractSummaryUpdate) => {
  if (
    typeof update.summarySourceUpdatedAt !== 'string' ||
    update.summarySourceUpdatedAt.trim().length === 0
  ) {
    throw new Error(
      'updateContractSummary requires non-empty summarySourceUpdatedAt'
    );
  }

  const parsed = Date.parse(update.summarySourceUpdatedAt);
  if (Number.isNaN(parsed)) {
    throw new Error(
      'updateContractSummary requires valid ISO summarySourceUpdatedAt'
    );
  }

  if (!isFiniteInteger(update.summarySourceEpoch)) {
    throw new Error('updateContractSummary requires finite summarySourceEpoch');
  }
};

const MONOTONIC_CONDITION_EXPRESSION = [
  'attribute_exists(#pk)',
  'AND (',
  '(attribute_not_exists(#currentSummarySourceEpoch)',
  'AND (attribute_not_exists(#currentSummarySourceUpdatedAt)',
  'OR #currentSummarySourceUpdatedAt <= :incomingSummarySourceUpdatedAt))',
  'OR #currentSummarySourceEpoch < :incomingSummarySourceEpoch',
  'OR (#currentSummarySourceEpoch = :incomingSummarySourceEpoch',
  'AND (attribute_not_exists(#currentSummarySourceUpdatedAt)',
  'OR #currentSummarySourceUpdatedAt <= :incomingSummarySourceUpdatedAt))',
  ')',
].join(' ');

type ExpressionBuildState = {
  setters: string[];
  removals: string[];
  names: Record<string, string>;
  values: Record<string, unknown>;
};

const createExpressionState = (): ExpressionBuildState => ({
  setters: [],
  removals: [],
  names: {
    '#pk': 'PK',
    '#currentSummarySourceEpoch': 'summarySourceEpoch',
    '#currentSummarySourceUpdatedAt': 'summarySourceUpdatedAt',
  },
  values: {},
});

const addOrderingConditionValues = (
  state: ExpressionBuildState,
  update: ContractSummaryUpdate
) => {
  state.values[':incomingSummarySourceEpoch'] = update.summarySourceEpoch;
  state.values[':incomingSummarySourceUpdatedAt'] =
    update.summarySourceUpdatedAt;
};

const addField = (
  state: ExpressionBuildState,
  input: {
    nameKey: string;
    attributeName: string;
    valueKey: string;
    value: unknown | null | undefined;
  }
) => {
  if (input.value === undefined) {
    return;
  }

  state.names[input.nameKey] = input.attributeName;
  if (input.value === null) {
    state.removals.push(input.nameKey);
    return;
  }
  state.values[input.valueKey] = input.value;
  state.setters.push(`${input.nameKey} = ${input.valueKey}`);
};

const toUpdateExpression = (state: ExpressionBuildState) => {
  if (!state.setters.length && !state.removals.length) {
    return null;
  }

  const expressions: string[] = [];
  if (state.setters.length) {
    expressions.push(`SET ${state.setters.join(', ')}`);
  }
  if (state.removals.length) {
    expressions.push(`REMOVE ${state.removals.join(', ')}`);
  }

  return {
    ConditionExpression: MONOTONIC_CONDITION_EXPRESSION,
    UpdateExpression: expressions.join(' '),
    ExpressionAttributeNames: state.names,
    ...(Object.keys(state.values).length
      ? { ExpressionAttributeValues: state.values }
      : {}),
  };
};

export type PreparedContractSummaryUpdate = {
  summaryPreview: string | undefined;
  shouldRemoveSummaryPreview: boolean;
  shouldWriteSnapshot: boolean;
  primaryUpdate: ReturnType<typeof toUpdateExpression>;
  metadataUpdate: ReturnType<typeof toUpdateExpression>;
};

export const buildContractSummaryUpdateExpressions = (
  update: ContractSummaryUpdate
): PreparedContractSummaryUpdate => {
  assertValidSummarySource(update);

  const summaryPreview = resolveSummaryPreview(
    update.summary,
    update.summaryPreview
  );
  const shouldRemoveSummaryPreview =
    update.summary === null || update.summaryPreview === null;

  const primaryState = createExpressionState();
  addOrderingConditionValues(primaryState, update);
  addField(primaryState, {
    nameKey: '#summarySourceUpdatedAt',
    attributeName: 'summarySourceUpdatedAt',
    valueKey: ':summarySourceUpdatedAt',
    value: update.summarySourceUpdatedAt,
  });
  addField(primaryState, {
    nameKey: '#summarySourceEpoch',
    attributeName: 'summarySourceEpoch',
    valueKey: ':summarySourceEpoch',
    value: update.summarySourceEpoch,
  });
  addField(primaryState, {
    nameKey: '#summary',
    attributeName: 'summary',
    valueKey: ':summary',
    value: update.summary,
  });
  addField(primaryState, {
    nameKey: '#summaryPreview',
    attributeName: 'summaryPreview',
    valueKey: ':summaryPreview',
    value: shouldRemoveSummaryPreview ? null : summaryPreview,
  });
  addField(primaryState, {
    nameKey: '#summaryUpdatedAt',
    attributeName: 'summaryUpdatedAt',
    valueKey: ':summaryUpdatedAt',
    value: update.summaryUpdatedAt,
  });
  addField(primaryState, {
    nameKey: '#summaryInputBlueId',
    attributeName: 'summaryInputBlueId',
    valueKey: ':summaryInputBlueId',
    value: update.summaryInputBlueId,
  });
  addField(primaryState, {
    nameKey: '#summaryModel',
    attributeName: 'summaryModel',
    valueKey: ':summaryModel',
    value: update.summaryModel,
  });
  addField(primaryState, {
    nameKey: '#summaryError',
    attributeName: 'summaryError',
    valueKey: ':summaryError',
    value: update.summaryError,
  });
  addField(primaryState, {
    nameKey: '#summaryDocumentName',
    attributeName: 'summaryDocumentName',
    valueKey: ':summaryDocumentName',
    value: update.summaryDocumentName,
  });
  addField(primaryState, {
    nameKey: '#summaryStatus',
    attributeName: 'summaryStatus',
    valueKey: ':summaryStatus',
    value: update.summaryStatus,
  });
  addField(primaryState, {
    nameKey: '#summaryStatusUpdatedAt',
    attributeName: 'summaryStatusUpdatedAt',
    valueKey: ':summaryStatusUpdatedAt',
    value: update.summaryStatusUpdatedAt,
  });
  addField(primaryState, {
    nameKey: '#summaryStatusTimestamps',
    attributeName: 'summaryStatusTimestamps',
    valueKey: ':summaryStatusTimestamps',
    value: update.summaryStatusTimestamps,
  });

  const metadataState = createExpressionState();
  addOrderingConditionValues(metadataState, update);
  addField(metadataState, {
    nameKey: '#summarySourceUpdatedAt',
    attributeName: 'summarySourceUpdatedAt',
    valueKey: ':summarySourceUpdatedAt',
    value: update.summarySourceUpdatedAt,
  });
  addField(metadataState, {
    nameKey: '#summarySourceEpoch',
    attributeName: 'summarySourceEpoch',
    valueKey: ':summarySourceEpoch',
    value: update.summarySourceEpoch,
  });
  addField(metadataState, {
    nameKey: '#summaryPreview',
    attributeName: 'summaryPreview',
    valueKey: ':summaryPreview',
    value: shouldRemoveSummaryPreview ? null : summaryPreview,
  });
  addField(metadataState, {
    nameKey: '#summaryUpdatedAt',
    attributeName: 'summaryUpdatedAt',
    valueKey: ':summaryUpdatedAt',
    value: update.summaryUpdatedAt,
  });
  addField(metadataState, {
    nameKey: '#summaryDocumentName',
    attributeName: 'summaryDocumentName',
    valueKey: ':summaryDocumentName',
    value: update.summaryDocumentName,
  });

  const shouldWriteSnapshot =
    update.summaryDocument !== undefined ||
    update.summaryTriggerEvent !== undefined ||
    update.summaryEmittedEvents !== undefined ||
    update.summaryStatus !== undefined ||
    update.summaryStatusUpdatedAt !== undefined ||
    update.summaryStatusTimestamps !== undefined;

  return {
    summaryPreview,
    shouldRemoveSummaryPreview,
    shouldWriteSnapshot,
    primaryUpdate: toUpdateExpression(primaryState),
    metadataUpdate: toUpdateExpression(metadataState),
  };
};

export const buildContractSummarySnapshot = (
  update: ContractSummaryUpdate
): ContractSummarySnapshot => ({
  contractId: update.contractId,
  summaryDocument: update.summaryDocument,
  summaryStatus: update.summaryStatus,
  summaryStatusUpdatedAt: update.summaryStatusUpdatedAt,
  summaryStatusTimestamps: update.summaryStatusTimestamps,
  summaryTriggerEvent: update.summaryTriggerEvent,
  summaryEmittedEvents: update.summaryEmittedEvents,
  summarySourceUpdatedAt: update.summarySourceUpdatedAt,
  summarySourceEpoch: update.summarySourceEpoch,
  summaryUpdatedAt: update.summaryUpdatedAt,
  summaryInputBlueId: update.summaryInputBlueId,
});
