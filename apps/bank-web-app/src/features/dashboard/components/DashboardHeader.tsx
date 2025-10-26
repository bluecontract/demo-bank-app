import { Avatar } from '../../../ui/Avatar';
import { Dropdown, DropdownItem } from '../../../ui/Dropdown';
import { useAuth } from '../../../app/providers/AuthProvider';

interface DashboardHeaderProps {
  userEmail: string;
  'data-testid'?: string;
}

export function DashboardHeader({
  userEmail,
  'data-testid': testId,
}: DashboardHeaderProps) {
  const { signOut } = useAuth();

  const handleSignOut = () => {
    signOut();
  };

  return (
    <header
      className="flex justify-between items-center p-6"
      data-testid={testId}
    >
      {/* Left side - App name and welcome message */}
      <div>
        <h1 className="text-4xl font-bold text-white">Demo Bank</h1>
        <p className="text-lg text-white/80">Welcome back</p>
      </div>

      {/* Right side - User profile */}
      <div className="flex items-center space-x-3">
        <div className="text-right">
          <p className="text-sm font-medium text-white">{userEmail}</p>
        </div>
        <Dropdown trigger={<Avatar name={userEmail} size="xl" />} align="right">
          <DropdownItem
            onClick={handleSignOut}
            icon={
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            }
          >
            Sign Out
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
