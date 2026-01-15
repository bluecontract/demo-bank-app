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
  const baseClasses = 'app-surface p-6 transition-all duration-200';

  const variantClasses = {
    default: '',
    gradient:
      'bg-gradient-to-br from-[#2bbe9c] via-[#a7f0d4] to-[#f4b740] text-slate-900 border-transparent',
    dashed: 'bg-white/70 border-2 border-dashed border-slate-200 shadow-none',
  };

  const interactiveClasses = onClick
    ? 'cursor-pointer hover:shadow-[var(--shadow-lift)] hover:-translate-y-1'
    : '';

  const finalClasses =
    `${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className}`.trim();

  return (
    <div className={finalClasses} onClick={onClick} data-testid={testId}>
      {children}
    </div>
  );
}
