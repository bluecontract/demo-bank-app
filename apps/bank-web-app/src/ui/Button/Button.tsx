import { ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'gradient';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  'data-testid'?: string;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  className = '',
  onClick,
  'data-testid': testId,
}: ButtonProps) {
  const baseClasses =
    'font-semibold rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';

  const variantClasses = {
    primary:
      'bg-[var(--color-primary)] text-white shadow-sm hover:bg-[var(--color-primary-600)] focus:ring-[var(--color-primary)]',
    secondary:
      'bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900 focus:ring-[var(--color-primary)]',
    outline:
      'border border-[var(--color-primary)] text-[var(--color-primary)] bg-transparent hover:bg-[rgba(43,190,156,0.08)] focus:ring-[var(--color-primary)]',
    gradient:
      'bg-gradient-to-r from-[#2bbe9c] to-[#f4b740] text-slate-900 hover:from-[#2aae91] hover:to-[#e6aa3b] focus:ring-[var(--color-primary)]',
  };

  const sizeClasses = {
    sm: 'px-3 py-1 text-sm',
    md: 'px-6 py-2 text-base',
    lg: 'px-8 py-3 text-lg',
  };

  const disabledClasses = disabled
    ? 'opacity-50 cursor-not-allowed pointer-events-none'
    : '';

  const widthClasses = fullWidth ? 'w-full' : '';

  const finalClasses =
    `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${disabledClasses} ${widthClasses} ${className}`.trim();

  return (
    <button
      className={finalClasses}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
