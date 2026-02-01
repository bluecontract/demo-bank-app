import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  DashboardHeader,
  SidebarNav,
} from '../../features/dashboard/components';
import {
  ContractsListPanel,
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

  const contractsQuery = useContracts();
  const proposalsQuery = useProposals();
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

  useEffect(() => {
    if (selectedSessionId || listItems.length === 0 || requestedSessionId) {
      return;
    }

    if (activeSessionId) {
      const matching = listItems.find(
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

    const firstWithSession = listItems.find(item => getItemSessionId(item));
    const sid = firstWithSession ? getItemSessionId(firstWithSession) : null;
    if (sid) {
      setSelectedSessionId(sid);
      if (firstWithSession && !isProposalItem(firstWithSession)) {
        markReviewed(firstWithSession);
      }
    }
  }, [
    activeSessionId,
    listItems,
    markReviewed,
    selectedSessionId,
    requestedSessionId,
  ]);

  useEffect(() => {
    if (selectedSessionId && selectedSessionId !== activeSessionId) {
      setActiveSession(selectedSessionId);
    }
  }, [activeSessionId, selectedSessionId, setActiveSession]);

  useEffect(() => {
    return () => setActiveSession(null);
  }, [setActiveSession]);

  const handleSelectItem = (item: ContractOrProposalItem) => {
    const sid = getItemSessionId(item);
    if (sid) {
      setSelectedSessionId(sid);
    }
  };

  const isListLoading = contractsQuery.isLoading || proposalsQuery.isLoading;
  const isListError = contractsQuery.isError || proposalsQuery.isError;

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

        <main className="flex-1 px-6 pb-8 lg:px-10 flex flex-col gap-6 min-h-0">
          <section className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] min-h-0">
            <ContractsListPanel
              items={listItems}
              isLoading={isListLoading}
              isError={isListError}
              selectedSessionId={selectedSessionId}
              onSelect={handleSelectItem}
            />

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
                onDecisionComplete={() => setSelectedSessionId(null)}
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
          </section>
        </main>
      </div>
    </div>
  );
}
