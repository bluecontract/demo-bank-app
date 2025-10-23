import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../app/providers/ApiProvider';
import { useAuth } from '../../../app/providers/AuthProvider';
import { User } from '../../../types/api';

interface SignUpFormProps {
  onSuccess?: (user: User) => void;
}

export const SignUpForm: React.FC<SignUpFormProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ email?: string }>({});
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const signUpMutation = useMutation({
    mutationFn: async (userData: { email: string }) => {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const emailError = validateEmail(email);
    if (emailError) {
      setErrors({ email: emailError });
      return;
    }

    setErrors({});
    signUpMutation.mutate({ email: email.trim().toLowerCase() });
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
