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

    return collectContractOperations({
      document: contract.document,
      operationsChannelKey: supportedContract.operationsChannelKey,
      blue,
    });
  }, [contract.document, supportedContract]);

  const activeOperationDetails = operations.find(
    operation => operation.name === activeOperation
  );

  useEffect(() => {
    setActiveOperation(null);
  }, [contract.sessionId]);

  const buttonClasses =
    variant === 'compact'
      ? 'w-full rounded-xl border px-3 py-2 text-left transition'
      : 'w-full rounded-xl border p-3 text-left transition';

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
              className={`${buttonClasses} ${
                activeOperation === operation.name
                  ? 'border-[color:var(--color-primary)] bg-[rgba(43,190,156,0.08)]'
                  : 'border-slate-200 bg-white hover:border-emerald-200'
              }`}
              onClick={() => setActiveOperation(operation.name)}
            >
              <p className="text-sm font-semibold text-slate-900">
                {operation.label}
              </p>
              {operation.description && (
                <p className="mt-1 text-xs text-slate-500">
                  {operation.description}
                </p>
              )}
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
