import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../app/providers/ApiProvider';
import { useAuth } from '../../../app/providers/AuthProvider';
import { User } from '../../../types/api';

interface SignInFormProps {
  onSuccess?: (user: User) => void;
}

export const SignInForm: React.FC<SignInFormProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ email?: string }>({});
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const genericErrorMessage = 'Sign in failed. Please try again.';

  const signInMutation = useMutation({
    mutationFn: async (userData: { email: string }) => {
      const response = await apiClient.signIn({
        body: userData,
      });

      if (response.status === 200) {
        return response.body;
      } else {
        if (response.status === 404) {
          throw new Error(genericErrorMessage);
        }

        const errorBody = response.body as
          | { error?: string; message?: string }
          | undefined;
        throw new Error(errorBody?.message || genericErrorMessage);
      }
    },
    onSuccess: data => {
      setErrors({});
      // Update auth state via AuthProvider
      signIn(data);
      onSuccess?.(data);
      // Navigate to dashboard after successful sign in
      navigate('/dashboard');
    },
    onError: (error: unknown) => {
      setErrors({ email: genericErrorMessage });
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
    signInMutation.mutate({ email: email.trim().toLowerCase() });
  };

  const clearErrors = () => {
    setErrors({});
  };

  return (
    <div className="bg-white p-8 rounded-lg shadow-md max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
        Sign In
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
            disabled={signInMutation.isPending}
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-600" role="alert">
              {errors.email}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={signInMutation.isPending}
          className="w-full bg-emerald-600 text-white py-2 px-4 rounded-md hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {signInMutation.isPending ? 'Signing In...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
};
