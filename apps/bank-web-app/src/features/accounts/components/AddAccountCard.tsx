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
    <Card variant="dashed" className="p-4 min-h-[208px]" data-testid={testId}>
      <button
        className={`w-full h-full flex flex-col gap-4 disabled:opacity-50 ${
          onClick && !isLoading ? 'cursor-pointer hover:bg-white/60' : ''
        }`}
        onClick={isLoading ? undefined : onClick}
        disabled={isLoading}
        aria-label="Add new account"
      >
        <span className="text-sm font-semibold text-slate-700">
          {isLoading ? 'Creating...' : 'Add new account'}
        </span>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#2bbe9c] to-[#f4b740] flex items-center justify-center shadow-sm">
            <span className="text-slate-900 text-2xl font-semibold">+</span>
          </div>
        </div>
      </button>
    </Card>
  );
}
