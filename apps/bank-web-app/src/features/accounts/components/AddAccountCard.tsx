import { Card } from '../../../ui/Card';
import { BRAND_GRADIENT_CLASS } from '../../../ui/styleConstants';
import { ACCOUNT_CARD_HEIGHT_CLASSES } from './accountCardStyles';

interface AddAccountCardProps {
  onClick?: () => void;
  isLoading?: boolean;
  size?: 'default' | 'compact';
  'data-testid'?: string;
}

export function AddAccountCard({
  onClick,
  isLoading = false,
  size = 'default',
  'data-testid': testId,
}: AddAccountCardProps) {
  const heightClass = ACCOUNT_CARD_HEIGHT_CLASSES[size];

  return (
    <Card
      variant="dashed"
      className={`p-4 ${heightClass} rounded-lg sm:rounded-2xl shadow-none sm:shadow-[var(--shadow-soft)]`}
      data-testid={testId}
    >
      <button
        className={`w-full h-full flex flex-col gap-4 disabled:opacity-50 ${
          onClick && !isLoading ? 'cursor-pointer hover:bg-white/60' : ''
        }`}
        onClick={isLoading ? undefined : onClick}
        disabled={isLoading}
        aria-label="Add new account"
        data-testid="add-account-button"
      >
        <span className="text-sm font-semibold text-slate-700">
          {isLoading ? 'Creating...' : 'Add new account'}
        </span>

        <div className="flex-1 flex items-center justify-center">
          <div
            className={`w-12 h-12 rounded-full ${BRAND_GRADIENT_CLASS} flex items-center justify-center shadow-sm`}
          >
            <span className="text-slate-900 text-2xl font-semibold">+</span>
          </div>
        </div>
      </button>
    </Card>
  );
}
