import { Card } from '../../../ui/Card';
import { Spinner } from '../../../ui/Spinner';
import type { ContractSummary } from '../../../types/api';
import { useContractReviewState } from '../hooks/useContractReviewState';
import { getContractChangeType } from '../lib/contractReview';

interface ContractsListPanelProps {
  contracts?: ContractSummary[] | null;
  isLoading?: boolean;
  isError?: boolean;
  selectedSessionId?: string | null;
  onSelect?: (contract: ContractSummary) => void;
}

const statusStyles: Record<string, string> = {
  accepted: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  rejected: 'bg-rose-50 text-rose-700 border border-rose-100',
  pending: 'bg-amber-50 text-amber-700 border border-amber-100',
  bootstrapped: 'bg-sky-50 text-sky-700 border border-sky-100',
};

const formatStatus = (value?: string) => {
  if (!value) return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
};

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function ContractsListPanel({
  contracts,
  isLoading = false,
  isError = false,
  selectedSessionId,
  onSelect,
}: ContractsListPanelProps) {
  const { reviewedMap, markReviewed } = useContractReviewState();

  return (
    <Card className="flex flex-col min-h-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Contracts</h2>
          <p className="text-sm text-[color:var(--color-muted)] mt-1">
            Review document sessions and available operations.
          </p>
        </div>
      </div>

      <div className="mt-4 flex-1 min-h-0">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" color="green" />
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-600">
            Unable to load contracts. Please refresh.
          </div>
        )}

        {!isLoading && !isError && (!contracts || contracts.length === 0) && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 p-6 text-center text-sm text-slate-500">
            No contracts available yet.
          </div>
        )}

        {!isLoading && !isError && contracts && contracts.length > 0 && (
          <div className="space-y-3 max-h-full overflow-y-auto pr-1">
            {contracts.map(contract => {
              const isActive =
                contract.sessionId && contract.sessionId === selectedSessionId;
              const statusKey = contract.status?.toLowerCase() ?? '';
              const statusStyle =
                statusStyles[statusKey] ??
                'bg-slate-100 text-slate-700 border border-slate-200';
              const isSelectable = Boolean(contract.sessionId);
              const primaryName =
                contract.documentName?.trim() || contract.displayName;
              const typeLabel = contract.displayName;
              const changeType = getContractChangeType(contract, reviewedMap);
              const changeLabel = changeType === 'new' ? 'New' : 'Updated';
              const changeStyle =
                changeType === 'new'
                  ? 'bg-teal-50 text-teal-700 border border-teal-100'
                  : 'bg-cyan-50 text-cyan-700 border border-cyan-100';

              return (
                <button
                  key={contract.contractId}
                  type="button"
                  className={`w-full text-left rounded-2xl border p-4 shadow-sm transition ${
                    isActive
                      ? 'border-[color:var(--color-primary)] bg-[rgba(43,190,156,0.08)]'
                      : 'border-slate-200 bg-white/80 hover:border-emerald-200 hover:shadow-md'
                  } ${isSelectable ? '' : 'opacity-60 cursor-not-allowed'}`}
                  onClick={() => {
                    if (!isSelectable) {
                      return;
                    }
                    markReviewed(contract);
                    onSelect?.(contract);
                  }}
                  disabled={!isSelectable}
                >
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {primaryName}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="app-chip app-chip-neutral">
                        {typeLabel}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${statusStyle}`}
                      >
                        {formatStatus(contract.status)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>Updated {formatTimestamp(contract.updatedAt)}</span>
                    {changeType && (
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${changeStyle}`}
                      >
                        {changeLabel}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
