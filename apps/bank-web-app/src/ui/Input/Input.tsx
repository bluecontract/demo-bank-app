import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  error?: string;
  className?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, className = '', ...props }, ref) => {
    const baseClasses =
      'w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500';

    const errorClasses = error
      ? 'border-red-300 text-red-900 placeholder-red-300 focus:ring-red-500 focus:border-red-500'
      : 'border-gray-300 text-gray-900 placeholder-gray-400 focus:border-green-500';

    const disabledClasses = props.disabled
      ? 'bg-gray-50 cursor-not-allowed'
      : 'bg-white';

    const finalClasses =
      `${baseClasses} ${errorClasses} ${disabledClasses} ${className}`.trim();

    return (
      <div>
        <input ref={ref} className={finalClasses} {...props} />
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
