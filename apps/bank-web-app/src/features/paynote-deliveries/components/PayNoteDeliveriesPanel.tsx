import { useState } from 'react';
import { Card } from '../../../ui/Card';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { formatCurrency } from '../../../lib/formatCurrency';
import type { PayNoteDeliverySummary } from '../../../types/api';
import {
  usePayNoteDeliveries,
  usePayNoteDeliveryDetails,
  useRunContractOperation,
} from '../hooks';
import { PayNoteDeliveryDetailsModal } from './PayNoteDeliveryDetailsModal';

const decisionStyles: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border border-amber-100',
  accepted: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  rejected: 'bg-rose-50 text-rose-700 border border-rose-100',
};

const identificationStyles: Record<string, string> = {
  identified: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  failed: 'bg-rose-50 text-rose-700 border border-rose-100',
};

const formatLabel = (value?: string) => {
  if (!value) return 'Unknown';
  const normalized = value.replace(/_/g, ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatDeliveryStatus = (value?: string) => {
  if (!value) return 'Pending';
  const token = value.split('/').pop() ?? value;
  return token.replace('Status ', '');
};

const formatDeliveryTitle = (delivery: PayNoteDeliverySummary) =>
  delivery.name || `Delivery ${delivery.deliveryId.slice(0, 6)}`;

const formatAmount = (delivery: PayNoteDeliverySummary) => {
  if (delivery.amountMinor == null) {
    return 'Amount pending';
  }
  const currency = delivery.currency ? ` ${delivery.currency}` : '';
  return `${formatCurrency(delivery.amountMinor)}${currency}`;
};

export function PayNoteDeliveriesPanel() {
  const {
    data: deliveries,
    isLoading,
    isError,
    error,
  } = usePayNoteDeliveries();
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(
    null
  );

  const {
    data: deliveryDetails,
    isLoading: isDetailsLoading,
    isError: isDetailsError,
    error: detailsError,
  } = usePayNoteDeliveryDetails({
    deliveryId: selectedDeliveryId,
    enabled: !!selectedDeliveryId,
  });

  const decisionMutation = useRunContractOperation();
  const decisionErrorMessage =
    decisionMutation.isError && decisionMutation.error
      ? decisionMutation.error.message
      : null;

  const handleDecision = (
    delivery: PayNoteDeliverySummary,
    operation: 'acceptPayNote' | 'rejectPayNote'
  ) => {
    if (!delivery.deliverySessionId) {
      return;
    }
    decisionMutation.mutate({
      sessionId: delivery.deliverySessionId,
      operation,
      deliveryId: delivery.deliveryId,
    });
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" color="green" />
        </div>
      );
    }

    if (isError) {
      return (
        <div className="rounded-xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-600">
          {(error as Error)?.message ||
            'Unable to load PayNote deliveries. Please refresh.'}
        </div>
      );
    }

    if (!deliveries || deliveries.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 p-6 text-center text-sm text-slate-500">
          No PayNote deliveries identified yet.
        </div>
      );
    }

    return (
      <div className="space-y-4 max-h-full overflow-y-auto pr-1">
        {deliveries.map(delivery => {
          const decisionStatus = delivery.clientDecisionStatus || 'pending';
          const identificationStatus =
            delivery.transactionIdentificationStatus || 'identified';
          const isDecisionLocked = decisionStatus !== 'pending';
          const isDecisionPending =
            decisionMutation.isPending &&
            decisionMutation.variables?.sessionId ===
              delivery.deliverySessionId;
          const hasDecisionError =
            decisionMutation.isError &&
            decisionMutation.variables?.sessionId ===
              delivery.deliverySessionId;
          const actionsDisabled =
            !delivery.deliverySessionId ||
            isDecisionLocked ||
            isDecisionPending;

          return (
            <div
              key={delivery.deliveryId}
              className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {formatDeliveryTitle(delivery)}
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">
                    {formatAmount(delivery)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="app-chip app-chip-neutral">
                    {formatDeliveryStatus(delivery.deliveryStatus)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 font-semibold ${
                      identificationStyles[identificationStatus] ??
                      'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    {formatLabel(identificationStatus)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 font-semibold ${
                      decisionStyles[decisionStatus] ??
                      'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    {formatLabel(decisionStatus)}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedDeliveryId(delivery.deliveryId)}
                >
                  View details
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actionsDisabled}
                  onClick={() => handleDecision(delivery, 'rejectPayNote')}
                >
                  Reject
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={actionsDisabled}
                  onClick={() => handleDecision(delivery, 'acceptPayNote')}
                >
                  Accept
                </Button>
              </div>

              {isDecisionPending && (
                <p className="mt-2 text-xs text-slate-500">
                  Sending decision to MyOS...
                </p>
              )}

              {decisionErrorMessage && hasDecisionError && (
                <p className="mt-2 text-xs text-rose-600">
                  {decisionErrorMessage}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <Card className="flex flex-col min-h-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              PayNote Deliveries
            </h2>
            <p className="text-sm text-[color:var(--color-muted)] mt-1">
              Review pending PayNote deliveries and decide on acceptance.
            </p>
          </div>
          <span className="app-chip app-chip-neutral">MyOS Sandbox</span>
        </div>

        <div className="mt-4 flex-1 min-h-0">{renderContent()}</div>
      </Card>

      <PayNoteDeliveryDetailsModal
        isOpen={!!selectedDeliveryId}
        onClose={() => setSelectedDeliveryId(null)}
        delivery={deliveryDetails}
        isLoading={isDetailsLoading}
        isError={isDetailsError}
        errorMessage={
          detailsError instanceof Error ? detailsError.message : undefined
        }
      />
    </>
  );
}
