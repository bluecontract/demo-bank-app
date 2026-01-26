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
        className={`w-full h-full flex flex-col items-center justify-center space-y-4 min-h-[168px] disabled:opacity-50 ${
          onClick && !isLoading ? 'cursor-pointer hover:bg-white/60' : ''
        }`}
        onClick={isLoading ? undefined : onClick}
        disabled={isLoading}
        aria-label="Add new account"
      >
        {/* Plus Icon */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#2bbe9c] to-[#f4b740] flex items-center justify-center shadow-sm">
          <span className="text-slate-900 text-3xl font-semibold">+</span>
        </div>

        {/* Text */}
        <span className="text-slate-700 font-medium">
          {isLoading ? 'Creating...' : 'Add new account'}
        </span>
      </button>
    </Card>
  );
}
