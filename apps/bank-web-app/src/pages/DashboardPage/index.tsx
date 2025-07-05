import { useAuth } from '../../app/providers/AuthProvider';

export function DashboardPage() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-4xl font-bold text-gray-900">
              Welcome to Blue Bank
            </h1>
            <button
              onClick={signOut}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
            >
              Sign Out
            </button>
          </div>
          {user && (
            <p className="text-lg text-gray-600">Welcome back, {user.name}!</p>
          )}
          <p className="text-sm text-gray-500">Your secure banking dashboard</p>
        </header>
      </div>
    </div>
  );
}
