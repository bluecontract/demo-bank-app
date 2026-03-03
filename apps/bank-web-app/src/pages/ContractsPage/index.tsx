import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type KeyboardEvent,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  DashboardHeader,
  DashboardShell,
} from '../../features/dashboard/components';
import { Spinner } from '../../ui/Spinner';
import {
  useContracts,
  useProposals,
  useContractReviewState,
  useProposalDecision,
} from '../../features/contracts/hooks';
import type { ContractOrProposalItem } from '../../features/contracts/lib/contractsAndProposals';
import { dedupeContracts } from '../../features/contracts/lib/dedupeContracts';
import {
  mergeContractsAndProposals,
  getItemSessionId,
  getItemUpdatedAt,
  isProposalItem,
} from '../../features/contracts/lib/contractsAndProposals';
import { getContractsPollingInterval } from '../../features/contracts/lib/contractsPolling';
import {
  getProposalDecisionStatus,
  isContractArchived,
  isInboxItem,
  isRejectedProposal,
} from '../../features/contracts/lib/contractListFilters';
import { getItemChangeType } from '../../features/contracts/lib/contractReview';
import { Avatar } from '../../ui/Avatar';
import { formatCurrency } from '../../lib/formatCurrency';
import { formatRelativeListDate } from '../../lib/formatDate';
import { formatStatusLabel } from '../../lib/formatStatusLabel';

type ContractsView = 'inbox' | 'archive';

const getProposalPreview = (item: ContractOrProposalItem): string => {
  if (!isProposalItem(item)) {
    return '';
  }
  const proposalDescription =
    item.proposalDescription?.trim() || item.summaryPreview?.trim();
  if (proposalDescription) {
    const prefix = 'Contract proposal:';
    if (proposalDescription.toLowerCase().startsWith(prefix.toLowerCase())) {
      return proposalDescription;
    }
    return `${prefix} ${proposalDescription}`;
  }
  if (item.amountMinor != null) {
    const currency = item.currency ? ` ${item.currency}` : '';
    return `${formatCurrency(item.amountMinor)}${currency}`;
  }
  if (item.transactionId) {
    return `Transaction ${item.transactionId}`;
  }
  return formatStatusLabel(getProposalDecisionStatus(item));
};

const getContractPreview = (item: ContractOrProposalItem): string => {
  if (isProposalItem(item)) {
    return '';
  }
  if (item.summaryPreview) {
    return item.summaryPreview;
  }
  if (item.status) {
    return `Status: ${formatStatusLabel(item.status)}`;
  }
  return 'Contract updated';
};

const getSubject = (item: ContractOrProposalItem): string => {
  if (isProposalItem(item)) {
    return item.name?.trim() || 'PayNote proposal';
  }
  return item.documentName?.trim() || item.displayName?.trim() || 'Contract';
};

const getSender = (item: ContractOrProposalItem): string =>
  item.from?.name?.trim() || 'Merchant';

const pendingActionStatusValues = new Set([
  'pending',
  'pendingactionrequested',
]);

const normalizePendingActionStatus = (value?: string): string =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') ?? '';

const hasActivePendingAction = (item: ContractOrProposalItem): boolean => {
  if (isProposalItem(item)) {
    return false;
  }
  if (item.hasPendingAction === true) {
    return true;
  }
  const normalizedStatus = normalizePendingActionStatus(item.status);
  if (!normalizedStatus) {
    return false;
  }
  if (pendingActionStatusValues.has(normalizedStatus)) {
    return true;
  }
  return normalizedStatus.startsWith('pendingactionrequest');
};

function PendingActionIndicator() {
  return (
    <span
      role="img"
      className="inline-flex h-[21px] w-[18px] shrink-0 items-center justify-center text-[#0062FF]"
      aria-label="Pending action available"
      title="Pending action available"
    >
      <svg
        viewBox="0 0 18 21"
        fill="none"
        className="h-[21px] w-[18px]"
        aria-hidden="true"
      >
        <path
          d="M6.17857 13.6429V11.6071M6.17857 11.6071V4.82143C6.17857 4.0719 6.78619 3.46429 7.53571 3.46429C8.28524 3.46429 8.89286 4.0719 8.89286 4.82143V10.25H13.4433C14.6778 10.25 15.6786 11.2508 15.6786 12.4853V13.6429C15.6786 17.0157 12.9443 19.75 9.57143 19.75H8.89286C5.89474 19.75 3.46429 17.3195 3.46429 14.3214C3.46429 12.8224 4.67951 11.6071 6.17857 11.6071ZM10.9286 7.53571H13.6429C15.5167 7.53571 17.0357 6.01668 17.0357 4.14286C17.0357 2.26903 15.5167 0.75 13.6429 0.75H4.14286C2.26903 0.75 0.75 2.26903 0.75 4.14286C0.75 6.01668 2.26903 7.53571 4.14286 7.53571"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

type ProposalDecisionKeySource = {
  deliveryId?: string;
  deliverySessionId?: string;
};

const getProposalOverrideKey = (
  item: ProposalDecisionKeySource
): string | null => item.deliveryId ?? item.deliverySessionId ?? null;

type ProposalDecisionActionsProps = {
  sessionId: string | null;
  label: string;
  size?: 'sm' | 'md';
  layout?: 'icon-only' | 'icon-with-label';
  onDecision?: (decision: 'accepted' | 'rejected') => void;
};

function ProposalDecisionActions({
  sessionId,
  label,
  size = 'md',
  layout = 'icon-only',
  onDecision,
}: ProposalDecisionActionsProps) {
  const { accept, reject, isPending } = useProposalDecision({
    sessionId,
    onAccepted: () => onDecision?.('accepted'),
    onRejected: () => onDecision?.('rejected'),
  });

  if (!sessionId) {
    return null;
  }

  const buttonSize = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8';
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const padding = size === 'sm' ? 'p-0.5' : 'p-1';
  const baseButton =
    'inline-flex items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50';
  const baseInlineButton =
    'inline-flex items-center gap-2 rounded-md text-slate-700 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50';
  const inlineLabelSize = size === 'sm' ? 'text-xs' : 'text-sm';

  const handleAccept = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isPending) {
      return;
    }
    accept();
  };

  const handleReject = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isPending) {
      return;
    }
    reject();
  };

  if (layout === 'icon-with-label') {
    return (
      <div className="flex items-center gap-6">
        <button
          type="button"
          aria-label={`Accept ${label}`}
          className={`${baseInlineButton} ${inlineLabelSize}`}
          onClick={handleAccept}
          disabled={isPending}
        >
          <span
            className={`inline-flex items-center justify-center rounded-full ${buttonSize} ${padding} bg-[color:var(--color-primary)] text-white`}
            aria-hidden="true"
          >
            <svg
              className={iconSize}
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 10.5l3.2 3.2L15 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>Accept</span>
        </button>
        <button
          type="button"
          aria-label={`Reject ${label}`}
          className={`${baseInlineButton} ${inlineLabelSize}`}
          onClick={handleReject}
          disabled={isPending}
        >
          <span
            className={`inline-flex items-center justify-center rounded-full ${buttonSize} ${padding} bg-[#d32f2f] text-white`}
            aria-hidden="true"
          >
            <svg
              className={iconSize}
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M6 6l8 8M14 6l-8 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>Reject</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`Accept ${label}`}
        className={`${baseButton} ${buttonSize} ${padding} bg-[color:var(--color-primary)] text-white`}
        onClick={handleAccept}
        disabled={isPending}
      >
        <svg
          className={iconSize}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M5 10.5l3.2 3.2L15 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label={`Reject ${label}`}
        className={`${baseButton} ${buttonSize} ${padding} bg-[#d32f2f] text-white`}
        onClick={handleReject}
        disabled={isPending}
      >
        <svg
          className={iconSize}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 6l8 8M14 6l-8 8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

interface ContractsPageProps {
  view?: ContractsView;
}

export function ContractsPage({ view = 'inbox' }: ContractsPageProps) {
  const { user, signOut } = useAuth();
  const { markItemReviewed, reviewedMap } = useContractReviewState();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const refreshInterval = getContractsPollingInterval();
  const contractsQuery = useContracts({ refetchInterval: refreshInterval });
  const proposalsQuery = useProposals({ refetchInterval: refreshInterval });
  const dedupedContracts = useMemo(
    () => (contractsQuery.data ? dedupeContracts(contractsQuery.data) : []),
    [contractsQuery.data]
  );
  const proposals = useMemo(
    () => proposalsQuery.data ?? [],
    [proposalsQuery.data]
  );
  const [proposalDecisionOverrides, setProposalDecisionOverrides] = useState<
    Record<string, 'accepted' | 'rejected'>
  >({});

  useEffect(() => {
    setProposalDecisionOverrides(previous => {
      let changed = false;
      const next = { ...previous };
      const activeKeys = new Set<string>();

      for (const proposal of proposals) {
        const key = getProposalOverrideKey(proposal);
        if (!key) {
          continue;
        }

        activeKeys.add(key);
        const override = next[key];
        if (!override) {
          continue;
        }

        if (getProposalDecisionStatus(proposal) === override) {
          delete next[key];
          changed = true;
        }
      }

      for (const key of Object.keys(next)) {
        if (!activeKeys.has(key)) {
          delete next[key];
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [proposals]);

  const listItems = useMemo(
    () => mergeContractsAndProposals(dedupedContracts, proposals),
    [dedupedContracts, proposals]
  );
  const isListLoading =
    listItems.length === 0 &&
    (contractsQuery.isLoading || proposalsQuery.isLoading);
  const isListError = contractsQuery.isError || proposalsQuery.isError;

  const inboxItems = useMemo(() => listItems.filter(isInboxItem), [listItems]);
  const archiveItems = useMemo(
    () =>
      listItems.filter(item => {
        if (isProposalItem(item)) {
          return isRejectedProposal(item);
        }
        return isContractArchived(item);
      }),
    [listItems]
  );

  const handleSelectItem = (item: ContractOrProposalItem) => {
    const sid = getItemSessionId(item);
    if (!sid) {
      return;
    }
    queryClient.removeQueries({ queryKey: ['contract-details', sid] });
    queryClient.removeQueries({ queryKey: ['proposal-details', sid] });
    markItemReviewed(item);
    navigate(`/contracts/${sid}`, {
      state: {
        from: `${location.pathname}${location.search}`,
        kind: isProposalItem(item) ? 'proposal' : 'contract',
      },
    });
  };

  const visibleItems = view === 'archive' ? archiveItems : inboxItems;

  const getEmptyState = () => {
    if (view === 'archive') {
      return {
        title: 'No archived items',
        description: 'Rejected proposals and archived contracts show here.',
      };
    }
    return {
      title: 'No contracts yet',
      description: 'Active contracts and proposals will appear in your inbox.',
    };
  };

  const header =
    view === 'archive' ? (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/contracts')}
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
          <h1 className="text-3xl font-semibold text-slate-900">
            Archived Contracts
          </h1>
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
    ) : (
      <DashboardHeader
        userEmail={user?.email || 'Guest'}
        title="Contracts"
        description={null}
      />
    );

  return (
    <DashboardShell
      data-testid="contracts-main-container"
      header={header}
      contentWidth="full"
    >
      {view === 'inbox' && (
        <div className="flex min-w-0 items-start justify-between gap-3 text-sm text-slate-600">
          <p className="min-w-0 flex-1 max-w-[560px]">
            Here you can find the smart contracts linked to your transactions.
          </p>
          <button
            type="button"
            className="hidden sm:inline text-sm text-slate-400 hover:text-slate-600"
            onClick={() => navigate('/contracts/archive')}
          >
            Archive
          </button>
          <button
            type="button"
            className="sm:hidden inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500"
            onClick={() => navigate('/contracts/archive')}
            aria-label="Open saved contracts"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <circle cx="10" cy="4" r="1.5" />
              <circle cx="10" cy="10" r="1.5" />
              <circle cx="10" cy="16" r="1.5" />
            </svg>
          </button>
        </div>
      )}

      <section className="app-surface overflow-hidden flex flex-col min-h-0 rounded-none sm:rounded-[20px] shadow-none sm:shadow-[var(--shadow-soft)]">
        <div className="border-b border-[color:var(--color-border)] hidden sm:block">
          <div className="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)_80px_120px] gap-6 px-4 py-2 text-xs font-semibold text-slate-500">
            <span>From</span>
            <span>Contract</span>
            <span className="invisible">Actions</span>
            <div className="w-full text-right">Last change</div>
          </div>
        </div>

        {isListLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" color="green" />
          </div>
        )}

        {!isListLoading && isListError && (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            Unable to load contracts. Please refresh.
          </div>
        )}

        {!isListLoading && !isListError && visibleItems.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            <p className="text-base font-semibold text-slate-700">
              {getEmptyState().title}
            </p>
            <p className="mt-2">{getEmptyState().description}</p>
          </div>
        )}

        {!isListLoading && !isListError && visibleItems.length > 0 && (
          <div className="divide-y divide-[color:var(--color-border)]">
            {visibleItems.map(item => {
              const sessionId = getItemSessionId(item);
              const itemKey = isProposalItem(item)
                ? `proposal-${item.deliveryId}`
                : item.contractId;
              const sender = getSender(item);
              const senderLogo = item.from?.logoUrl;
              const subject = getSubject(item);
              const preview = isProposalItem(item)
                ? getProposalPreview(item)
                : getContractPreview(item);
              const updatedAt = formatRelativeListDate(getItemUpdatedAt(item));
              const changeType = getItemChangeType(item, reviewedMap);
              const isUnread = Boolean(changeType);
              const effectiveProposalStatus = isProposalItem(item)
                ? (() => {
                    const key = getProposalOverrideKey(item);
                    if (key && proposalDecisionOverrides[key]) {
                      return proposalDecisionOverrides[key];
                    }
                    return getProposalDecisionStatus(item);
                  })()
                : undefined;
              const shouldShowActions =
                isProposalItem(item) && effectiveProposalStatus === 'pending';
              const shouldShowPendingActionIndicator =
                hasActivePendingAction(item);
              const handleProposalDecision = (
                decision: 'accepted' | 'rejected'
              ) => {
                if (!isProposalItem(item)) {
                  markItemReviewed(item);
                  return;
                }
                const decisionUpdatedAt = new Date().toISOString();
                markItemReviewed({
                  ...item,
                  clientDecisionStatus: decision,
                  updatedAt: decisionUpdatedAt,
                });
                const key = getProposalOverrideKey(item);
                if (!key) {
                  return;
                }
                setProposalDecisionOverrides(previous => {
                  if (previous[key] === decision) {
                    return previous;
                  }
                  return { ...previous, [key]: decision };
                });
              };
              const senderClassName = isUnread
                ? 'text-sm font-semibold text-slate-900'
                : 'text-sm font-normal text-slate-900';
              const subjectClassName = isUnread
                ? 'shrink-0 font-semibold text-slate-900'
                : 'shrink-0 font-normal text-slate-900';
              const handleRowClick = () => {
                if (!sessionId) {
                  return;
                }
                handleSelectItem(item);
              };
              const handleRowKeyDown = (
                event: KeyboardEvent<HTMLDivElement>
              ) => {
                if (!sessionId) {
                  return;
                }
                if (event.target !== event.currentTarget) {
                  return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelectItem(item);
                }
              };

              return (
                <div
                  key={itemKey}
                  role="button"
                  tabIndex={sessionId ? 0 : -1}
                  aria-disabled={!sessionId}
                  className="w-full text-left transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)]"
                  onClick={handleRowClick}
                  onKeyDown={handleRowKeyDown}
                >
                  <div className="sm:hidden flex gap-3 px-4 py-3">
                    <Avatar
                      name={sender}
                      src={senderLogo}
                      size="lg"
                      className="h-14 w-14 text-base"
                    />
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`truncate ${senderClassName}`}>
                          {sender}
                        </span>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          {shouldShowPendingActionIndicator ? (
                            <PendingActionIndicator />
                          ) : null}
                          <span>{updatedAt}</span>
                        </div>
                      </div>
                      <p className={`mt-1 text-sm ${subjectClassName}`}>
                        {subject}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 truncate">
                        {preview}
                      </p>
                      {shouldShowActions && (
                        <div className="mt-2 pt-1">
                          <ProposalDecisionActions
                            sessionId={sessionId ?? null}
                            label={subject}
                            size="sm"
                            layout="icon-with-label"
                            onDecision={handleProposalDecision}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="hidden sm:grid w-full grid-cols-[minmax(0,200px)_minmax(0,1fr)_80px_120px] gap-6 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={sender} src={senderLogo} size="sm" />
                      <span className={`truncate ${senderClassName}`}>
                        {sender}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <span className={subjectClassName}>{subject}</span>
                      <span className="text-slate-400">—</span>
                      <span className="min-w-0 truncate text-slate-600">
                        {preview}
                      </span>
                    </div>
                    <div className="flex items-center justify-center">
                      {shouldShowActions ? (
                        <ProposalDecisionActions
                          sessionId={sessionId ?? null}
                          label={subject}
                          onDecision={handleProposalDecision}
                        />
                      ) : null}
                    </div>
                    <div className="grid grid-cols-[18px_minmax(0,1fr)] items-center justify-end gap-2 text-right text-xs text-slate-500">
                      <span className="inline-flex items-center justify-center">
                        {shouldShowPendingActionIndicator ? (
                          <PendingActionIndicator />
                        ) : null}
                      </span>
                      <span>{updatedAt}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
