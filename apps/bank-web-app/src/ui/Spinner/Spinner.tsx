interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: 'white' | 'green' | 'blue' | 'gray';
  className?: string;
  'data-testid'?: string;
}

export function Spinner({
  size = 'md',
  color = 'white',
  className = '',
  'data-testid': testId,
}: SpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12',
  };

  const colorClasses = {
    white: 'border-white/30 border-t-white',
    green: 'border-green-200 border-t-green-600',
    blue: 'border-blue-200 border-t-blue-600',
    gray: 'border-gray-200 border-t-gray-600',
  };

  return (
    <div
      className={`animate-spin rounded-full border-2 ${sizeClasses[size]} ${colorClasses[color]} ${className}`}
      data-testid={testId}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}

interface SpinnerWithTextProps {
  text?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: 'white' | 'green' | 'blue' | 'gray';
  textClassName?: string;
  className?: string;
  'data-testid'?: string;
}

export function SpinnerWithText({
  text = 'Loading...',
  size = 'lg',
  color = 'white',
  textClassName = 'text-white text-xl',
  className = '',
  'data-testid': testId,
}: SpinnerWithTextProps) {
  return (
    <div
      className={`flex flex-col items-center space-y-4 ${className}`}
      data-testid={testId}
    >
      <Spinner size={size} color={color} />
      <div className={textClassName}>{text}</div>
    </div>
  );
}
