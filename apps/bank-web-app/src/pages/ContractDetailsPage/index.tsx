import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { DashboardShell } from '../../features/dashboard/components';
import {
  useActiveContractSession,
  useContractDetails,
  useContractHistory,
  useContractReviewState,
  useRelatedContracts,
  useProposalDetails,
  useProposalSummary,
  useProposalDecision,
  useArchiveContract,
  useUnarchiveContract,
} from '../../features/contracts/hooks';
import {
  getDocumentDescription,
  getDocumentName,
  restoreInlineTypes,
} from '../../features/contracts/lib/contractDocumentUtils';
import { getContractLastChangeAt } from '../../features/contracts/lib/contractTimestamps';
import {
  getRelatedContractSessionId,
  getRelatedContractTarget,
  getVisibleRelatedContracts,
  isProposalRelatedContract,
} from '../../features/transactions/lib/relatedContracts';
import { ContractOperationsList } from '../../features/contracts/components/ContractOperationsList';
import { ContractRawDocument } from '../../features/contracts/components/ContractRawDocument';
import { ContractRelatedActivitySection } from '../../features/contracts/components/ContractRelatedActivitySection';
import { ContractAiChatDrawer } from '../../features/contracts/components/ContractAiChatDrawer';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Dropdown, DropdownItem } from '../../ui/Dropdown';
import { Spinner, SpinnerWithText } from '../../ui/Spinner';
import { formatShortDateTime } from '../../lib/formatDate';
import { formatStatusLabel } from '../../lib/formatStatusLabel';
import { getSupportedContractByTypeBlueId } from '@demo-bank-app/shared-bank-api-contract';
import type {
  ContractDetails,
  ContractSummary,
  PayNoteDeliveryDetailsSanitized,
  RelatedContractItem,
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
  const [isDecisionRequested, setDecisionRequested] = useState(false);
  const [decisionOverride, setDecisionOverride] = useState<
    'accepted' | 'rejected' | null
  >(null);
  const decisionSessionId = proposal?.deliverySessionId ?? sessionId;
  const { accept, reject, isPending } = useProposalDecision({
    sessionId: decisionSessionId,
    onAccepted: () => {
      setDecisionRequested(false);
      setDecisionOverride('accepted');
    },
    onRejected: () => {
      setDecisionRequested(false);
      setDecisionOverride('rejected');
    },
    onError: () => {
      setDecisionRequested(false);
    },
  });

  useEffect(() => {
    setDecisionRequested(false);
    setDecisionOverride(null);
  }, [proposal?.deliverySessionId, proposal?.clientDecisionStatus, sessionId]);

  if (!proposal) {
    return (
      <div className="rounded-xl sm:rounded-2xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500">
        Pending actions will appear here once they are available.
      </div>
    );
  }

  const decisionStatus =
    decisionOverride ?? proposal.clientDecisionStatus ?? 'pending';
  const isDecisionLocked =
    decisionStatus === 'accepted' || decisionStatus === 'rejected';
  const isDecisionPending = isPending || isDecisionRequested;
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

  if (decisionStatus === 'accepted') {
    const contractName = proposal.payNote?.name?.trim() || 'this contract';
    return (
      <div className="rounded-xl sm:rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
        <h3 className="text-lg font-semibold text-emerald-900">
          Thank you for accepting {contractName}.
        </h3>
        <p className="mt-2 text-sm text-emerald-900/80">
          We are starting it for you.
        </p>
      </div>
    );
  }

  if (decisionStatus === 'rejected') {
    const contractName = proposal.payNote?.name?.trim() || 'this contract';
    return (
      <div className="rounded-xl sm:rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
        <h3 className="text-lg font-semibold text-rose-900">
          You rejected {contractName}.
        </h3>
        <p className="mt-2 text-sm text-rose-900/80">
          The source transaction will be handled as a standard transfer.
        </p>
      </div>
    );
  }

  const handleAccept = () => {
    if (!decisionSessionId || isDecisionLocked || isDecisionPending) return;
    setDecisionRequested(true);
    accept();
  };

  const handleReject = () => {
    if (!decisionSessionId || isDecisionLocked || isDecisionPending) return;
    setDecisionRequested(true);
    reject();
  };

  return (
    <div className="rounded-xl sm:rounded-2xl border-2 border-[color:var(--color-primary)] bg-white p-4">
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
    <details className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white/80">
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
        )}
      </div>
    </details>
  );
}

export function ContractDetailsPage() {
  const { user, signOut } = useAuth();
  const { setActiveSession } = useActiveContractSession();
  const { markReviewed } = useContractReviewState();
  const archiveMutation = useArchiveContract();
  const unarchiveMutation = useUnarchiveContract();
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
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<
    Record<string, boolean>
  >({});
  const [isSummaryExpanded, setSummaryExpanded] = useState(false);

  useEffect(() => {
    if (!requestedKind) {
      return;
    }
    setActiveKind(requestedKind);
  }, [requestedKind, sessionId]);

  useEffect(() => {
    setExpandedHistory({});
    setSummaryExpanded(false);
  }, [sessionId]);

  const contractQuery = useContractDetails(sessionId ?? null);
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

  const contractData = contractQuery.data ?? null;
  const contractType = contractData
    ? getSupportedContractByTypeBlueId(contractData.typeBlueId)?.typeName ??
      null
    : null;
  const isDeliveryContract = contractType === 'PayNote/PayNote Delivery';
  const proposal = proposalQuery.data ?? null;
  const contract = activeKind === 'contract' ? contractData : null;
  const aiChatSessionId = contract?.sessionId ?? null;
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
  const relatedTransactionIds =
    relatedActivitySource?.relatedTransactionIds ?? [];
  const relatedHoldIds = relatedActivitySource?.relatedHoldIds ?? [];
  const hasRelatedContractIds =
    relatedTransactionIds.length > 0 || relatedHoldIds.length > 0;
  const relatedContractsQuery = useRelatedContracts({
    transactionIds: relatedTransactionIds,
    holdIds: relatedHoldIds,
    enabled: hasRelatedContractIds,
  });
  const relatedContracts = relatedContractsQuery.data ?? [];
  const { visibleRelatedContracts } =
    getVisibleRelatedContracts(relatedContracts);
  const filteredRelatedContracts = useMemo(
    () =>
      visibleRelatedContracts.filter(
        item => getRelatedContractSessionId(item) !== (sessionId ?? undefined)
      ),
    [visibleRelatedContracts, sessionId]
  );
  const relatedContractsErrorMessage =
    relatedContractsQuery.isError &&
    relatedContractsQuery.error instanceof Error
      ? relatedContractsQuery.error.message
      : null;
  const shouldRenderLinkedContracts =
    relatedContractsQuery.isLoading ||
    Boolean(relatedContractsErrorMessage) ||
    filteredRelatedContracts.length > 0;
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

  const reviewSummary = useMemo<ContractSummary | null>(() => {
    if (!contract) {
      return null;
    }
    return {
      contractId: contract.contractId,
      typeBlueId: contract.typeBlueId,
      displayName: contract.displayName,
      sessionId: contract.sessionId,
      documentId: contract.documentId,
      status: contract.status,
      archivedAt: contract.archivedAt,
      summaryPreview: contract.summary?.listPreview,
      summaryUpdatedAt: contract.summaryUpdatedAt,
      summarySourceUpdatedAt: contract.summarySourceUpdatedAt,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
      from: { name: 'Merchant' },
    };
  }, [contract]);

  useEffect(() => {
    if (!reviewSummary) {
      return;
    }
    if (activeKind === 'contract') {
      markReviewed(reviewSummary);
    }
  }, [activeKind, reviewSummary, markReviewed]);

  useEffect(() => {
    if (isDeliveryContract && activeKind !== 'proposal') {
      setActiveKind('proposal');
    }
  }, [activeKind, isDeliveryContract]);

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
  const proposalSummarySessionId =
    proposal?.deliverySessionId ?? sessionId ?? null;
  const proposalSummaryQuery = useProposalSummary(
    proposalSummarySessionId,
    Boolean(proposal && proposalSummarySessionId)
  );
  const proposalSummary = proposalSummaryQuery.data?.summary ?? null;
  const summary = contract ? contract?.summary ?? null : proposalSummary;
  const hasSummaryContent =
    Boolean(summary?.story?.headline?.trim()) ||
    Boolean(summary?.story?.overview?.length) ||
    Boolean(summary?.story?.bullets?.length) ||
    Boolean(summary?.nextSteps?.items?.length) ||
    Boolean(summary?.lastChange?.short?.trim());
  const resolvedSummary = hasSummaryContent ? summary : null;
  const summaryErrorMessage = contract
    ? contract?.summaryError ?? null
    : proposalSummaryQuery.error instanceof Error
    ? proposalSummaryQuery.error.message
    : null;
  const summaryHeadline =
    resolvedSummary?.story?.headline?.trim() ||
    getDocumentName(resolvedDocument) ||
    headerTitle;
  const summaryOverview = resolvedSummary?.story?.overview ?? [];
  const summaryBullets = resolvedSummary?.story?.bullets ?? [];
  const summaryNextSteps = resolvedSummary?.nextSteps?.items ?? [];
  const summaryNextStepsTitle =
    resolvedSummary?.nextSteps?.title ?? 'Next steps';
  const summaryLastChangeShort =
    resolvedSummary?.lastChange?.short?.trim() || null;
  const hasSummaryExtras =
    summaryBullets.length > 0 ||
    summaryNextSteps.length > 0 ||
    Boolean(summaryLastChangeShort);
  const isSummaryLoading =
    proposalSummaryQuery.isLoading && !resolvedSummary && !!proposal;
  const isSummaryFetching =
    proposalSummaryQuery.isFetching && !!resolvedSummary;
  const proposalSummaryFallback = proposalSummaryQuery.timedOut
    ? 'Sorry, contract summary is not available.'
    : 'Summary not available yet.';
  const summaryFallbackText =
    (summaryOverview[0] ??
      (contract ? getDocumentDescription(resolvedDocument) : null)) ||
    (contract ? 'Summary unavailable.' : proposalSummaryFallback);

  useEffect(() => {
    setIsAiChatOpen(false);
  }, [aiChatSessionId]);

  const historyQuery = useContractHistory(
    contractData?.sessionId ?? null,
    Boolean(contractData?.sessionId)
  );
  const historyItems = historyQuery.data?.items ?? [];
  const hasHistory = historyItems.length > 0;
  const isArchivePending =
    archiveMutation.isPending || unarchiveMutation.isPending;

  const contractStatusStyles: Record<string, string> = {
    accepted: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
    rejected: 'bg-rose-50 text-rose-700 border border-rose-100',
    pending: 'bg-amber-50 text-amber-700 border border-amber-100',
    bootstrapped: 'bg-sky-50 text-sky-700 border border-sky-100',
  };

  const handleLinkedContractClick = (item: RelatedContractItem) => {
    const target = getRelatedContractTarget(item);
    const itemSessionId = getRelatedContractSessionId(item);
    if (!target || !itemSessionId) {
      return;
    }
    setActiveSession(itemSessionId);
    navigate(target, {
      state: {
        from: `${location.pathname}${location.search}`,
      },
    });
  };

  const handleArchiveToggle = () => {
    if (!contract?.sessionId || isArchivePending) {
      return;
    }
    if (contract.archivedAt) {
      unarchiveMutation.mutate({ sessionId: contract.sessionId });
    } else {
      archiveMutation.mutate({ sessionId: contract.sessionId });
    }
  };

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
          <div className="hidden lg:flex items-center gap-3">
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
      <section className="app-surface p-4 sm:p-6 rounded-none sm:rounded-[20px] shadow-none sm:shadow-[var(--shadow-soft)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Contract
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              {headerTitle}
            </h2>
          </div>
          {contract && (
            <Dropdown
              trigger={
                <div className="flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900">
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
                </div>
              }
              align="right"
              triggerAriaLabel="More options"
            >
              <DropdownItem
                onClick={handleArchiveToggle}
                className={
                  isArchivePending ? 'opacity-60 cursor-not-allowed' : ''
                }
              >
                {contract.archivedAt ? 'Restore contract' : 'Archive contract'}
              </DropdownItem>
            </Dropdown>
          )}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <div className="flex flex-col gap-4">
            <div className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar
                    name={senderName}
                    size="xl"
                    className="h-14 w-14 text-base sm:h-16 sm:w-16 sm:text-lg"
                  />
                  <div className="text-sm font-semibold text-slate-900">
                    {senderName}
                  </div>
                </div>
                {aiChatSessionId ? (
                  <button
                    type="button"
                    className="text-sm font-semibold text-[color:var(--color-primary)] opacity-70 hover:opacity-100"
                    aria-label="Talk with AI"
                    onClick={() => setIsAiChatOpen(true)}
                  >
                    Talk with AI
                  </button>
                ) : null}
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

                {resolvedSummary ? (
                  <div>
                    <h3 className="text-[32px] leading-[40px] font-semibold text-slate-900">
                      {summaryHeadline}
                    </h3>
                    {summaryOverview.map((paragraph, index) => (
                      <p
                        key={`${summaryHeadline}-${index}`}
                        className="mt-2 whitespace-pre-line break-words text-base text-slate-600 leading-6"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                ) : !isSummaryLoading ? (
                  <p className="text-sm text-slate-600">
                    {summaryFallbackText}
                  </p>
                ) : null}

                <div className="pt-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--color-primary)]"
                    onClick={() => setSummaryExpanded(prev => !prev)}
                    aria-expanded={isSummaryExpanded}
                  >
                    {isSummaryExpanded ? 'Less' : 'More'}
                    <svg
                      className={`h-3 w-3 transition ${
                        isSummaryExpanded ? 'rotate-180' : ''
                      }`}
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
                  </button>
                </div>

                {isSummaryExpanded && (
                  <div className="mt-3 space-y-3">
                    {summaryBullets.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Highlights
                        </p>
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-base text-slate-700">
                          {summaryBullets.map(item => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {summaryLastChangeShort && (
                      <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Latest update
                        </p>
                        <p className="mt-2 text-base font-semibold text-slate-900">
                          {summaryLastChangeShort}
                        </p>
                      </div>
                    )}

                    {summaryNextSteps.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          {summaryNextStepsTitle}
                        </p>
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-base text-slate-700">
                          {summaryNextSteps.map(step => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {(hasSummaryExtras || contract || proposal) && (
                      <ContractDetailsAccordion contract={contract} />
                    )}
                  </div>
                )}
              </div>
            </div>

            {contract && (
              <section className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-base font-semibold text-slate-900">
                  Available operations
                </h3>
                <div className="mt-4">
                  <ContractOperationsList contract={contract} />
                </div>
              </section>
            )}

            {relatedActivitySource && (
              <ContractRelatedActivitySection
                contract={relatedActivitySource}
                title="Linked transactions"
                hideWhenEmpty
              />
            )}

            {shouldRenderLinkedContracts && (
              <section className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-base font-semibold text-slate-900">
                  Linked contracts
                </h3>

                {relatedContractsQuery.isLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Spinner size="md" color="green" />
                  </div>
                )}

                {!relatedContractsQuery.isLoading &&
                  relatedContractsErrorMessage && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-600">
                      {relatedContractsErrorMessage}
                    </div>
                  )}

                {!relatedContractsQuery.isLoading &&
                  !relatedContractsErrorMessage &&
                  filteredRelatedContracts.length > 0 &&
                  hasRelatedContractIds && (
                    <div className="mt-4 space-y-3">
                      {filteredRelatedContracts.map(contractItem => {
                        const isProposal =
                          isProposalRelatedContract(contractItem);
                        const isSelectable = isProposal
                          ? Boolean(contractItem.deliverySessionId)
                          : Boolean(contractItem.sessionId);
                        let primaryName = 'Contract';
                        let statusValue: string | undefined;
                        let contractDate: string | null = null;
                        let displayName = 'Contract';

                        if (isProposal) {
                          primaryName =
                            contractItem.name?.trim() || 'PayNote proposal';
                          statusValue =
                            contractItem.clientDecisionStatus ?? 'pending';
                          contractDate = formatShortDateTime(
                            contractItem.updatedAt ?? contractItem.createdAt
                          );
                          displayName = 'Proposal';
                        } else {
                          primaryName =
                            contractItem.documentName?.trim() ||
                            contractItem.displayName;
                          statusValue = contractItem.status ?? 'pending';
                          contractDate = formatShortDateTime(
                            getContractLastChangeAt(contractItem) ??
                              contractItem.updatedAt ??
                              contractItem.createdAt
                          );
                          displayName = contractItem.displayName;
                        }

                        const statusKey = statusValue?.toLowerCase() ?? '';
                        const statusStyle =
                          contractStatusStyles[statusKey] ??
                          'bg-slate-100 text-slate-700 border border-slate-200';

                        return (
                          <button
                            key={
                              isProposal
                                ? `proposal-${contractItem.deliveryId}`
                                : contractItem.contractId
                            }
                            type="button"
                            className={`w-full rounded-xl border p-4 text-left transition ${
                              isSelectable
                                ? 'border-slate-200 bg-white/80 hover:border-emerald-200 hover:shadow-md'
                                : 'border-slate-200 bg-white/50 opacity-60 cursor-not-allowed'
                            }`}
                            onClick={() => {
                              if (!isSelectable) {
                                return;
                              }
                              handleLinkedContractClick(contractItem);
                            }}
                            disabled={!isSelectable}
                          >
                            <div className="sm:hidden">
                              <p className="text-sm font-semibold text-slate-900 truncate">
                                {primaryName}
                              </p>
                              {contractDate && (
                                <p className="mt-1 text-xs text-slate-500">
                                  {contractDate}
                                </p>
                              )}
                            </div>
                            <div className="hidden sm:block space-y-2">
                              <p className="text-sm font-semibold text-slate-900 truncate">
                                {primaryName}
                              </p>
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="app-chip app-chip-neutral">
                                  {displayName}
                                </span>
                                <span
                                  className={`text-xs font-semibold px-2 py-1 rounded-full ${statusStyle}`}
                                >
                                  {formatStatusLabel(statusValue)}
                                </span>
                                {contractDate && (
                                  <span className="text-xs text-slate-500">
                                    {contractDate}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
              </section>
            )}

            {hasHistory && (
              <details className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-4">
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
                              {item.short}
                            </p>
                          </div>
                          {item.createdAt && (
                            <span className="text-xs text-slate-500">
                              {formatShortDateTime(item.createdAt)}
                            </span>
                          )}
                        </div>
                        {item.more && (
                          <div className="mt-2 text-sm text-slate-600">
                            {expandedHistory[item.id] && (
                              <p className="whitespace-pre-line break-words leading-relaxed">
                                {item.more}
                              </p>
                            )}
                            <button
                              type="button"
                              className="mt-2 text-xs font-semibold text-[color:var(--color-primary)]"
                              onClick={() =>
                                setExpandedHistory(prev => ({
                                  ...prev,
                                  [item.id]: !prev[item.id],
                                }))
                              }
                            >
                              {expandedHistory[item.id] ? 'Less' : 'More'}
                            </button>
                          </div>
                        )}
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

      {aiChatSessionId && contract?.updatedAt && (
        <ContractAiChatDrawer
          isOpen={isAiChatOpen}
          sessionId={aiChatSessionId}
          documentTitle={headerTitle}
          contractUpdatedAt={contract.updatedAt}
          onClose={() => setIsAiChatOpen(false)}
        />
      )}
    </DashboardShell>
  );
}
