import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatShortDateTime } from '../../../lib/formatDate';
import { formatStatusLabel } from '../../../lib/formatStatusLabel';
import { Card } from '../../../ui/Card';
import { Spinner } from '../../../ui/Spinner';
import { Button } from '../../../ui/Button';
import type { ContractDetails } from '../../../types/api';
import {
  formatJson,
  getDocumentDescription,
  getDocumentName,
  restoreInlineTypes,
} from '../lib/contractDocumentUtils';
import { ContractOperationsList } from './ContractOperationsList';
import { ContractRawDocument } from './ContractRawDocument';
import { SummaryPanel } from './SummaryPanel';
import { TransactionItem } from '../../transactions/components/TransactionItem';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import {
  ActivityItem,
  useActivity,
} from '../../transactions/hooks/useActivity';
import { useRelatedActivityItems } from '../../transactions/hooks/useRelatedActivityItems';
import { useContractSummary, useRegenerateContractSummary } from '../hooks';
import { buildTransactionDetailsPath } from '../../transactions/lib/activityRoutes';
import { getActivityKey } from '../../transactions/lib/activityUtils';

interface ContractDetailsPanelProps {
  contract?: ContractDetails | null;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
}

const formatKeyLabel = (key: string) => {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
};

export function ContractDetailsPanel({
  contract,
  isLoading = false,
  isError = false,
  errorMessage,
}: ContractDetailsPanelProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: accounts } = useAccounts();
  const activityQuery = useActivity({
    accountNumber: contract?.accountNumber ?? null,
  });

  const restoredDocument = restoreInlineTypes(contract?.document);
  const documentTitle =
    getDocumentName(restoredDocument) ?? contract?.displayName ?? 'Contract';
  const documentSummary =
    getDocumentDescription(restoredDocument) ?? documentTitle;
  const summaryIsFresh = Boolean(
    contract?.summary &&
      contract?.summarySourceUpdatedAt &&
      contract?.summarySourceUpdatedAt === contract?.updatedAt
  );
  const shouldFetchSummary = Boolean(
    contract?.sessionId && contract?.updatedAt && !summaryIsFresh
  );
  const summaryQuery = useContractSummary(
    contract?.sessionId ?? null,
    shouldFetchSummary ? contract?.updatedAt ?? null : null
  );
  const regenerateSummary = useRegenerateContractSummary();
  const generatedSummary = summaryQuery.data?.summary ?? contract?.summary;
  const summaryModel = summaryQuery.data?.model ?? contract?.summaryModel;
  const summaryErrorMessage =
    (summaryQuery.error instanceof Error ? summaryQuery.error.message : null) ??
    contract?.summaryError ??
    null;
  const handleRegenerateSummary = () => {
    if (!contract?.sessionId) return;
    regenerateSummary.mutate({ sessionId: contract.sessionId });
  };
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

  const {
    relatedTransactionItems,
    relatedHoldItems,
    missingTransactionIds,
    missingHoldIds,
  } = useRelatedActivityItems({
    activityItems,
    relatedTransactionIds: relatedTransactions,
    relatedHoldIds: relatedHolds,
  });

  const handleActivitySelect = (activity: ActivityItem) => {
    if (!contract?.accountNumber || !account?.accountId) {
      return;
    }

    navigate(
      buildTransactionDetailsPath(account.accountId, activity.activityId),
      {
        state: {
          from: `${location.pathname}${location.search}`,
          selectedActivity: activity,
        },
      }
    );
  };

  const handleFallbackActivityOpen = (activityId: string) => {
    if (!contract?.accountNumber || !account?.accountId) {
      return;
    }

    navigate(buildTransactionDetailsPath(account.accountId, activityId), {
      state: {
        from: `${location.pathname}${location.search}`,
      },
    });
  };

  const isActivityLoading =
    activityQuery.isLoading &&
    (relatedTransactions.length > 0 || relatedHolds.length > 0);

  if (isLoading && !contract) {
    return (
      <Card className="flex items-center justify-center min-h-[420px]">
        <Spinner size="lg" color="green" />
      </Card>
    );
  }

  if (isError && !contract) {
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
          <span className="app-chip">{formatStatusLabel(contract.status)}</span>
          {statusTimestamp && (
            <span className="app-chip app-chip-neutral">
              Updated {formatShortDateTime(statusTimestamp)}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <SummaryPanel
          title="Contract summary"
          summary={generatedSummary}
          summaryModel={summaryModel ?? null}
          summaryErrorMessage={summaryErrorMessage}
          isLoading={summaryQuery.isLoading && !generatedSummary}
          isFetching={summaryQuery.isFetching && Boolean(generatedSummary)}
          fallbackText={documentSummary}
          onRegenerate={handleRegenerateSummary}
          regenerateDisabled={
            !contract.sessionId || regenerateSummary.isPending
          }
          isRegeneratePending={regenerateSummary.isPending}
          loadingLabel="Generating summary..."
          fetchingLabel="Updating summary..."
        />

        <section className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Available operations
                </h3>
              </div>
            </div>
            <div className="mt-4">
              <ContractOperationsList contract={contract} variant="card" />
            </div>
          </div>
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
                {formatShortDateTime(contract.createdAt)}
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
                      {formatShortDateTime(value) ?? value}
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
            <div className="mt-3">
              <ContractRawDocument
                document={contract.document}
                emptyLabel="Contract document not available."
              />
            </div>
          </div>
        </div>
      </details>
    </Card>
  );
}
