import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Spinner } from '../../../ui/Spinner';
import type { ContractDetails } from '../../../types/api';
import { useAccounts } from '../../accounts/hooks/useAccounts';
import {
  ActivityItem,
  useActivity,
} from '../../transactions/hooks/useActivity';
import { useRelatedActivityItems } from '../../transactions/hooks/useRelatedActivityItems';
import { TransactionItem } from '../../transactions/components/TransactionItem';
import { buildTransactionDetailsPath } from '../../transactions/lib/activityRoutes';
import { getActivityKey } from '../../transactions/lib/activityUtils';

type ContractActivitySource = Pick<
  ContractDetails,
  'accountNumber' | 'relatedTransactionIds' | 'relatedHoldIds'
>;

interface ContractRelatedActivitySectionProps {
  contract: ContractActivitySource;
  title?: string;
  description?: string;
  hideHeader?: boolean;
  hideWhenEmpty?: boolean;
  className?: string;
}

export function ContractRelatedActivitySection({
  contract,
  title = 'Linked transactions',
  description,
  hideHeader = false,
  hideWhenEmpty = false,
  className = '',
}: ContractRelatedActivitySectionProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: accounts } = useAccounts();
  const activityQuery = useActivity({
    accountNumber: contract.accountNumber ?? null,
  });

  const relatedTransactions = useMemo(
    () => contract.relatedTransactionIds ?? [],
    [contract.relatedTransactionIds]
  );
  const relatedHolds = useMemo(
    () => contract.relatedHoldIds ?? [],
    [contract.relatedHoldIds]
  );
  const activityItems = useMemo(
    () => activityQuery.data?.items ?? [],
    [activityQuery.data?.items]
  );

  const { groupedRelatedItems } = useRelatedActivityItems({
    activityItems,
    relatedTransactionIds: relatedTransactions,
    relatedHoldIds: relatedHolds,
  });

  const hasRelatedItems =
    relatedTransactions.length > 0 || relatedHolds.length > 0;
  const account = accounts?.find(
    item => item.accountNumber === contract.accountNumber
  );

  const isActivityLoading =
    activityQuery.isLoading &&
    (relatedTransactions.length > 0 || relatedHolds.length > 0);

  const handleActivitySelect = (activity: ActivityItem) => {
    if (!contract.accountNumber || !account?.accountId) {
      return;
    }

    navigate(
      buildTransactionDetailsPath(account.accountId, activity.activityId),
      {
        state: {
          from: `${location.pathname}${location.search}`,
          selectedActivity: activity,
        },
      }
    );
  };

  const hasVisibleRelatedItems = groupedRelatedItems.length > 0;
  const contentSpacingClass = hideHeader ? '' : 'mt-4';

  if (hideWhenEmpty && !hasRelatedItems) {
    return null;
  }

  if (hideWhenEmpty && !isActivityLoading && !hasVisibleRelatedItems) {
    return null;
  }

  return (
    <section
      className={`rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-4 ${className}`.trim()}
    >
      {!hideHeader && (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {description && (
              <p className="mt-1 text-xs text-slate-500">{description}</p>
            )}
          </div>
        </div>
      )}

      {!hideWhenEmpty && !hasRelatedItems && (
        <div
          className={`${contentSpacingClass} rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500`.trim()}
        >
          No linked activity yet.
        </div>
      )}

      {isActivityLoading && (
        <div
          className={`${contentSpacingClass} flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500`.trim()}
        >
          <Spinner size="sm" color="green" />
          Loading linked activity details...
        </div>
      )}

      {!isActivityLoading &&
        hasRelatedItems &&
        !hasVisibleRelatedItems &&
        !hideWhenEmpty && (
          <div
            className={`${contentSpacingClass} rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500`.trim()}
          >
            No linked activity available for this account.
          </div>
        )}

      {!isActivityLoading && hasVisibleRelatedItems && (
        <div className={contentSpacingClass}>
          <div
            className={`${
              hideHeader ? '' : 'mt-2'
            } rounded-xl border border-slate-200 bg-white/80 divide-y divide-slate-100`.trim()}
          >
            {groupedRelatedItems.map(item => (
              <TransactionItem
                key={getActivityKey(item)}
                item={item}
                onActivitySelect={handleActivitySelect}
                variant="linked"
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
