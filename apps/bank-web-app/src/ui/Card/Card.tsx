import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'gradient' | 'dashed';
  onClick?: () => void;
  'data-testid'?: string;
}

export function Card({
  children,
  className = '',
  variant = 'default',
  onClick,
  'data-testid': testId,
}: CardProps) {
  const baseClasses = 'p-6 rounded-lg transition-all duration-200';

  const variantClasses = {
    default: 'bg-white shadow-md',
    gradient: 'bg-gradient-to-br from-green-400 to-yellow-400 shadow-lg',
    dashed: 'bg-white border-2 border-dashed border-gray-300 shadow-sm',
  };

  const interactiveClasses = onClick
    ? 'cursor-pointer hover:shadow-lg transform hover:-translate-y-1'
    : '';

  const finalClasses =
    `${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className}`.trim();

  return (
    <div className={finalClasses} onClick={onClick} data-testid={testId}>
      {children}
    </div>
  );
}
