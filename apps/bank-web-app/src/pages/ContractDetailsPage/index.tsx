import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { DashboardShell } from '../../features/dashboard/components';
import {
  useAcceptPayNoteDelivery,
  useActiveContractSession,
  useContractDetails,
  useContractReviewState,
  useContractSummary,
  useProposalDetails,
  useProposalSummary,
  useRejectPayNoteDelivery,
} from '../../features/contracts/hooks';
import {
  getDocumentDescription,
  getDocumentName,
  restoreInlineTypes,
} from '../../features/contracts/lib/contractDocumentUtils';
import { ContractOperationsList } from '../../features/contracts/components/ContractOperationsList';
import { ContractRawDocument } from '../../features/contracts/components/ContractRawDocument';
import { ContractRelatedActivitySection } from '../../features/contracts/components/ContractRelatedActivitySection';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Spinner, SpinnerWithText } from '../../ui/Spinner';
import { formatShortDateTime } from '../../lib/formatDate';
import type {
  ContractDetails,
  PayNoteDeliveryDetailsSanitized,
} from '../../types/api';

type LocationState = {
  from?: string;
  kind?: 'contract' | 'proposal';
};

interface ProposalActionCardProps {
  proposal: PayNoteDeliveryDetailsSanitized | null;
  sessionId: string | null;
}

function ProposalActionCard({ proposal, sessionId }: ProposalActionCardProps) {
  const acceptMutation = useAcceptPayNoteDelivery();
  const rejectMutation = useRejectPayNoteDelivery();
  const [isDecisionRequested, setDecisionRequested] = useState(false);

  useEffect(() => {
    if (acceptMutation.isError || rejectMutation.isError) {
      setDecisionRequested(false);
    }
  }, [acceptMutation.isError, rejectMutation.isError]);

  if (!proposal) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500">
        Pending actions will appear here once they are available.
      </div>
    );
  }

  const decisionStatus = proposal.clientDecisionStatus ?? 'pending';
  if (decisionStatus === 'accepted' || decisionStatus === 'rejected') {
    return null;
  }
  const isDecisionLocked =
    decisionStatus === 'accepted' || decisionStatus === 'rejected';
  const isDecisionPending =
    acceptMutation.isPending || rejectMutation.isPending || isDecisionRequested;
  const decisionSessionId = proposal.deliverySessionId ?? sessionId;
  const pendingTitle = 'Approve the Contract';
  const pendingDescription =
    'If you reject the contract, the source transaction will be handled as a standard transfer.';
  const title =
    decisionStatus === 'pending'
      ? pendingTitle
      : proposal.payNote?.name?.trim() || 'Contract decision';
  const description =
    decisionStatus === 'pending'
      ? pendingDescription
      : 'Review the latest contract decision below.';

  const handleAccept = () => {
    if (!decisionSessionId || isDecisionLocked || isDecisionPending) return;
    setDecisionRequested(true);
    acceptMutation.mutate(decisionSessionId);
  };

  const handleReject = () => {
    if (!decisionSessionId || isDecisionLocked || isDecisionPending) return;
    setDecisionRequested(true);
    rejectMutation.mutate({ sessionId: decisionSessionId });
  };

  return (
    <div className="rounded-2xl border-2 border-[color:var(--color-primary)] bg-white p-4">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="border-rose-500 text-rose-500 hover:bg-rose-50 focus:ring-rose-500"
          onClick={handleReject}
          disabled={isDecisionLocked || isDecisionPending}
        >
          Reject
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleAccept}
          disabled={isDecisionLocked || isDecisionPending}
        >
          Accept
        </Button>
      </div>
    </div>
  );
}

interface ContractDetailsAccordionProps {
  contract: ContractDetails | null;
}

function ContractDetailsAccordion({ contract }: ContractDetailsAccordionProps) {
  return (
    <details className="rounded-2xl border border-slate-200 bg-white/80">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-900">
        <svg
          className="h-4 w-4 text-slate-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
        View details
      </summary>
      <div className="border-t border-slate-200 px-4 pb-4 pt-3 space-y-5 text-sm text-slate-600">
        {!contract && (
          <p className="text-sm text-slate-500">
            Contract details will appear once the proposal is accepted.
          </p>
        )}

        {contract && (
          <>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Operations
              </p>
              <div className="mt-3">
                <ContractOperationsList contract={contract} variant="compact" />
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Raw document
              </p>
              <div className="mt-3">
                <ContractRawDocument
                  document={contract.document}
                  emptyLabel="Contract document not available."
                />
              </div>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

export function ContractDetailsPage() {
  const { user, signOut } = useAuth();
  const { setActiveSession } = useActiveContractSession();
  const { markReviewed } = useContractReviewState();
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as LocationState | null) ?? null;
  const kindParam = new URLSearchParams(location.search).get('kind');
  const kindFromParam =
    kindParam === 'proposal' || kindParam === 'contract' ? kindParam : null;
  const requestedKind = locationState?.kind ?? kindFromParam;
  const backTarget = locationState?.from || '/contracts';

  const [activeKind, setActiveKind] = useState<'contract' | 'proposal'>(
    requestedKind ?? 'contract'
  );

  useEffect(() => {
    if (!requestedKind) {
      return;
    }
    setActiveKind(requestedKind);
  }, [requestedKind, sessionId]);

  const contractQuery = useContractDetails(
    activeKind === 'contract' ? sessionId ?? null : null
  );
  const proposalQuery = useProposalDetails(
    activeKind === 'proposal' ? sessionId ?? null : null
  );

  useEffect(() => {
    if (
      activeKind === 'contract' &&
      contractQuery.isError &&
      contractQuery.error?.status === 404
    ) {
      setActiveKind('proposal');
    }
  }, [activeKind, contractQuery.error, contractQuery.isError]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    setActiveSession(sessionId);
    return () => setActiveSession(null);
  }, [sessionId, setActiveSession]);

  const contract = contractQuery.data ?? null;
  const proposal = proposalQuery.data ?? null;
  const relatedActivitySource = contract
    ? contract
    : proposal
    ? {
        accountNumber: proposal.accountNumber ?? undefined,
        relatedTransactionIds: proposal.transactionId
          ? [proposal.transactionId]
          : [],
        relatedHoldIds: proposal.holdId ? [proposal.holdId] : [],
      }
    : null;
  const isLoading =
    !contract &&
    !proposal &&
    (activeKind === 'contract'
      ? contractQuery.isLoading
      : proposalQuery.isLoading);
  const isError =
    !contract &&
    !proposal &&
    (activeKind === 'contract' ? contractQuery.isError : proposalQuery.isError);

  useEffect(() => {
    if (!contract) {
      return;
    }
    markReviewed(contract);
  }, [contract, markReviewed]);

  const resolvedDocument = useMemo(
    () => (contract ? restoreInlineTypes(contract.document) : null),
    [contract]
  );

  const contractTitle =
    (contract ? getDocumentName(resolvedDocument) : null) ??
    contract?.displayName ??
    null;
  const proposalTitle = proposal?.payNote?.name?.trim() || null;
  const headerTitle = contractTitle || proposalTitle || 'Contract';
  const senderName = contract?.displayName || proposalTitle || 'Contract';
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
  const proposalSummarySessionId =
    proposal?.deliverySessionId ?? sessionId ?? null;
  const proposalSummaryQuery = useProposalSummary(
    proposalSummarySessionId,
    Boolean(proposal && proposalSummarySessionId)
  );
  const proposalSummary = proposalSummaryQuery.data?.summary ?? null;
  const summary = contract
    ? summaryQuery.data?.summary ?? contract?.summary ?? null
    : proposalSummary;
  const summaryErrorMessage = contract
    ? (summaryQuery.error instanceof Error
        ? summaryQuery.error.message
        : null) ??
      contract?.summaryError ??
      null
    : proposalSummaryQuery.error instanceof Error
    ? proposalSummaryQuery.error.message
    : null;
  const summaryTitle =
    summary?.title?.trim() || getDocumentName(resolvedDocument) || headerTitle;
  const summaryOneLiner =
    summary?.oneLiner?.trim() ||
    (contract ? getDocumentDescription(resolvedDocument) : null) ||
    null;
  const summaryStateLabel = summary?.state?.statusLabel?.trim() || null;
  const summaryStateExplanation = summary?.state?.explanation?.trim() || null;
  const summaryKeyFacts = summary?.keyFacts ?? [];
  const summaryWarnings = summary?.warnings ?? [];
  const isSummaryLoading = contract
    ? summaryQuery.isLoading && !summary && !!contract
    : proposalSummaryQuery.isLoading && !summary && !!proposal;
  const isSummaryFetching = contract
    ? summaryQuery.isFetching && !!summary
    : proposalSummaryQuery.isFetching && !!summary;
  const proposalSummaryFallback = proposalSummaryQuery.timedOut
    ? 'Sorry, contract summary is not available.'
    : 'Summary not available yet.';
  const summaryFallbackText =
    summaryOneLiner ||
    (contract ? 'Summary unavailable.' : proposalSummaryFallback);

  const historyItems = useMemo(() => {
    if (!Array.isArray(contract?.emittedEvents)) {
      return [];
    }

    return contract.emittedEvents.map((entry, index) => {
      const record =
        entry && typeof entry === 'object'
          ? (entry as Record<string, unknown>)
          : null;
      const typeRecord =
        record && typeof record.type === 'object' && record.type
          ? (record.type as Record<string, unknown>)
          : null;
      const title =
        (typeof record?.name === 'string' && record.name.trim()) ||
        (typeof typeRecord?.name === 'string' && typeRecord.name.trim()) ||
        (typeof record?.type === 'string' && record.type.trim()) ||
        'Contract event';
      const description =
        (typeof record?.description === 'string' &&
          record.description.trim()) ||
        (typeof typeRecord?.description === 'string' &&
          typeRecord.description.trim()) ||
        null;
      const timestampCandidate =
        record?.occurredAt ??
        record?.createdAt ??
        record?.timestamp ??
        record?.updatedAt ??
        null;
      const timestamp =
        typeof timestampCandidate === 'string' ? timestampCandidate : null;

      return {
        id: `${index}-${title}`,
        title,
        description,
        timestamp,
      };
    });
  }, [contract?.emittedEvents]);
  const hasHistory = historyItems.length > 0;

  const handleBack = () => {
    navigate(backTarget);
  };

  if (isLoading) {
    return (
      <div className="app-shell flex items-center justify-center">
        <SpinnerWithText
          text="Loading contract..."
          size="xl"
          color="green"
          textClassName="text-slate-700 text-lg"
          data-testid="contract-details-loading"
        />
      </div>
    );
  }

  if (isError || !sessionId) {
    return (
      <div className="app-shell flex items-center justify-center">
        <div className="app-surface px-8 py-6 text-slate-700 text-lg text-center">
          Unable to load contract details. Please return to contracts.
          <div className="mt-4">
            <Button onClick={handleBack}>Back to contracts</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell
      data-testid="contract-details-page"
      header={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              aria-label="Back to contracts"
              className="flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-600 transition hover:text-slate-900"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h1 className="text-3xl font-semibold text-slate-900">Contract</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              {user?.email || 'Guest'}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="rounded-full border border-slate-200 bg-white/80 p-2 text-slate-600 transition hover:text-slate-900"
              aria-label="Sign out"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v6m6.364-2.364A9 9 0 105.636 6.636"
                />
              </svg>
            </button>
          </div>
        </div>
      }
    >
      <section className="app-surface p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Contract
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              {headerTitle}
            </h2>
          </div>
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
            aria-label="More options"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="10" cy="4" r="1.5" />
              <circle cx="10" cy="10" r="1.5" />
              <circle cx="10" cy="16" r="1.5" />
            </svg>
          </button>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={senderName} size="lg" />
                  <div className="text-sm font-semibold text-slate-900">
                    {senderName}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-sm font-semibold text-[color:var(--color-primary)] opacity-70"
                  aria-label="Talk with AI (coming soon)"
                  disabled
                >
                  Talk with AI
                </button>
              </div>

              <div className="mt-4 space-y-3 text-slate-700">
                {summaryErrorMessage && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-700">
                    {summaryErrorMessage}
                  </div>
                )}

                {isSummaryFetching && summary && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Spinner size="sm" color="green" />
                    Updating summary...
                  </div>
                )}

                {isSummaryLoading && (
                  <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500">
                    <Spinner size="sm" color="green" />
                    Generating summary...
                  </div>
                )}

                {summary ? (
                  <>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">
                        {summaryTitle}
                      </h3>
                      {summaryOneLiner && (
                        <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600 leading-relaxed">
                          {summaryOneLiner}
                        </p>
                      )}
                    </div>

                    {(summaryStateLabel || summaryStateExplanation) && (
                      <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Current state
                        </p>
                        {summaryStateLabel && (
                          <p className="mt-2 font-semibold text-slate-900">
                            {summaryStateLabel}
                          </p>
                        )}
                        {summaryStateExplanation && (
                          <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600 leading-relaxed">
                            {summaryStateExplanation}
                          </p>
                        )}
                      </div>
                    )}

                    {summaryKeyFacts.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Key facts
                        </p>
                        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                          {summaryKeyFacts.map(fact => (
                            <div key={`${fact.label}-${fact.value}`}>
                              <dt className="text-xs font-medium text-slate-500">
                                {fact.label}
                              </dt>
                              <dd className="mt-1 text-sm font-semibold text-slate-900">
                                {fact.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}

                    {summaryWarnings.length > 0 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-amber-700">
                          Notes
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-900">
                          {summaryWarnings.map(warning => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : !isSummaryLoading ? (
                  <p className="text-sm text-slate-600">
                    {summaryFallbackText}
                  </p>
                ) : null}
              </div>

              <div className="mt-4">
                <ContractDetailsAccordion contract={contract} />
              </div>
            </div>

            {relatedActivitySource && (
              <ContractRelatedActivitySection
                contract={relatedActivitySource}
                title="Linked transactions"
                hideWhenEmpty
              />
            )}

            {hasHistory && (
              <details className="rounded-2xl border border-slate-200 bg-white p-4">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900">
                  <svg
                    className="h-4 w-4 text-slate-400"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                      clipRule="evenodd"
                    />
                  </svg>
                  View history
                </summary>
                <div className="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-600">
                  <div className="space-y-3">
                    {historyItems.map(item => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-slate-200 bg-white/80 p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">
                              {item.title}
                            </p>
                            {item.description && (
                              <p className="mt-1 text-xs text-slate-500">
                                {item.description}
                              </p>
                            )}
                          </div>
                          {item.timestamp && (
                            <span className="text-xs text-slate-500">
                              {formatShortDateTime(item.timestamp)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <ProposalActionCard
              proposal={proposal}
              sessionId={sessionId ?? null}
            />
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}
