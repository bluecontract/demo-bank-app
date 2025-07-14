import { Card } from '../../../ui/Card';

interface AddAccountCardProps {
  onClick?: () => void;
  isLoading?: boolean;
  'data-testid'?: string;
}

export function AddAccountCard({
  onClick,
  isLoading = false,
  'data-testid': testId,
}: AddAccountCardProps) {
  return (
    <Card variant="dashed" data-testid={testId}>
      <button
        className={`w-full h-full flex flex-col items-center justify-center space-y-4 p-6 min-h-[160px] disabled:opacity-50 ${
          onClick && !isLoading ? 'cursor-pointer hover:bg-gray-50' : ''
        }`}
        onClick={isLoading ? undefined : onClick}
        disabled={isLoading}
        aria-label="Add new account"
      >
        {/* Plus Icon */}
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
          <span className="text-green-600 text-2xl font-bold">+</span>
        </div>

        {/* Text */}
        <span className="text-gray-700 font-medium">
          {isLoading ? 'Creating...' : 'Add new account'}
        </span>
      </button>
    </Card>
  );
}
