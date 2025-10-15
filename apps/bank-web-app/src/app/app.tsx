import { Routes, Route } from 'react-router-dom';
import { ApiProvider } from './providers/ApiProvider';
import { AuthProvider } from './providers/AuthProvider';
import { ProtectedRoute } from './providers/ProtectedRoute';
import { HomePage } from '../pages/HomePage';
import { DashboardPage } from '../pages/DashboardPage';
import { NewTransferPage } from '../pages/NewTransferPage';
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
            path="/transfer/new"
            element={
              <ProtectedRoute>
                <NewTransferPage />
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
