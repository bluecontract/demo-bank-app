import { useRef, useState } from 'react';
import { Avatar } from '../../../ui/Avatar';
import { Dropdown, DropdownItem } from '../../../ui/Dropdown';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useApiClient } from '../../../app/providers/ApiProvider';

interface DashboardHeaderProps {
  userEmail: string;
  title?: string;
  description?: string | null;
  'data-testid'?: string;
}

export function DashboardHeader({
  userEmail,
  title,
  description,
  'data-testid': testId,
}: DashboardHeaderProps) {
  const { user, signOut, signIn } = useAuth();
  const apiClient = useApiClient();
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_AVATAR_BYTES = 150 * 1024;
  const displayName = user?.merchantName?.trim() || userEmail;
  const avatarSrc = user?.avatarDataUrl;
  const merchantId = user?.merchantId?.trim();
  const resolvedDescription =
    description === undefined
      ? 'Your personal overview for accounts, cards, and activity.'
      : description;
  const shouldRenderDescription = resolvedDescription !== null;

  const handleSignOut = () => {
    signOut();
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setAvatarError('Please select an image file.');
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('Avatar must be 150KB or smaller.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== 'string') {
        setAvatarError('Unable to read the image file.');
        return;
      }

      setIsUpdatingAvatar(true);
      setAvatarError(null);

      try {
        const response = await apiClient.updateUserProfile({
          body: {
            avatarDataUrl: reader.result,
          },
        });

        if (response.status !== 200) {
          setAvatarError('Unable to update avatar.');
          return;
        }

        signIn(response.body);
      } catch {
        setAvatarError('Unable to update avatar.');
      } finally {
        setIsUpdatingAvatar(false);
      }
    };
    reader.onerror = () => {
      setAvatarError('Unable to read the image file.');
    };
    reader.readAsDataURL(file);
  };

  return (
    <header
      className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
      data-testid={testId}
    >
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">
          {title ?? 'Welcome back'}
        </h1>
        {shouldRenderDescription && (
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            {resolvedDescription}
          </p>
        )}
      </div>

      <div className="hidden lg:flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700">
          <span className="font-medium">{userEmail}</span>
        </div>

        <Dropdown
          trigger={<Avatar name={displayName} src={avatarSrc} size="lg" />}
          align="right"
        >
          <DropdownItem onClick={handleAvatarClick}>
            {isUpdatingAvatar ? 'Updating logo…' : 'Change logo'}
          </DropdownItem>
          {merchantId && (
            <div className="px-4 py-2" role="none">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Merchant ID
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-700 break-all">
                {merchantId}
              </p>
            </div>
          )}
          <DropdownItem
            onClick={handleSignOut}
            icon={
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            }
          >
            Sign Out
          </DropdownItem>
          {avatarError && (
            <div className="px-4 py-2 text-xs text-rose-600">{avatarError}</div>
          )}
        </Dropdown>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={event => {
            const file = event.target.files?.[0] ?? null;
            handleAvatarFile(file);
            if (event.target.value) {
              event.target.value = '';
            }
          }}
        />
      </div>
    </header>
  );
}
