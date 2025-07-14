import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
} from 'react';
import { useAuth } from './AuthProvider';

type Account = {
  accountId: string;
  accountNumber: string;
  currency: 'USD';
  createdAt: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
};

interface SelectedAccountContextType {
  selectedAccount: Account | null;
  setSelectedAccount: (account: Account | null) => void;
}

const SelectedAccountContext = createContext<
  SelectedAccountContextType | undefined
>(undefined);

export const useSelectedAccount = () => {
  const context = useContext(SelectedAccountContext);
  if (!context) {
    throw new Error(
      'useSelectedAccount must be used within SelectedAccountProvider'
    );
  }
  return context;
};

interface SelectedAccountProviderProps {
  children: ReactNode;
}

export const SelectedAccountProvider = ({
  children,
}: SelectedAccountProviderProps) => {
  const { user } = useAuth();
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  // Clear selected account when user changes (sign out/sign in)
  useEffect(() => {
    setSelectedAccount(null);
  }, [user?.userId]);

  const value: SelectedAccountContextType = {
    selectedAccount,
    setSelectedAccount,
  };

  return (
    <SelectedAccountContext.Provider value={value}>
      {children}
    </SelectedAccountContext.Provider>
  );
};
