import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  DashboardHeader,
  SidebarNav,
} from '../../features/dashboard/components';
import {
  ContractsListPanel,
  ContractDetailsPanel,
} from '../../features/contracts/components';
import {
  useContracts,
  useContractDetails,
  useContractReviewState,
} from '../../features/contracts/hooks';
import type { ContractSummary } from '../../types/api';
import { dedupeContracts } from '../../features/contracts/lib/dedupeContracts';

export function ContractsPage() {
  const { user } = useAuth();
  const { markReviewed } = useContractReviewState();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );

  const contractsQuery = useContracts();
  const contractDetailsQuery = useContractDetails(selectedSessionId);

  const dedupedContracts = useMemo(
    () => (contractsQuery.data ? dedupeContracts(contractsQuery.data) : []),
    [contractsQuery.data]
  );

  useEffect(() => {
    if (selectedSessionId || dedupedContracts.length === 0) {
      return;
    }

    const firstWithSession = dedupedContracts.find(item => item.sessionId);
    if (firstWithSession?.sessionId) {
      setSelectedSessionId(firstWithSession.sessionId);
      markReviewed(firstWithSession);
    }
  }, [dedupedContracts, markReviewed, selectedSessionId]);

  const handleSelectContract = (contract: ContractSummary) => {
    if (contract.sessionId) {
      setSelectedSessionId(contract.sessionId);
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

        <main className="flex-1 px-6 pb-8 lg:px-10 flex flex-col gap-6 min-h-0">
          <section className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] min-h-0">
            <ContractsListPanel
              contracts={dedupedContracts}
              isLoading={contractsQuery.isLoading}
              isError={contractsQuery.isError}
              selectedSessionId={selectedSessionId}
              onSelect={handleSelectContract}
            />

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
          </section>
        </main>
      </div>
    </div>
  );
}
