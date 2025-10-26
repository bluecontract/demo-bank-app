import { useState } from 'react';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  'data-testid'?: string;
}

export function Avatar({
  name,
  src,
  size = 'md',
  className = '',
  'data-testid': testId,
}: AvatarProps) {
  const [imageError, setImageError] = useState(false);

  const getInitials = (fullName: string): string => {
    const value = fullName.trim();
    if (!value) return '?';

    const toInitial = (token?: string) => token?.[0]?.toUpperCase() ?? '';

    if (value.includes('@')) {
      const [localPart, domainPart = ''] = value.split('@');
      const localTokens = localPart.split(/[-_.\s]+/).filter(Boolean);
      const domainTokens = domainPart.split(/[-_.\s]+/).filter(Boolean);

      const firstInitial = toInitial(localTokens[0] ?? domainTokens[0]);
      const secondInitial = toInitial(
        localTokens.length > 1
          ? localTokens[localTokens.length - 1]
          : domainTokens[0]
      );

      const initials = `${firstInitial}${secondInitial}`;
      return initials || '?';
    }

    const names = value.split(/\s+/);
    if (names.length === 1) {
      return toInitial(names[0]) || '?';
    }

    const firstInitial = toInitial(names[0]);
    const secondInitial = toInitial(names[1]);

    const initials = `${firstInitial}${secondInitial}`;
    return initials || '?';
  };

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-lg',
  };

  const backgroundColorClass = name.trim() ? 'bg-green-500' : 'bg-gray-400';

  const baseClasses = `${sizeClasses[size]} ${backgroundColorClass} rounded-full flex items-center justify-center text-white font-semibold`;
  const finalClasses = `${baseClasses} ${className}`.trim();

  const handleImageError = () => {
    setImageError(true);
  };

  // Show image if src is provided and hasn't failed to load
  const showImage = src && !imageError;

  if (showImage) {
    return (
      <div className={finalClasses} data-testid={testId}>
        <img
          src={src}
          alt={name}
          className="w-full h-full rounded-full object-cover"
          onError={handleImageError}
        />
      </div>
    );
  }

  // Show initials fallback
  return (
    <div className={finalClasses} data-testid={testId}>
      {getInitials(name)}
    </div>
  );
}
