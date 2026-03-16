import { ReactNode, HTMLAttributes } from 'react';
import { CARD_GRADIENT_CLASS } from '../styleConstants';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'default' | 'gradient' | 'dashed';
}

export function Card({
  children,
  className = '',
  variant = 'default',
  onClick,
  ...rest
}: CardProps) {
  const baseClasses = 'app-surface p-6 transition-all duration-200';

  const variantClasses = {
    default: '',
    gradient: CARD_GRADIENT_CLASS,
    dashed: 'bg-white/70 border-2 border-dashed border-slate-200 shadow-none',
  };

  const interactiveClasses = onClick
    ? 'cursor-pointer hover:shadow-[var(--shadow-lift)] hover:-translate-y-1'
    : '';

  const finalClasses =
    `${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className}`.trim();

  return (
    <div className={finalClasses} onClick={onClick} {...rest}>
      {children}
    </div>
  );
}
