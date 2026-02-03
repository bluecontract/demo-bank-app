import { Routes, Route } from 'react-router-dom';
import { ApiProvider } from './providers/ApiProvider';
import { AuthProvider } from './providers/AuthProvider';
import { ProtectedRoute } from './providers/ProtectedRoute';
import { HomePage } from '../pages/HomePage';
import { DashboardPage } from '../pages/DashboardPage';
import { CardsPage } from '../pages/CardsPage';
import { TransactionsPage } from '../pages/TransactionsPage';
import { NewTransferPage } from '../pages/NewTransferPage';
import { ContractsPage } from '../pages/ContractsPage';
import { SignUpPage } from '../features/auth/pages/SignUpPage';
import { SignInPage } from '../features/auth/pages/SignInPage';

export function App() {
  return (
    <ApiProvider>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cards"
            element={
              <ProtectedRoute>
                <CardsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transactions"
            element={
              <ProtectedRoute>
                <TransactionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transfer/new"
            element={
              <ProtectedRoute>
                <NewTransferPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/contracts"
            element={
              <ProtectedRoute>
                <ContractsPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<HomePage />} />
        </Routes>
      </AuthProvider>
    </ApiProvider>
  );
}

export default App;
