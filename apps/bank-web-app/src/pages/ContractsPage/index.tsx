import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  DashboardHeader,
  SidebarNav,
} from '../../features/dashboard/components';
import {
  ContractDetailsPanel,
  ProposalDetailsPanel,
} from '../../features/contracts/components';
import { Card } from '../../ui/Card';
import { Spinner } from '../../ui/Spinner';
import {
  useContracts,
  useProposals,
  useContractDetails,
  useProposalDetails,
  useContractReviewState,
  useActiveContractSession,
} from '../../features/contracts/hooks';
import type { ContractOrProposalItem } from '../../features/contracts/lib/contractsAndProposals';
import { dedupeContracts } from '../../features/contracts/lib/dedupeContracts';
import {
  mergeContractsAndProposals,
  getItemSessionId,
  isProposalItem,
} from '../../features/contracts/lib/contractsAndProposals';
import {
  getProposalDecisionStatus,
  isContractArchived,
  isInboxItem,
  isImportantProposal,
  isRejectedProposal,
} from '../../features/contracts/lib/contractListFilters';
import { Avatar } from '../../ui/Avatar';
import { formatCurrency } from '../../lib/formatCurrency';

type ContractsTabKey = 'inbox' | 'important' | 'data-permissions' | 'archive';

const tabLabels: Record<ContractsTabKey, string> = {
  inbox: 'Inbox',
  important: 'Important',
  'data-permissions': 'Data Permissions',
  archive: 'Archive',
};

const formatListDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
  });
};

const formatStatus = (value?: string) => {
  if (!value) return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
};

const getProposalPreview = (item: ContractOrProposalItem): string => {
  if (!isProposalItem(item)) {
    return '';
  }
  if (item.amountMinor != null) {
    const currency = item.currency ? ` ${item.currency}` : '';
    return `${formatCurrency(item.amountMinor)}${currency}`;
  }
  if (item.transactionId) {
    return `Transaction ${item.transactionId}`;
  }
  return formatStatus(getProposalDecisionStatus(item));
};

const getContractPreview = (item: ContractOrProposalItem): string => {
  if (isProposalItem(item)) {
    return '';
  }
  if (item.status) {
    return `Status: ${formatStatus(item.status)}`;
  }
  return 'Contract updated';
};

const getSubject = (item: ContractOrProposalItem): string => {
  if (isProposalItem(item)) {
    return item.name?.trim() || 'PayNote proposal';
  }
  return item.documentName?.trim() || item.displayName?.trim() || 'Contract';
};

const getSender = (item: ContractOrProposalItem): string => {
  if (isProposalItem(item)) {
    return item.name?.trim() || 'PayNote proposal';
  }
  return item.displayName?.trim() || 'Contract';
};

export function ContractsPage() {
  const { user } = useAuth();
  const { markReviewed } = useContractReviewState();
  const { activeSessionId, setActiveSession } = useActiveContractSession();
  const [searchParams] = useSearchParams();
  const requestedSessionId = searchParams.get('sessionId');
  const lastAppliedRequestedSessionId = useRef<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<ContractsTabKey>('inbox');

  const contractsQuery = useContracts();
  const proposalsQuery = useProposals();
  const { refetch: refetchContracts } = contractsQuery;
  const { refetch: refetchProposals } = proposalsQuery;
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
  const proposalSessionToContractSession = useMemo(() => {
    const mapping = new Map<string, string>();
    listItems.forEach(item => {
      if (
        !isProposalItem(item) &&
        'originProposalSessionId' in item &&
        item.originProposalSessionId &&
        item.sessionId
      ) {
        mapping.set(item.originProposalSessionId, item.sessionId);
      }
    });
    return mapping;
  }, [listItems]);

  const selectedItem = useMemo(
    () =>
      listItems.find(item => getItemSessionId(item) === selectedSessionId) ??
      null,
    [listItems, selectedSessionId]
  );
  const selectedKind = selectedItem
    ? isProposalItem(selectedItem)
      ? 'proposal'
      : 'contract'
    : null;

  const contractDetailsQuery = useContractDetails(
    selectedSessionId && selectedKind === 'contract' ? selectedSessionId : null
  );
  const proposalDetailsQuery = useProposalDetails(
    selectedSessionId && selectedKind === 'proposal' ? selectedSessionId : null
  );

  const handleProposalDecisionComplete = () => {
    void proposalDetailsQuery.refetch();
    void refetchProposals();
    void refetchContracts();
  };

  useEffect(() => {
    if (!requestedSessionId) {
      lastAppliedRequestedSessionId.current = null;
      return;
    }
    if (requestedSessionId === lastAppliedRequestedSessionId.current) {
      return;
    }
    lastAppliedRequestedSessionId.current = requestedSessionId;
    setSelectedSessionId(requestedSessionId);
  }, [requestedSessionId]);
  const isListLoading =
    listItems.length === 0 &&
    (contractsQuery.isLoading || proposalsQuery.isLoading);
  const isListError = contractsQuery.isError || proposalsQuery.isError;

  const inboxItems = useMemo(() => listItems.filter(isInboxItem), [listItems]);
  const importantItems = useMemo(
    () =>
      inboxItems.filter(
        item => isProposalItem(item) && isImportantProposal(item)
      ),
    [inboxItems]
  );
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

  useEffect(() => {
    if (selectedSessionId || listItems.length === 0 || requestedSessionId) {
      return;
    }

    const selectableItems = inboxItems.length > 0 ? inboxItems : listItems;

    if (activeSessionId) {
      const matching = selectableItems.find(
        item => getItemSessionId(item) === activeSessionId
      );
      if (matching) {
        const sid = getItemSessionId(matching);
        if (sid) {
          setSelectedSessionId(sid);
          if (!isProposalItem(matching)) {
            markReviewed(matching);
          }
          return;
        }
      }
    }

    const firstWithSession = selectableItems.find(item =>
      getItemSessionId(item)
    );
    const sid = firstWithSession ? getItemSessionId(firstWithSession) : null;
    if (sid) {
      setSelectedSessionId(sid);
      if (firstWithSession && !isProposalItem(firstWithSession)) {
        markReviewed(firstWithSession);
      }
    }
  }, [
    activeSessionId,
    inboxItems,
    listItems,
    markReviewed,
    requestedSessionId,
    selectedSessionId,
  ]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    const mappedSession =
      proposalSessionToContractSession.get(selectedSessionId);
    if (mappedSession && mappedSession !== selectedSessionId) {
      setSelectedSessionId(mappedSession);
    }
  }, [proposalSessionToContractSession, selectedSessionId]);

  useEffect(() => {
    if (selectedSessionId && selectedSessionId !== activeSessionId) {
      setActiveSession(selectedSessionId);
    }
  }, [activeSessionId, selectedSessionId, setActiveSession]);

  useEffect(() => {
    return () => setActiveSession(null);
  }, [setActiveSession]);

  useEffect(() => {
    const disablePolling = __UI_REFRESH_DISABLE_POLLING__ === 'true';
    if (disablePolling) {
      return;
    }

    const interval = setInterval(() => {
      void refetchContracts();
      void refetchProposals();
    }, 5000);

    return () => clearInterval(interval);
  }, [refetchContracts, refetchProposals]);

  const handleSelectItem = (item: ContractOrProposalItem) => {
    const sid = getItemSessionId(item);
    if (!sid) {
      return;
    }
    setSelectedSessionId(sid);
    setActiveSession(sid);
    if (!isProposalItem(item)) {
      markReviewed(item);
    }
  };

  const importantCount = importantItems.length;
  const visibleItems = useMemo(() => {
    switch (activeTab) {
      case 'important':
        return importantItems;
      case 'archive':
        return archiveItems;
      case 'data-permissions':
        return [];
      case 'inbox':
      default:
        return inboxItems;
    }
  }, [activeTab, archiveItems, inboxItems, importantItems]);

  const getEmptyState = () => {
    switch (activeTab) {
      case 'important':
        return {
          title: 'No important items',
          description: 'Pending or accepted proposals will appear here.',
        };
      case 'data-permissions':
        return {
          title: 'No data permissions yet',
          description: 'Data permissions will appear here once available.',
        };
      case 'archive':
        return {
          title: 'No archived items',
          description: 'Rejected proposals and archived contracts show here.',
        };
      case 'inbox':
      default:
        return {
          title: 'No contracts yet',
          description:
            'Active contracts and proposals will appear in your inbox.',
        };
    }
  };

  return (
    <div className="app-shell flex" data-testid="contracts-main-container">
      <SidebarNav />

      <div className="flex-1 flex flex-col min-h-screen">
        <div className="px-6 pt-8 pb-4 lg:px-10">
          <DashboardHeader
            userEmail={user?.email || 'Guest'}
            title="Contracts"
            description="Review supported contracts and execute document operations."
          />
        </div>

        <main className="flex-1 px-6 pb-10 lg:px-10 flex flex-col gap-6 min-h-0">
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] min-h-0">
            <div className="app-surface overflow-hidden flex flex-col min-h-0">
              <div className="flex flex-wrap items-center border-b border-[color:var(--color-border)]">
                {(Object.keys(tabLabels) as ContractsTabKey[]).map(tab => {
                  const isActive = activeTab === tab;
                  const badgeCount =
                    tab === 'important' ? importantCount : undefined;
                  return (
                    <button
                      key={tab}
                      type="button"
                      className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold transition ${
                        isActive
                          ? 'text-slate-900 border-b-2 border-[color:var(--color-primary)]'
                          : 'text-slate-500 hover:text-slate-700 border-b-2 border-transparent'
                      }`}
                      onClick={() => setActiveTab(tab)}
                    >
                      <span>{tabLabels[tab]}</span>
                      {badgeCount && badgeCount > 0 && (
                        <span className="inline-flex min-w-5 items-center justify-center rounded bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">
                          {badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-[color:var(--color-border)]">
                <div className="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)_120px] gap-6 px-4 py-2 text-xs font-semibold text-slate-500">
                  <span>From</span>
                  <span>Name</span>
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
                    const isSelected =
                      sessionId != null && sessionId === selectedSessionId;
                    const itemKey = isProposalItem(item)
                      ? `proposal-${item.deliveryId}`
                      : item.contractId;
                    const sender = getSender(item);
                    const subject = getSubject(item);
                    const preview = isProposalItem(item)
                      ? getProposalPreview(item)
                      : getContractPreview(item);
                    const updatedAt = formatListDate(item.updatedAt);

                    return (
                      <button
                        key={itemKey}
                        type="button"
                        className={`grid w-full grid-cols-[minmax(0,200px)_minmax(0,1fr)_120px] gap-6 px-4 py-3 text-left transition ${
                          isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => {
                          if (!sessionId) {
                            return;
                          }
                          handleSelectItem(item);
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar name={sender} size="sm" />
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {sender}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                          <span className="shrink-0 font-semibold text-slate-900">
                            {subject}
                          </span>
                          <span className="text-slate-400">—</span>
                          <span className="min-w-0 truncate text-slate-600">
                            {preview}
                          </span>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          {updatedAt}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="min-h-0">
              {selectedKind === 'proposal' ? (
                <ProposalDetailsPanel
                  proposal={proposalDetailsQuery.data ?? null}
                  sessionId={selectedSessionId}
                  isLoading={proposalDetailsQuery.isLoading}
                  isError={proposalDetailsQuery.isError}
                  errorMessage={
                    proposalDetailsQuery.error instanceof Error
                      ? proposalDetailsQuery.error.message
                      : undefined
                  }
                  onDecisionComplete={handleProposalDecisionComplete}
                />
              ) : selectedSessionId && !selectedItem && isListLoading ? (
                <Card className="flex items-center justify-center min-h-[420px]">
                  <Spinner size="lg" color="green" />
                </Card>
              ) : (
                <ContractDetailsPanel
                  contract={contractDetailsQuery.data ?? null}
                  isLoading={contractDetailsQuery.isLoading}
                  isError={contractDetailsQuery.isError}
                  errorMessage={
                    contractDetailsQuery.error instanceof Error
                      ? contractDetailsQuery.error.message
                      : undefined
                  }
                />
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
