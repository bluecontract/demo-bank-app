import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useRef,
} from 'react';
import { useAuth } from './AuthProvider';
import { Account } from '../../types/api';

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
  const prevUserIdRef = useRef<string | null>(null);
  const isFirstRunRef = useRef(true);

  // Clear selected account when user changes (sign out/sign in)
  useEffect(() => {
    const currentUserId = user?.userId ?? null;

    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      prevUserIdRef.current = currentUserId;
      return;
    }

    if (prevUserIdRef.current !== currentUserId) {
      setSelectedAccount(null);
    }

    prevUserIdRef.current = currentUserId;
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
