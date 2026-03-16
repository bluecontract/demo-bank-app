import { useState, useRef, useEffect, useCallback } from 'react';
import { AccountCard } from './AccountCard';
import { AddAccountCard } from './AddAccountCard';
import { useSelectedAccount } from '../../../app/providers/SelectedAccountProvider';
import type { Account } from '../../../types/api';

interface HorizontalAccountsListProps {
  accounts: Account[];
  onCreateAccount: () => void;
  onTransfer: (accountId: string) => void;
  onFund?: (accountId: string) => void;
  onEditCreditLimit?: (accountId: string) => void;
  isCreatingAccount?: boolean;
  showActions?: boolean;
  showAddAccountCard?: boolean;
  cardSize?: 'default' | 'compact';
  'data-testid'?: string;
}

export function HorizontalAccountsList({
  accounts,
  onCreateAccount,
  onTransfer,
  onFund,
  onEditCreditLimit,
  isCreatingAccount = false,
  showActions = true,
  showAddAccountCard = true,
  cardSize = 'default',
  'data-testid': testId,
}: HorizontalAccountsListProps) {
  const { selectedAccount, setSelectedAccount } = useSelectedAccount();
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const accountCardWidthClass = 'w-60';
  const accountCardWidthPx = 240;
  const accountCardGapPx = 16;
  const scrollStepPx = accountCardWidthPx + accountCardGapPx;

  const handleAccountSelection = (accountId: string) => {
    const account = accounts.find(acc => acc.accountId === accountId);
    if (account) {
      setSelectedAccount(account);
    }
  };

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({
        left: -scrollStepPx,
        behavior: 'smooth',
      });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({
        left: scrollStepPx,
        behavior: 'smooth',
      });
    }
  };

  const updateArrows = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } =
        scrollContainerRef.current;
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(scrollLeft + clientWidth < scrollWidth);
    }
  }, []);

  useEffect(() => {
    updateArrows();
  }, [accounts.length, updateArrows]);

  useEffect(() => {
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [updateArrows]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return undefined;
    }

    container.addEventListener('scroll', updateArrows);
    return () => container.removeEventListener('scroll', updateArrows);
  }, [updateArrows]);

  // Auto-select first account when accounts are loaded
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      setSelectedAccount(accounts[0]);
    }
  }, [accounts, selectedAccount, setSelectedAccount]);

  return (
    <div className="relative" data-testid={testId}>
      {/* Left Arrow */}
      {showLeftArrow && (
        <button
          onClick={scrollLeft}
          className="hidden sm:inline-flex absolute left-4 top-1/2 transform -translate-y-1/2 z-10 bg-white/90 border border-slate-200 shadow-sm rounded-full p-2 hover:shadow-md transition-all"
          data-testid="scroll-left-btn"
        >
          <svg
            className="w-5 h-5 text-slate-700"
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
      )}

      {/* Right Arrow */}
      {showRightArrow && (
        <button
          onClick={scrollRight}
          className="hidden sm:inline-flex absolute right-4 top-1/2 transform -translate-y-1/2 z-10 bg-white/90 border border-slate-200 shadow-sm rounded-full p-2 hover:shadow-md transition-all"
          data-testid="scroll-right-btn"
        >
          <svg
            className="w-5 h-5 text-slate-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      )}

      {/* Scrollable Container */}
      <div
        ref={scrollContainerRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide px-4 pb-4 pt-4"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        data-testid="accounts-scroll-container"
      >
        {/* Account Cards */}
        {accounts.map(account => (
          <div
            key={account.accountNumber}
            className={`flex-shrink-0 ${accountCardWidthClass}`}
          >
            <AccountCard
              account={account}
              isSelected={
                selectedAccount?.accountNumber === account.accountNumber
              }
              showActions={showActions}
              size={cardSize}
              onSelect={handleAccountSelection}
              onTransferClick={showActions ? onTransfer : undefined}
              onFundClick={showActions ? onFund : undefined}
              onEditCreditLimitClick={
                showActions ? onEditCreditLimit : undefined
              }
            />
          </div>
        ))}

        {showAddAccountCard && (
          <div className={`flex-shrink-0 ${accountCardWidthClass}`}>
            <AddAccountCard
              onClick={onCreateAccount}
              isLoading={isCreatingAccount}
              size={cardSize}
            />
          </div>
        )}
      </div>
    </div>
  );
}
