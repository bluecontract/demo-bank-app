import React, { useRef, useState } from 'react';
import { Avatar } from '../../../ui/Avatar';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../app/providers/ApiProvider';
import { useAuth } from '../../../app/providers/AuthProvider';
import { User } from '../../../types/api';

interface SignUpFormProps {
  onSuccess?: (user: User) => void;
}

export const MARKETING_CONSENT_COPY =
  'I agree to the collection of my email address by Blue Language Labs Inc. and its use for future marketing communications.';

export const SignUpForm: React.FC<SignUpFormProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [isMerchant, setIsMerchant] = useState(false);
  const [merchantId, setMerchantId] = useState('');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<{
    email?: string;
    merchantId?: string;
    merchantName?: string;
  }>({});
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const MAX_AVATAR_BYTES = 150 * 1024;

  const signUpMutation = useMutation({
    mutationFn: async (userData: {
      email: string;
      marketingEmailsOptIn: boolean;
      merchantId?: string;
      merchantName?: string;
      avatarDataUrl?: string;
    }) => {
      const isE2ETest =
        typeof window !== 'undefined' &&
        (window.location.search.includes('e2e=true') ||
          // @ts-expect-error - Playwright injects this global
          window.playwright !== undefined);

      const response = await apiClient.signUp({
        body: userData,
        query: isE2ETest ? { dev: 'true' } : undefined,
      });

      if (response.status === 201) {
        return response.body;
      } else {
        if (response.status === 409) {
          throw new Error(
            'A user with this email already exists. Please use a different email.'
          );
        }

        const errorBody = response.body as
          | { error?: string; message?: string }
          | undefined;
        throw new Error(errorBody?.message || 'Sign up failed');
      }
    },
    onSuccess: data => {
      setErrors({});
      setAvatarError(null);
      // Update auth state via AuthProvider
      signIn(data);
      onSuccess?.(data);
      // Navigate to dashboard after successful sign up
      navigate('/dashboard');
    },
    onError: (error: unknown) => {
      if (
        error instanceof Error &&
        error.message?.includes('different email')
      ) {
        setErrors({
          email:
            'A user with this email already exists. Please use a different email.',
        });
      } else {
        setErrors({ email: 'Sign up failed. Please try again.' });
      }
    },
  });

  const validateEmail = (emailValue: string): string | undefined => {
    const trimmed = emailValue.trim();
    if (!trimmed) {
      return 'Email is required';
    }
    if (trimmed.length > 254) {
      return 'Email must be 254 characters or less';
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(trimmed)) {
      return 'Enter a valid email address';
    }
    return undefined;
  };

  const validateMerchantId = (merchantIdValue: string): string | undefined => {
    const trimmed = merchantIdValue.trim();
    if (!trimmed) {
      return 'Merchant ID is required when signing up as a merchant';
    }
    return undefined;
  };

  const validateMerchantName = (
    merchantNameValue: string
  ): string | undefined => {
    const trimmed = merchantNameValue.trim();
    if (!trimmed) {
      return 'Merchant name is required';
    }
    if (trimmed.length > 140) {
      return 'Merchant name must be 140 characters or less';
    }
    return undefined;
  };

  const handleAvatarChange = (file: File | null) => {
    if (!file) {
      setAvatarDataUrl(null);
      setAvatarError(null);
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
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarDataUrl(reader.result);
        setAvatarError(null);
      } else {
        setAvatarError('Unable to read the image file.');
      }
    };
    reader.onerror = () => {
      setAvatarError('Unable to read the image file.');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const emailError = validateEmail(email);
    const merchantNameError = isMerchant
      ? validateMerchantName(merchantName)
      : undefined;
    const merchantIdError = isMerchant
      ? validateMerchantId(merchantId)
      : undefined;
    if (emailError || merchantNameError || merchantIdError || avatarError) {
      setErrors({
        email: emailError,
        merchantName: merchantNameError,
        merchantId: merchantIdError,
      });
      return;
    }

    setErrors({});
    signUpMutation.mutate({
      email: email.trim().toLowerCase(),
      marketingEmailsOptIn: marketingOptIn,
      ...(isMerchant
        ? {
            merchantId: merchantId.trim(),
            merchantName: merchantName.trim(),
          }
        : {}),
      ...(isMerchant && avatarDataUrl ? { avatarDataUrl } : {}),
    });
  };

  const clearErrors = () => {
    setErrors({});
  };

  return (
    <div className="bg-white p-8 rounded-lg shadow-md max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
        Create Account
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              clearErrors();
            }}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
              errors.email ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Enter your email address"
            disabled={signUpMutation.isPending}
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-600" role="alert">
              {errors.email}
            </p>
          )}
        </div>

        <label className="flex items-start gap-3 text-sm text-gray-600">
          <input
            type="checkbox"
            name="isMerchant"
            checked={isMerchant}
            onChange={event => {
              const checked = event.target.checked;
              setIsMerchant(checked);
              if (!checked) {
                setMerchantName('');
                setMerchantId('');
                setAvatarDataUrl(null);
                setAvatarError(null);
              }
              clearErrors();
            }}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            disabled={signUpMutation.isPending}
          />
          <span className="leading-5">I am a merchant</span>
        </label>

        {isMerchant && (
          <>
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">
                Upload logo (optional)
              </span>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="group flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  aria-label="Upload logo"
                  disabled={signUpMutation.isPending}
                >
                  <Avatar
                    name={merchantName || email || 'Merchant'}
                    src={avatarDataUrl || undefined}
                    size="xl"
                    className={avatarError ? 'ring-2 ring-rose-500' : ''}
                  />
                </button>
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    {avatarDataUrl ? 'Change logo' : 'Upload logo'}
                  </p>
                  <p className="text-xs text-gray-500">
                    PNG or JPG up to 150KB.
                  </p>
                  {avatarError && (
                    <p className="mt-1 text-xs text-red-600" role="alert">
                      {avatarError}
                    </p>
                  )}
                </div>
              </div>
              <input
                ref={fileInputRef}
                id="avatar"
                name="avatar"
                type="file"
                accept="image/*"
                onChange={event => {
                  const file = event.target.files?.[0] ?? null;
                  handleAvatarChange(file);
                  if (event.target.value) {
                    event.target.value = '';
                  }
                }}
                className="hidden"
                disabled={signUpMutation.isPending}
              />
            </div>

            <div>
              <label
                htmlFor="merchantName"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Merchant name
              </label>
              <input
                id="merchantName"
                name="merchantName"
                type="text"
                value={merchantName}
                onChange={e => {
                  setMerchantName(e.target.value);
                  clearErrors();
                }}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  errors.merchantName ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Enter your merchant name"
                disabled={signUpMutation.isPending}
              />
              {errors.merchantName && (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  {errors.merchantName}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="merchantId"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Merchant ID
              </label>
              <input
                id="merchantId"
                name="merchantId"
                type="text"
                value={merchantId}
                onChange={e => {
                  setMerchantId(e.target.value);
                  clearErrors();
                }}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  errors.merchantId ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Enter your merchant ID"
                disabled={signUpMutation.isPending}
                required={isMerchant}
              />
              {errors.merchantId && (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  {errors.merchantId}
                </p>
              )}
            </div>
          </>
        )}

        <label className="flex items-start gap-3 text-sm text-gray-600">
          <input
            type="checkbox"
            name="marketingOptIn"
            checked={marketingOptIn}
            onChange={event => setMarketingOptIn(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            disabled={signUpMutation.isPending}
          />
          <span className="leading-5">{MARKETING_CONSENT_COPY}</span>
        </label>

        <button
          type="submit"
          disabled={signUpMutation.isPending}
          className="w-full bg-emerald-600 text-white py-2 px-4 rounded-md hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {signUpMutation.isPending ? 'Creating Account...' : 'Create Account'}
        </button>
      </form>
    </div>
  );
};
