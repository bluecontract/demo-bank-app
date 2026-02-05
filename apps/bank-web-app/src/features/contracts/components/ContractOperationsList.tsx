import { useEffect, useMemo, useState } from 'react';
import { getSupportedContractByTypeBlueId } from '@demo-bank-app/shared-bank-api-contract';
import { blue } from '../../../lib/blue';
import type { ContractDetails } from '../../../types/api';
import { collectContractOperations } from '../lib/operations';
import { OperationForm } from './OperationForm';

interface ContractOperationsListProps {
  contract: ContractDetails;
  variant?: 'card' | 'compact';
  emptyLabel?: string;
}

export function ContractOperationsList({
  contract,
  variant = 'card',
  emptyLabel = 'No operations are available for this contract.',
}: ContractOperationsListProps) {
  const [activeOperation, setActiveOperation] = useState<string | null>(null);

  const supportedContract = getSupportedContractByTypeBlueId(
    contract.typeBlueId
  );

  const operations = useMemo(() => {
    if (!contract.document || !supportedContract) {
      return [];
    }

    const collected = collectContractOperations({
      document: contract.document,
      operationsChannelKey: supportedContract.operationsChannelKey,
      blue,
    });
    if (supportedContract.typeName === 'PayNote/PayNote Delivery') {
      return collected.filter(operation =>
        ['acceptPayNote', 'rejectPayNote'].includes(operation.name)
      );
    }
    return collected;
  }, [contract.document, supportedContract]);

  const activeOperationDetails = operations.find(
    operation => operation.name === activeOperation
  );

  useEffect(() => {
    setActiveOperation(null);
  }, [contract.sessionId]);

  const isCompact = variant === 'compact';
  const buttonClasses = isCompact
    ? 'w-full rounded-lg border px-3 py-2 text-left transition'
    : 'w-full rounded-lg border px-3 py-3 sm:p-4 text-left transition';
  const labelClasses = isCompact ? 'text-sm' : 'text-sm sm:text-base';
  const descriptionClasses = isCompact ? 'text-xs' : 'text-xs sm:text-sm';

  return (
    <div>
      {operations.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {operations.map(operation => (
            <button
              key={operation.name}
              type="button"
              className={`${buttonClasses} flex items-center justify-between gap-4 ${
                activeOperation === operation.name
                  ? 'border-[color:var(--color-primary)] bg-[rgba(43,190,156,0.08)]'
                  : 'border-slate-200 bg-white hover:border-emerald-200'
              }`}
              onClick={() => setActiveOperation(operation.name)}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`${labelClasses} font-semibold text-[color:var(--color-primary)]`}
                >
                  {operation.label}
                </p>
                <p
                  className={`mt-1 ${descriptionClasses} text-slate-500 min-h-[20px]`}
                >
                  {operation.description ?? ''}
                </p>
              </div>
              <svg
                className="h-4 w-4 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          ))}
        </div>
      )}

      {activeOperationDetails && contract.sessionId && (
        <div className="mt-3">
          <OperationForm
            isOpen
            operation={activeOperationDetails}
            sessionId={contract.sessionId}
            onClose={() => setActiveOperation(null)}
          />
        </div>
      )}
    </div>
  );
}
