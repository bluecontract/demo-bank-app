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
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<{ name?: string }>({});
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const signInMutation = useMutation({
    mutationFn: async (userData: { name: string }) => {
      const response = await apiClient.signIn({
        body: userData,
      });

      if (response.status === 200) {
        return response.body;
      } else {
        if (response.status === 404) {
          throw new Error(
            'User not found. Please check the name and try again.'
          );
        }

        const errorBody = response.body as
          | { error?: string; message?: string }
          | undefined;
        throw new Error(errorBody?.message || 'Sign in failed');
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
      if (error instanceof Error && error.message?.includes('User not found')) {
        setErrors({
          name: 'User not found. Please check the name and try again.',
        });
      } else {
        setErrors({ name: 'Sign in failed. Please try again.' });
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
    signInMutation.mutate({ name: name.trim() });
  };

  const clearErrors = () => {
    setErrors({});
  };

  return (
    <div className="bg-white p-8 rounded-lg shadow-md max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
        Sign In
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
            disabled={signInMutation.isPending}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-red-600" role="alert">
              {errors.name}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={signInMutation.isPending}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {signInMutation.isPending ? 'Signing In...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
};
