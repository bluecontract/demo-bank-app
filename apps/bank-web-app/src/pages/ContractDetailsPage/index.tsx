import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { DashboardShell } from '../../features/dashboard/components';
import {
  useAcceptPayNoteDelivery,
  useActiveContractSession,
  useContractDetails,
  useProposalDetails,
  useRejectPayNoteDelivery,
} from '../../features/contracts/hooks';
import {
  getDocumentName,
  restoreInlineTypes,
} from '../../features/contracts/lib/contractDocumentUtils';
import { ContractOperationsList } from '../../features/contracts/components/ContractOperationsList';
import { ContractRawDocument } from '../../features/contracts/components/ContractRawDocument';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { SpinnerWithText } from '../../ui/Spinner';
import { formatCurrency } from '../../lib/formatCurrency';
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

  if (!proposal) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500">
        Pending actions will appear here once they are available.
      </div>
    );
  }

  const decisionStatus = proposal.clientDecisionStatus ?? 'pending';
  const isDecisionLocked =
    decisionStatus === 'accepted' || decisionStatus === 'rejected';
  const isDecisionPending =
    acceptMutation.isPending || rejectMutation.isPending;
  const decisionSessionId = proposal.deliverySessionId ?? sessionId;
  const amountLine =
    proposal.payNote?.amountMinor != null
      ? `${formatCurrency(proposal.payNote.amountMinor)}${
          proposal.payNote.currency ? ` ${proposal.payNote.currency}` : ''
        }`
      : null;
  const subtitle = amountLine
    ? `Amount: ${amountLine}`
    : 'Review the proposal details before deciding.';

  const handleAccept = () => {
    if (!decisionSessionId || isDecisionLocked) return;
    acceptMutation.mutate(decisionSessionId);
  };

  const handleReject = () => {
    if (!decisionSessionId || isDecisionLocked) return;
    rejectMutation.mutate({ sessionId: decisionSessionId });
  };

  const statusCopy =
    decisionStatus === 'accepted'
      ? 'You accepted this proposal.'
      : decisionStatus === 'rejected'
      ? 'You rejected this proposal.'
      : 'Please decide on the proposal below.';

  return (
    <div className="rounded-2xl border-2 border-[color:var(--color-primary)] bg-white p-4">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
        Proposal
      </p>
      <h3 className="mt-2 text-lg font-semibold text-slate-900">
        {proposal.payNote?.name?.trim() || 'Approve the contract'}
      </h3>
      <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
      <p className="mt-3 text-sm text-slate-600">{statusCopy}</p>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
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
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as LocationState | null) ?? null;
  const backTarget = locationState?.from || '/contracts';

  const [activeKind, setActiveKind] = useState<'contract' | 'proposal'>(
    locationState?.kind ?? 'contract'
  );

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
                <h3 className="text-lg font-semibold text-slate-900">
                  Story details are being prepared.
                </h3>
                <p className="text-sm text-slate-600">
                  We will summarize the contract’s current state, next steps,
                  and any required actions here.
                </p>
                <p className="text-sm text-slate-600">
                  Until then, review the raw document and available operations
                  in the details section below.
                </p>
              </div>

              <div className="mt-4">
                <ContractDetailsAccordion contract={contract} />
              </div>
            </div>

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
                History entries will appear here once available.
              </div>
            </details>
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
