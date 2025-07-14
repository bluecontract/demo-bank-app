interface DashboardHeaderProps {
  userName: string;
  'data-testid'?: string;
}

export function DashboardHeader({
  userName,
  'data-testid': testId,
}: DashboardHeaderProps) {
  return (
    <header
      className="flex justify-between items-center p-6 bg-white border-b border-gray-200"
      data-testid={testId}
    >
      {/* Left side - App name and welcome message */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Demo Bank</h1>
        <p className="text-gray-600">Welcome back</p>
      </div>

      {/* Right side - User profile */}
      <div className="flex items-center space-x-3">
        <div className="text-right">
          <p className="text-sm font-medium text-gray-900">{userName}</p>
        </div>
      </div>
    </header>
  );
}
