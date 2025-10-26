import { PayNoteDetails } from '../hooks/usePayNoteDetails';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { dump as yamlDump } from 'js-yaml';

interface PayNoteDetailsPanelProps {
  details?: PayNoteDetails;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  errorStatus?: number;
  onRetry: () => void;
  onBack: () => void;
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

export function PayNoteDetailsPanel({
  details,
  isLoading,
  isError,
  errorMessage,
  errorStatus,
  onRetry,
  onBack,
}: PayNoteDetailsPanelProps) {
  const documentYaml = formatYaml(details?.document ?? details?.documentYaml);
  const transactionRequest = formatYaml(details?.transactionRequest);
  const triggerEvent = formatYaml(details?.triggerEvent);
  const resolvedErrorMessage =
    errorMessage || 'We could not load PayNote details.';
  const isNotFound = errorStatus === 404;

  return (
    <div className="py-3" data-testid="paynote-details-view" aria-live="polite">
      <div className="flex items-center gap-3 mb-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={onBack}
          data-testid="paynote-back-button"
          className="flex items-center gap-1"
        >
          ← Back
        </Button>
        <h2 className="text-lg font-semibold text-gray-900">
          PayNote transfer details
        </h2>
      </div>

      {isLoading && (
        <div className="p-8 text-center" data-testid="paynote-loading">
          <Spinner size="lg" color="green" />
          <p className="mt-4 text-gray-600">Loading PayNote details...</p>
        </div>
      )}

      {!isLoading && isError && (
        <div
          className="p-6 border border-gray-200 rounded-lg bg-gray-50 text-center space-y-3"
          data-testid="paynote-error"
        >
          <p className="text-sm text-gray-700">{resolvedErrorMessage}</p>
          {isNotFound && (
            <p className="text-xs text-gray-500">
              We&apos;ll load PayNote details as soon as they become available.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            data-testid="paynote-retry-button"
          >
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-4">
          <section
            className="border border-gray-200 rounded-lg overflow-hidden"
            data-testid="paynote-document-section"
          >
            <header className="px-4 py-2 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-medium text-gray-900">
                PayNote Document
              </h3>
            </header>
            <div className="px-4 py-3">
              {documentYaml ? (
                <pre className="bg-gray-900 text-green-100 text-sm rounded-md p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  <code>{documentYaml}</code>
                </pre>
              ) : (
                <p className="text-sm text-gray-600">
                  No PayNote Document available.
                </p>
              )}
            </div>
          </section>

          <section
            className="border border-gray-200 rounded-lg overflow-hidden"
            data-testid="paynote-transaction-request-section"
          >
            <header className="px-4 py-2 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-medium text-gray-900">
                Transaction Request
              </h3>
            </header>
            <div className="px-4 py-3">
              {transactionRequest ? (
                <pre className="bg-gray-900 text-green-100 text-sm rounded-md p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  <code>{transactionRequest}</code>
                </pre>
              ) : (
                <p className="text-sm text-gray-600">
                  Transaction request details are not available.
                </p>
              )}
            </div>
          </section>

          <section
            className="border border-gray-200 rounded-lg overflow-hidden"
            data-testid="paynote-trigger-event-section"
          >
            <header className="px-4 py-2 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-medium text-gray-900">
                Triggering Event
              </h3>
            </header>
            <div className="px-4 py-3">
              {triggerEvent ? (
                <pre className="bg-gray-900 text-green-100 text-sm rounded-md p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  <code>{triggerEvent}</code>
                </pre>
              ) : (
                <p className="text-sm text-gray-600">
                  Trigger event details are not available.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
