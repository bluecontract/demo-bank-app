import { Routes, Route } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';
import { DashboardPage } from '../pages/DashboardPage';
import { SignUpPage } from '../features/auth/pages/SignUpPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}

export default App;
