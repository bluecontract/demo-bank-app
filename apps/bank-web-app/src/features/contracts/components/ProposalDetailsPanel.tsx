import { Link } from 'react-router-dom';
import { Card } from '../../../ui/Card';
import { Spinner } from '../../../ui/Spinner';
import { Button } from '../../../ui/Button';
import type { PayNoteDeliveryDetailsSanitized } from '../../../types/api';
import { formatCurrency } from '../../../lib/formatCurrency';
import { useAcceptPayNoteDelivery, useRejectPayNoteDelivery } from '../hooks';

interface ProposalDetailsPanelProps {
  proposal?: PayNoteDeliveryDetailsSanitized | null;
  sessionId: string | null;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  onDecisionComplete?: () => void;
}

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

export function ProposalDetailsPanel({
  proposal,
  sessionId,
  isLoading = false,
  isError = false,
  errorMessage,
  onDecisionComplete,
}: ProposalDetailsPanelProps) {
  const acceptMutation = useAcceptPayNoteDelivery();
  const rejectMutation = useRejectPayNoteDelivery();

  const isAcceptPending = acceptMutation.isPending;
  const isRejectPending = rejectMutation.isPending;
  const isDecisionPending = isAcceptPending || isRejectPending;
  const decisionError =
    (acceptMutation.error instanceof Error
      ? acceptMutation.error.message
      : null) ??
    (rejectMutation.error instanceof Error
      ? rejectMutation.error.message
      : null);

  const handleAccept = () => {
    if (!sessionId) return;
    acceptMutation.mutate(sessionId, {
      onSuccess: () => {
        onDecisionComplete?.();
      },
    });
  };

  const handleReject = () => {
    if (!sessionId) return;
    rejectMutation.mutate(
      { sessionId },
      {
        onSuccess: () => {
          onDecisionComplete?.();
        },
      }
    );
  };

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
        {errorMessage || 'Unable to load proposal details.'}
      </Card>
    );
  }

  if (!proposal) {
    return (
      <Card className="p-6 text-sm text-slate-600">
        Select a proposal to view details and accept or reject.
      </Card>
    );
  }

  const payNoteName = proposal.payNote?.name?.trim() || 'PayNote proposal';
  const amountLine =
    proposal.payNote?.amountMinor != null
      ? `${formatCurrency(proposal.payNote.amountMinor)}${
          proposal.payNote.currency ? ` ${proposal.payNote.currency}` : ''
        }`
      : 'Amount not specified';
  const decisionStatus = proposal.clientDecisionStatus ?? 'pending';
  const isDecisionLocked =
    decisionStatus === 'accepted' || decisionStatus === 'rejected';

  return (
    <Card className="flex flex-col gap-6 min-h-0">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-muted)]">
          Proposal
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">
          {payNoteName}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="app-chip app-chip-neutral">Proposal</span>
          <span className="app-chip">
            {decisionStatus === 'pending'
              ? 'Pending'
              : decisionStatus === 'accepted'
              ? 'Accepted'
              : 'Rejected'}
          </span>
          {proposal.updatedAt && (
            <span className="app-chip app-chip-neutral">
              Updated {formatDate(proposal.updatedAt)}
            </span>
          )}
        </div>
      </div>

      <section className="border border-slate-200 rounded-2xl overflow-hidden bg-white/70">
        <header className="px-4 py-3 border-b border-slate-200 bg-white/80">
          <h3 className="text-sm font-semibold text-slate-900">
            PayNote details
          </h3>
        </header>
        <div className="p-4 space-y-3 text-sm text-slate-700">
          <div>
            <span className="text-slate-500">Name</span>
            <p className="font-medium text-slate-900">{payNoteName}</p>
          </div>
          <div>
            <span className="text-slate-500">Amount</span>
            <p className="font-medium text-slate-900">{amountLine}</p>
          </div>
        </div>
      </section>

      {proposal.transactionId && (
        <section className="border border-slate-200 rounded-2xl overflow-hidden bg-white/70">
          <header className="px-4 py-3 border-b border-slate-200 bg-white/80">
            <h3 className="text-sm font-semibold text-slate-900">
              Related transaction
            </h3>
          </header>
          <div className="p-4">
            <Link
              to={`/transactions?txnId=${encodeURIComponent(
                proposal.transactionId
              )}`}
              className="text-sm font-medium text-[color:var(--color-primary)] hover:underline"
            >
              View transaction {proposal.transactionId}
            </Link>
          </div>
        </section>
      )}

      {!isDecisionLocked && (
        <section className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Accept or reject
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Record your decision on this PayNote proposal. Accepting will
              create the PayNote contract.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isDecisionPending}
                onClick={handleReject}
              >
                {isRejectPending ? 'Rejecting...' : 'Reject'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={isDecisionPending}
                onClick={handleAccept}
              >
                {isAcceptPending ? 'Accepting...' : 'Accept'}
              </Button>
            </div>
            {decisionError && (
              <p className="mt-3 text-sm text-rose-600">{decisionError}</p>
            )}
          </div>
        </section>
      )}

      {isDecisionLocked && (
        <p className="text-sm text-slate-600">
          This proposal has already been {decisionStatus}.
        </p>
      )}
    </Card>
  );
}
