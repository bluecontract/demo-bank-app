import { useNavigate } from 'react-router-dom';
import { HealthStatus } from '../../ui/HealthStatus';

export function HomePage() {
  const navigate = useNavigate();

  const handleSignUpClick = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const isE2E = urlParams.get('e2e') === 'true';
    const signupUrl = isE2E ? '/signup?e2e=true' : '/signup';
    navigate(signupUrl);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Demo Blue Bank
          </h1>
          <p className="text-lg text-gray-600">
            Secure Banking Demo Application
          </p>
        </header>

        <div className="max-w-2xl mx-auto">
          <HealthStatus />

          <div className="mt-8 p-6 bg-white rounded-lg shadow-sm border">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Welcome to Demo Blue Bank
            </h2>
            <p className="text-gray-600 mb-6">
              Experience modern banking with our secure demo application. Create
              an account to explore features like account management,
              transactions, and more.
            </p>

            <div className="flex gap-4 mb-6">
              <button
                onClick={handleSignUpClick}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Sign Up
              </button>
              <button
                disabled
                className="bg-gray-100 text-gray-400 px-6 py-3 rounded-lg font-medium cursor-not-allowed"
              >
                Sign In
                <span className="block text-xs mt-1">Coming Soon</span>
              </button>
            </div>

            <div className="text-sm text-gray-500">
              <p>🔐 Secure authentication system</p>
              <p>💳 Account management features</p>
              <p>💰 Transaction history</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
