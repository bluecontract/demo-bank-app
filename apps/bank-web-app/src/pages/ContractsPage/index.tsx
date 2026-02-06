import { useMemo, type MouseEvent, type KeyboardEvent } from 'react';
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
  if (item.summaryPreview) {
    return item.summaryPreview;
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

type ProposalDecisionActionsProps = {
  sessionId: string | null;
  label: string;
  size?: 'sm' | 'md';
  onDecision?: () => void;
};

function ProposalDecisionActions({
  sessionId,
  label,
  size = 'md',
  onDecision,
}: ProposalDecisionActionsProps) {
  const { accept, reject, isPending } = useProposalDecision({
    sessionId,
    onAccepted: () => onDecision?.(),
    onRejected: () => onDecision?.(),
  });

  if (!sessionId) {
    return null;
  }

  const buttonSize = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8';
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const padding = size === 'sm' ? 'p-0.5' : 'p-1';
  const baseButton =
    'inline-flex items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50';

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
    <DashboardShell data-testid="contracts-main-container" header={header}>
      {view === 'inbox' && (
        <div className="flex items-start justify-between gap-3 text-sm text-slate-600">
          <p className="max-w-[560px]">
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
            <span className="sr-only">Actions</span>
            <span className="text-right">Last change</span>
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
              const shouldShowActions =
                isProposalItem(item) &&
                getProposalDecisionStatus(item) === 'pending';
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
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`truncate ${senderClassName}`}>
                          {sender}
                        </span>
                        <div className="flex items-center gap-2">
                          {shouldShowActions && (
                            <ProposalDecisionActions
                              sessionId={sessionId ?? null}
                              label={subject}
                              size="sm"
                              onDecision={() => markItemReviewed(item)}
                            />
                          )}
                          <span className="text-xs text-slate-500">
                            {updatedAt}
                          </span>
                        </div>
                      </div>
                      <p className={`mt-1 text-sm ${subjectClassName}`}>
                        {subject}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 truncate">
                        {preview}
                      </p>
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
                          onDecision={() => markItemReviewed(item)}
                        />
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {updatedAt}
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
