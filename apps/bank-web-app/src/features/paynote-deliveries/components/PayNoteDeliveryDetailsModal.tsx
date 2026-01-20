import { dump as yamlDump } from 'js-yaml';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { formatCurrency } from '../../../lib/formatCurrency';
import type { PayNoteDeliveryDetails } from '../../../types/api';

interface PayNoteDeliveryDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  delivery?: PayNoteDeliveryDetails | null;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
}

const formatYaml = (value: unknown) => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return yamlDump(value, { noRefs: true }).trimEnd();
  } catch {
    return null;
  }
};

const formatDeliveryStatus = (value?: string) => {
  if (!value) return 'Pending';
  const token = value.split('/').pop() ?? value;
  return token.replace('Status ', '');
};

export function PayNoteDeliveryDetailsModal({
  isOpen,
  onClose,
  delivery,
  isLoading = false,
  isError = false,
  errorMessage,
}: PayNoteDeliveryDetailsModalProps) {
  if (!isOpen) {
    return null;
  }

  const deliveryYaml = formatYaml(delivery?.deliveryDocument);
  const payNoteYaml = formatYaml(delivery?.payNoteDocument);
  const amountLabel =
    delivery?.payNote?.amountMinor != null
      ? formatCurrency(delivery.payNote.amountMinor)
      : null;
  const currencyLabel = delivery?.payNote?.currency
    ? ` ${delivery.payNote.currency}`
    : '';

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={event => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      data-testid="paynote-delivery-modal-backdrop"
    >
      <div
        className="bg-white/90 rounded-2xl shadow-xl border border-slate-200 backdrop-blur max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={event => event.stopPropagation()}
        data-testid="paynote-delivery-modal-content"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-muted)]">
                PayNote delivery
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">
                {delivery?.payNote?.name || delivery?.deliveryId || 'Delivery'}
              </h3>
              {amountLabel && (
                <p className="text-sm text-slate-600 mt-1">
                  {amountLabel}
                  {currencyLabel}
                </p>
              )}
            </div>
            {delivery?.deliveryStatus && (
              <span className="app-chip app-chip-neutral">
                {formatDeliveryStatus(delivery.deliveryStatus)}
              </span>
            )}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" color="green" />
            </div>
          )}

          {!isLoading && isError && (
            <div className="rounded-xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700">
              {errorMessage || 'Unable to load PayNote delivery details.'}
            </div>
          )}

          {!isLoading && !isError && delivery && (
            <>
              <div className="grid gap-3 text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Delivery ID</span>
                  <span className="font-medium text-slate-800">
                    {delivery.deliveryId}
                  </span>
                </div>
                {delivery.deliverySessionId && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Session ID</span>
                    <span className="font-medium text-slate-800">
                      {delivery.deliverySessionId}
                    </span>
                  </div>
                )}
                {delivery.accountNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Account</span>
                    <span className="font-medium text-slate-800">
                      {delivery.accountNumber}
                    </span>
                  </div>
                )}
                {delivery.transactionId && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Transaction ID</span>
                    <span className="font-medium text-slate-800">
                      {delivery.transactionId}
                    </span>
                  </div>
                )}
              </div>

              {delivery.cardTransactionDetails && (
                <div className="rounded-xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-700">
                  <p className="text-xs uppercase tracking-widest text-slate-500">
                    Card transaction details
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <span className="text-slate-500">RRN</span>
                      <div className="font-medium text-slate-900">
                        {
                          delivery.cardTransactionDetails
                            .retrievalReferenceNumber
                        }
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">STAN</span>
                      <div className="font-medium text-slate-900">
                        {delivery.cardTransactionDetails.systemTraceAuditNumber}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">Transmission</span>
                      <div className="font-medium text-slate-900">
                        {delivery.cardTransactionDetails.transmissionDateTime}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">Auth code</span>
                      <div className="font-medium text-slate-900">
                        {delivery.cardTransactionDetails.authorizationCode}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="border border-slate-200 rounded-lg overflow-hidden">
                  <header className="px-4 py-2 border-b border-slate-200 bg-white/70">
                    <h4 className="text-sm font-medium text-slate-900">
                      Delivery document
                    </h4>
                  </header>
                  <div className="px-4 py-3">
                    {deliveryYaml ? (
                      <pre className="bg-gray-900 text-green-100 text-sm rounded-md p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                        <code>{deliveryYaml}</code>
                      </pre>
                    ) : (
                      <p className="text-sm text-slate-600">
                        Delivery document not available.
                      </p>
                    )}
                  </div>
                </section>

                <section className="border border-slate-200 rounded-lg overflow-hidden">
                  <header className="px-4 py-2 border-b border-slate-200 bg-white/70">
                    <h4 className="text-sm font-medium text-slate-900">
                      PayNote document
                    </h4>
                  </header>
                  <div className="px-4 py-3">
                    {payNoteYaml ? (
                      <pre className="bg-gray-900 text-green-100 text-sm rounded-md p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                        <code>{payNoteYaml}</code>
                      </pre>
                    ) : (
                      <p className="text-sm text-slate-600">
                        PayNote document not available.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}

          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
