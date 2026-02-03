import { useState, useRef, useEffect } from 'react';
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
  selectOnCardClick?: boolean;
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
  selectOnCardClick = false,
  cardSize = 'default',
  'data-testid': testId,
}: HorizontalAccountsListProps) {
  const { selectedAccount, setSelectedAccount } = useSelectedAccount();
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleAccountSelection = (accountId: string) => {
    const account = accounts.find(acc => acc.accountId === accountId);
    if (account) {
      setSelectedAccount(account);
    }
  };

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -256, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 256, behavior: 'smooth' });
    }
  };

  const updateArrows = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } =
        scrollContainerRef.current;
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(scrollLeft + clientWidth < scrollWidth);
    }
  };

  useEffect(() => {
    updateArrows();
    const handleResize = () => updateArrows();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [accounts]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.addEventListener('scroll', updateArrows);
      return () => container.removeEventListener('scroll', updateArrows);
    }
    return undefined;
  }, []);

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
          className="absolute left-4 top-1/2 transform -translate-y-1/2 z-10 bg-white/90 border border-slate-200 shadow-sm rounded-full p-2 hover:shadow-md transition-all"
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
          className="absolute right-4 top-1/2 transform -translate-y-1/2 z-10 bg-white/90 border border-slate-200 shadow-sm rounded-full p-2 hover:shadow-md transition-all"
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
        className="flex gap-4 overflow-x-auto scrollbar-hide px-4 pb-4 pt-3"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        data-testid="accounts-scroll-container"
      >
        {/* Account Cards */}
        {accounts.map(account => (
          <div key={account.accountNumber} className="flex-shrink-0 w-60">
            <AccountCard
              account={account}
              isSelected={
                selectedAccount?.accountNumber === account.accountNumber
              }
              showActions={showActions}
              size={cardSize}
              onSelect={selectOnCardClick ? handleAccountSelection : undefined}
              onDetailsClick={
                selectOnCardClick ? undefined : handleAccountSelection
              }
              onTransferClick={showActions ? onTransfer : undefined}
              onFundClick={showActions ? onFund : undefined}
              onEditCreditLimitClick={
                showActions ? onEditCreditLimit : undefined
              }
            />
          </div>
        ))}

        {/* Add Account Card */}
        <div className="flex-shrink-0 w-60">
          <AddAccountCard
            onClick={onCreateAccount}
            isLoading={isCreatingAccount}
            size={cardSize}
          />
        </div>
      </div>
    </div>
  );
}
