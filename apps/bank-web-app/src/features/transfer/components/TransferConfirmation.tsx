import { Button } from '../../../ui/Button';

interface TransferConfirmationProps {
  onHomeClick: () => void;
}

export function TransferConfirmation({
  onHomeClick,
}: TransferConfirmationProps) {
  return (
    <div
      data-testid="confirmation-container"
      className="text-center space-y-6 p-6"
    >
      <div className="space-y-6">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold text-gray-900">Transfer</h1>
          <h2 className="text-3xl font-bold text-gray-900">completed!</h2>
        </div>

        <div
          data-testid="success-illustration"
          className="flex justify-center py-4"
        >
          <div className="relative">
            <svg
              width="80"
              height="80"
              viewBox="0 0 120 120"
              className="text-green-500"
            >
              <path
                d="M60 10 C 85 10, 110 35, 110 60 C 110 85, 85 110, 60 110 C 35 110, 10 85, 10 60 C 10 35, 35 10, 60 10 Z"
                fill="currentColor"
                fillOpacity="0.1"
              />
              <g transform="translate(30, 30)">
                <path
                  d="M30 0 C 40 0, 50 5, 55 15 L 55 25 C 55 35, 50 40, 40 45 L 35 47 C 25 50, 15 45, 10 35 L 5 25 C 0 15, 5 5, 15 0 Z"
                  fill="#F3F4F6"
                  stroke="#6B7280"
                  strokeWidth="2"
                />
                <circle cx="20" cy="10" r="3" fill="#10B981" />
                <circle cx="35" cy="12" r="3" fill="#10B981" />
                <circle cx="45" cy="15" r="3" fill="#10B981" />
                <path
                  d="M15 25 C 20 30, 30 35, 40 30"
                  stroke="#F59E0B"
                  strokeWidth="3"
                  fill="none"
                />
              </g>
            </svg>
          </div>
        </div>

        <div className="pt-2">
          <Button
            onClick={onHomeClick}
            className="bg-gradient-to-r from-green-500 to-yellow-400 hover:from-green-600 hover:to-yellow-500 text-white font-semibold py-2 px-8 rounded-full text-base shadow-lg hover:shadow-xl transition-all duration-200 min-w-[150px]"
          >
            Home
          </Button>
        </div>
      </div>
    </div>
  );
}
