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
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<{ name?: string }>({});
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const signUpMutation = useMutation({
    mutationFn: async (userData: { name: string }) => {
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
            'A user with this name already exists. Please choose a different name.'
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
      if (error instanceof Error && error.message?.includes('different name')) {
        setErrors({
          name: 'A user with this name already exists. Please choose a different name.',
        });
      } else {
        setErrors({ name: 'Sign up failed. Please try again.' });
      }
    },
  });

  const validateName = (nameValue: string): string | undefined => {
    if (!nameValue.trim()) {
      return 'Name is required';
    }
    if (nameValue.length > 50) {
      return 'Name must be 50 characters or less';
    }
    return undefined;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const nameError = validateName(name);
    if (nameError) {
      setErrors({ name: nameError });
      return;
    }

    setErrors({});
    signUpMutation.mutate({ name: name.trim() });
  };

  const clearErrors = () => {
    setErrors({});
  };

  return (
    <div className="bg-white p-8 rounded-lg shadow-md max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
        Create Account
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Full Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            value={name}
            onChange={e => {
              setName(e.target.value);
              clearErrors();
            }}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.name ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Enter your full name"
            disabled={signUpMutation.isPending}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-red-600" role="alert">
              {errors.name}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={signUpMutation.isPending}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {signUpMutation.isPending ? 'Creating Account...' : 'Create Account'}
        </button>
      </form>
    </div>
  );
};
