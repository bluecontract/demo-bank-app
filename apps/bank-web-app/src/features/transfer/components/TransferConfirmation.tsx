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
              viewBox="0 0 80 80"
              className="text-green-500"
            >
              {/* Outer circle with subtle background */}
              <circle
                cx="40"
                cy="40"
                r="38"
                fill="currentColor"
                fillOpacity="0.1"
                stroke="currentColor"
                strokeWidth="2"
                strokeOpacity="0.2"
              />

              {/* Inner success circle */}
              <circle
                cx="40"
                cy="40"
                r="28"
                fill="currentColor"
                fillOpacity="0.15"
              />

              {/* Checkmark */}
              <path
                d="M28 38 L35 45 L52 28"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
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
