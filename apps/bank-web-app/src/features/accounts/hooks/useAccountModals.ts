import { useMemo, useState, useCallback } from 'react';
import type { Account } from '../../../types/api';

type AccountModalState = {
  isOpen: boolean;
  sourceAccount: Account | null;
};

export const useAccountModals = (accounts?: Account[] | null) => {
  const depositAccounts = useMemo(
    () =>
      accounts?.filter(account => account.accountType !== 'CREDIT_LINE') ?? [],
    [accounts]
  );
  const creditLineAccounts = useMemo(
    () =>
      accounts?.filter(account => account.accountType === 'CREDIT_LINE') ?? [],
    [accounts]
  );

  const [accountCreationModal, setAccountCreationModal] = useState({
    isOpen: false,
  });
  const [fundModal, setFundModal] = useState<AccountModalState>({
    isOpen: false,
    sourceAccount: null,
  });
  const [creditLimitModal, setCreditLimitModal] = useState<AccountModalState>({
    isOpen: false,
    sourceAccount: null,
  });

  const openAccountCreationModal = useCallback(() => {
    setAccountCreationModal({ isOpen: true });
  }, []);

  const closeAccountCreationModal = useCallback(() => {
    setAccountCreationModal({ isOpen: false });
  }, []);

  const openFundModal = useCallback(
    (accountId: string) => {
      const account = depositAccounts.find(acc => acc.accountId === accountId);
      if (account) {
        setFundModal({
          isOpen: true,
          sourceAccount: account,
        });
      }
    },
    [depositAccounts]
  );

  const closeFundModal = useCallback(() => {
    setFundModal({
      isOpen: false,
      sourceAccount: null,
    });
  }, []);

  const openCreditLimitModal = useCallback(
    (accountId: string) => {
      const account = creditLineAccounts.find(
        acc => acc.accountId === accountId
      );
      if (account) {
        setCreditLimitModal({
          isOpen: true,
          sourceAccount: account,
        });
      }
    },
    [creditLineAccounts]
  );

  const closeCreditLimitModal = useCallback(() => {
    setCreditLimitModal({
      isOpen: false,
      sourceAccount: null,
    });
  }, []);

  return {
    depositAccounts,
    creditLineAccounts,
    accountCreationModal,
    fundModal,
    creditLimitModal,
    openAccountCreationModal,
    closeAccountCreationModal,
    openFundModal,
    closeFundModal,
    openCreditLimitModal,
    closeCreditLimitModal,
  };
};
