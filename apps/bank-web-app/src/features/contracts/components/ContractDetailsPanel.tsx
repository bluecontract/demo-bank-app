import { useEffect, useMemo, useState } from 'react';
import { dump as yamlDump } from 'js-yaml';
import { getSupportedContractByTypeBlueId } from '@demo-bank-app/shared-bank-api-contract';
import { blue } from '../../../lib/blue';
import { Card } from '../../../ui/Card';
import { Spinner } from '../../../ui/Spinner';
import { Button } from '../../../ui/Button';
import type { ContractDetails } from '../../../types/api';
import { collectContractOperations } from '../lib/operations';
import { OperationForm } from './OperationForm';
import { TransactionDetailsModal } from '../../transactions/components/TransactionDetailsModal';
import { TransactionItem } from '../../transactions/components/TransactionItem';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import {
  ActivityItem,
  useActivity,
} from '../../transactions/hooks/useActivity';
import { useContractSummary, useRegenerateContractSummary } from '../hooks';

interface ContractDetailsPanelProps {
  contract?: ContractDetails | null;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
}

const formatYaml = (value: unknown) => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return yamlDump(value, { noRefs: true }).trimEnd();
  } catch {
    return null;
  }
};

const formatJson = (value: unknown) => {
  if (value == null) {
    return null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
};

const restoreInlineTypes = (value: unknown) => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    const node = blue.jsonValueToNode(value);
    const reversedNode = blue.reverse(node);
    const restoredNode = blue.restoreInlineTypes(reversedNode);
    return blue.nodeToJson(restoredNode);
  } catch {
    return value;
  }
};

const getDocumentName = (value: unknown) => {
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

const getDocumentDescription = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const description = (value as { description?: unknown }).description;
  if (typeof description !== 'string') {
    return null;
  }

  const trimmed = description.trim();
  return trimmed ? trimmed : null;
};

const formatStatus = (value?: string) => {
  if (!value) return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
};

const formatKeyLabel = (key: string) => {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
};

const formatDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getHoldEventTimestamp = (item: ActivityItem) => {
  if (item.kind === 'HOLD_CREATED') {
    return item.createdAt;
  }
  if (item.kind === 'HOLD_CAPTURED') {
    return item.capturedAt;
  }
  if (item.kind === 'HOLD_RELEASED') {
    return item.releasedAt;
  }
  if (item.kind === 'HOLD_FAILED') {
    return item.failedAt;
  }
  return '';
};

const getActivityTimestamp = (item: ActivityItem) => {
  if (item.kind === 'POSTED_TRANSACTION') {
    return item.postedAt;
  }
  return getHoldEventTimestamp(item);
};

const getActivityKey = (item: ActivityItem) =>
  item.kind === 'POSTED_TRANSACTION'
    ? `txn-${item.transactionId}`
    : `hold-${item.holdId}-${item.kind}-${getHoldEventTimestamp(item)}`;

export function ContractDetailsPanel({
  contract,
  isLoading = false,
  isError = false,
  errorMessage,
}: ContractDetailsPanelProps) {
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(
    null
  );
  const [isKeyFactsExpanded, setIsKeyFactsExpanded] = useState(false);
  const { data: accounts } = useAccounts();
  const activityQuery = useActivity({
    accountNumber: contract?.accountNumber ?? null,
  });

  const supportedContract = contract
    ? getSupportedContractByTypeBlueId(contract.typeBlueId)
    : null;

  const operations = useMemo(() => {
    if (!contract?.document || !supportedContract) {
      return [];
    }

    return collectContractOperations({
      document: contract.document,
      operationsChannelKey: supportedContract.operationsChannelKey,
      blue,
    });
  }, [contract?.document, supportedContract]);

  const activeOperationDetails = operations.find(
    operation => operation.name === activeOperation
  );

  useEffect(() => {
    setActiveOperation(null);
    setActiveActivityId(null);
    setSelectedActivity(null);
    setIsKeyFactsExpanded(false);
  }, [contract?.sessionId]);

  const restoredDocument = restoreInlineTypes(contract?.document);
  const documentYaml = formatYaml(restoredDocument);
  const documentTitle =
    getDocumentName(restoredDocument) ?? contract?.displayName ?? 'Contract';
  const documentSummary =
    getDocumentDescription(restoredDocument) ?? documentTitle;
  const summaryQuery = useContractSummary(
    contract?.sessionId ?? null,
    contract?.updatedAt ?? null
  );
  const regenerateSummary = useRegenerateContractSummary();
  const generatedSummary = summaryQuery.data?.summary ?? contract?.summary;
  const summaryErrorMessage =
    (summaryQuery.error instanceof Error ? summaryQuery.error.message : null) ??
    contract?.summaryError ??
    null;
  const triggerEventJson = formatJson(contract?.triggerEvent);
  const emittedEventsJson = formatJson(contract?.emittedEvents);
  const statusEntries = contract?.statusTimestamps
    ? Object.entries(contract.statusTimestamps)
    : [];
  const statusTimestamp = contract?.statusUpdatedAt ?? contract?.updatedAt;
  const account = accounts?.find(
    item => item.accountNumber === contract?.accountNumber
  );

  const relatedTransactions = useMemo(
    () => contract?.relatedTransactionIds ?? [],
    [contract?.relatedTransactionIds]
  );
  const relatedHolds = useMemo(
    () => contract?.relatedHoldIds ?? [],
    [contract?.relatedHoldIds]
  );
  const activityItems = useMemo(
    () => activityQuery.data?.items ?? [],
    [activityQuery.data?.items]
  );

  const activityByTransactionId = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const item of activityItems) {
      if (item.kind === 'POSTED_TRANSACTION') {
        map.set(item.transactionId, item);
      }
    }
    return map;
  }, [activityItems]);

  const activityByHoldId = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const item of activityItems) {
      if (item.kind === 'POSTED_TRANSACTION') {
        continue;
      }

      const existing = map.get(item.holdId);
      if (!existing) {
        map.set(item.holdId, item);
        continue;
      }

      const existingTime = Date.parse(getActivityTimestamp(existing));
      const nextTime = Date.parse(getActivityTimestamp(item));
      if (Number.isNaN(existingTime) || nextTime > existingTime) {
        map.set(item.holdId, item);
      }
    }

    return map;
  }, [activityItems]);

  const relatedTransactionItems = useMemo(
    () =>
      relatedTransactions
        .map(txnId => activityByTransactionId.get(txnId))
        .filter((item): item is ActivityItem => Boolean(item)),
    [activityByTransactionId, relatedTransactions]
  );

  const relatedHoldItems = useMemo(
    () =>
      relatedHolds
        .map(holdId => activityByHoldId.get(holdId))
        .filter((item): item is ActivityItem => Boolean(item)),
    [activityByHoldId, relatedHolds]
  );

  const missingTransactionIds = useMemo(
    () =>
      relatedTransactions.filter(txnId => !activityByTransactionId.has(txnId)),
    [activityByTransactionId, relatedTransactions]
  );

  const missingHoldIds = useMemo(
    () => relatedHolds.filter(holdId => !activityByHoldId.has(holdId)),
    [activityByHoldId, relatedHolds]
  );

  const handleActivitySelect = (activity: ActivityItem) => {
    if (!contract?.accountNumber) {
      return;
    }

    setSelectedActivity(activity);
    setActiveActivityId(activity.activityId);
  };

  const handleFallbackActivityOpen = (activityId: string) => {
    if (!contract?.accountNumber) {
      return;
    }

    setSelectedActivity(null);
    setActiveActivityId(activityId);
  };

  const isActivityLoading =
    activityQuery.isLoading &&
    (relatedTransactions.length > 0 || relatedHolds.length > 0);

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center min-h-[420px]">
        <Spinner size="lg" color="green" />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="p-6 text-sm text-slate-600">
        {errorMessage || 'Unable to load contract details.'}
      </Card>
    );
  }

  if (!contract) {
    return (
      <Card className="p-6 text-sm text-slate-600">
        Select a contract to view details and available operations.
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-6 min-h-0">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-muted)]">
          Contract
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">
          {documentTitle}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="app-chip app-chip-neutral">
            {contract.displayName}
          </span>
          <span className="app-chip">{formatStatus(contract.status)}</span>
          {statusTimestamp && (
            <span className="app-chip app-chip-neutral">
              Updated {formatDate(statusTimestamp)}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <section className="border border-slate-200 rounded-2xl overflow-hidden bg-white/70">
          <header className="px-4 py-3 border-b border-slate-200 bg-white/80">
            <h3 className="text-sm font-semibold text-slate-900">
              Contract summary
            </h3>
          </header>
          <div className="p-4">
            {summaryQuery.isLoading && !generatedSummary && (
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500">
                <Spinner size="sm" color="green" />
                Generating summary...
              </div>
            )}

            {summaryQuery.isFetching && generatedSummary && (
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
                <Spinner size="sm" color="green" />
                Updating summary...
              </div>
            )}

            {summaryErrorMessage && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700">
                {summaryErrorMessage}
              </div>
            )}

            {generatedSummary ? (
              <div className="space-y-4 text-sm text-slate-700">
                <div>
                  <p className="text-lg font-semibold text-slate-900">
                    {generatedSummary.title}
                  </p>
                  <p className="mt-1 whitespace-pre-line break-words text-slate-600 leading-relaxed">
                    {generatedSummary.oneLiner}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Current state
                  </p>
                  <p className="mt-2 font-semibold text-slate-900">
                    {generatedSummary.state.statusLabel}
                  </p>
                  <p className="mt-1 whitespace-pre-line break-words text-slate-600 leading-relaxed">
                    {generatedSummary.state.explanation}
                  </p>
                </div>

                {generatedSummary.keyFacts.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Key facts
                      </p>
                      <button
                        type="button"
                        className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                        onClick={() => setIsKeyFactsExpanded(prev => !prev)}
                        aria-expanded={isKeyFactsExpanded}
                      >
                        {isKeyFactsExpanded ? 'Hide' : 'Show'} (
                        {generatedSummary.keyFacts.length})
                      </button>
                    </div>

                    {isKeyFactsExpanded ? (
                      <dl className="mt-3 divide-y divide-slate-200/70">
                        {generatedSummary.keyFacts.map(fact => (
                          <div
                            key={`${fact.label}:${fact.value}`}
                            className="py-3 first:pt-0 last:pb-0"
                          >
                            <dt className="text-xs font-medium text-slate-500">
                              {fact.label}
                            </dt>
                            <dd className="mt-1 whitespace-pre-wrap break-words font-medium text-slate-900">
                              {fact.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        Key information about the contract (participants,
                        amounts, statuses, and identifiers).
                      </p>
                    )}
                  </div>
                )}

                {generatedSummary.warnings?.length ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
                    <p className="text-xs uppercase tracking-[0.2em] text-amber-700">
                      Notes
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {generatedSummary.warnings.map(warning => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-700 leading-relaxed">
                {documentSummary}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!contract.sessionId || regenerateSummary.isPending}
                onClick={() => {
                  if (!contract.sessionId) return;
                  regenerateSummary.mutate({ sessionId: contract.sessionId });
                }}
              >
                {regenerateSummary.isPending ? 'Regenerating...' : 'Regenerate'}
              </Button>
              {summaryQuery.data?.model && (
                <span className="text-xs text-slate-500">
                  Model: {summaryQuery.data.model}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Available operations
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Filtered by channel{' '}
                  {supportedContract?.operationsChannelKey ?? 'n/a'}.
                </p>
              </div>
              <span className="app-chip app-chip-neutral">
                {operations.length} total
              </span>
            </div>

            {operations.length === 0 && (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500">
                No eligible operations found for this contract.
              </div>
            )}

            {operations.length > 0 && (
              <div className="mt-4 space-y-3">
                {operations.map(operation => (
                  <button
                    key={operation.name}
                    type="button"
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      activeOperation === operation.name
                        ? 'border-[color:var(--color-primary)] bg-[rgba(43,190,156,0.08)]'
                        : 'border-slate-200 bg-white/80 hover:border-emerald-200'
                    }`}
                    onClick={() => setActiveOperation(operation.name)}
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {operation.label}
                    </p>
                    {operation.description && (
                      <p className="text-xs text-slate-500 mt-1">
                        {operation.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeOperationDetails && contract.sessionId && (
            <OperationForm
              isOpen
              operation={activeOperationDetails}
              sessionId={contract.sessionId}
              onClose={() => setActiveOperation(null)}
            />
          )}
        </section>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Related activity
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Linked transactions and holds connected to this contract.
            </p>
          </div>
        </div>

        {relatedTransactions.length === 0 && relatedHolds.length === 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500">
            No related activity linked yet.
          </div>
        )}

        {isActivityLoading && (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500 flex items-center gap-3">
            <Spinner size="sm" color="green" />
            Loading related activity details...
          </div>
        )}

        {!isActivityLoading &&
          (relatedTransactions.length > 0 || relatedHolds.length > 0) && (
            <div className="mt-4 space-y-4">
              {relatedTransactions.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Transactions
                  </p>
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white/80 divide-y divide-slate-100">
                    {relatedTransactionItems.map(item => (
                      <TransactionItem
                        key={getActivityKey(item)}
                        item={item}
                        onActivitySelect={handleActivitySelect}
                      />
                    ))}
                    {missingTransactionIds.map(txnId => (
                      <div
                        key={txnId}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">
                            Transaction {txnId}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Details pending in activity feed.
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!contract.accountNumber}
                          onClick={() =>
                            handleFallbackActivityOpen(`TXN#${txnId}`)
                          }
                        >
                          View details
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {relatedHolds.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Holds
                  </p>
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white/80 divide-y divide-slate-100">
                    {relatedHoldItems.map(item => (
                      <TransactionItem
                        key={getActivityKey(item)}
                        item={item}
                        onActivitySelect={handleActivitySelect}
                      />
                    ))}
                    {missingHoldIds.map(holdId => (
                      <div
                        key={holdId}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">
                            Hold {holdId}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Details pending in activity feed.
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!contract.accountNumber}
                          onClick={() =>
                            handleFallbackActivityOpen(`HOLD#${holdId}`)
                          }
                        >
                          View details
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white/70">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
          Contract details
        </summary>
        <div className="px-4 pb-4 pt-1 space-y-4 text-sm text-slate-600">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="text-slate-500">Contract ID</span>
              <p className="font-medium text-slate-900">
                {contract.contractId}
              </p>
            </div>
            {contract.sessionId && (
              <div>
                <span className="text-slate-500">Session ID</span>
                <p className="font-medium text-slate-900">
                  {contract.sessionId}
                </p>
              </div>
            )}
            {contract.documentId && (
              <div>
                <span className="text-slate-500">Document ID</span>
                <p className="font-medium text-slate-900">
                  {contract.documentId}
                </p>
              </div>
            )}
            {contract.accountNumber && (
              <div>
                <span className="text-slate-500">Account</span>
                <p className="font-medium text-slate-900">
                  {contract.accountNumber}
                </p>
              </div>
            )}
            <div>
              <span className="text-slate-500">Created</span>
              <p className="font-medium text-slate-900">
                {formatDate(contract.createdAt)}
              </p>
            </div>
          </div>

          {statusEntries.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Status timeline
              </p>
              <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                {statusEntries.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span>{formatKeyLabel(key)}</span>
                    <span className="font-medium text-slate-900">
                      {formatDate(value) ?? value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Event context
            </p>
            <div className="mt-3 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Triggered by
                </p>
                {triggerEventJson ? (
                  <pre className="mt-2 bg-slate-900/95 text-emerald-100 text-xs rounded-xl p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    <code>{triggerEventJson}</code>
                  </pre>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">
                    Trigger event not available yet.
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Emitted events
                </p>
                {contract.emittedEvents?.length ? (
                  <pre className="mt-2 bg-slate-900/95 text-emerald-100 text-xs rounded-xl p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    <code>{emittedEventsJson}</code>
                  </pre>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">
                    No emitted events recorded yet.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Contract document
            </p>
            {documentYaml ? (
              <pre className="mt-3 bg-slate-900/95 text-emerald-100 text-xs rounded-xl p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                <code>{documentYaml}</code>
              </pre>
            ) : (
              <p className="mt-3 text-sm text-slate-600">
                Contract document not available.
              </p>
            )}
          </div>
        </div>
      </details>

      <TransactionDetailsModal
        isOpen={!!activeActivityId}
        onClose={() => {
          setActiveActivityId(null);
          setSelectedActivity(null);
        }}
        accountId={account?.accountId ?? ''}
        accountNumber={contract.accountNumber ?? ''}
        activityId={activeActivityId ?? ''}
        selectedActivity={selectedActivity ?? undefined}
        currentAccountNumber={contract.accountNumber ?? undefined}
        accounts={accounts}
      />
    </Card>
  );
}
