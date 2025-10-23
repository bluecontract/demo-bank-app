import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SignInForm } from '../components/SignInForm';

export const SignInPage: React.FC = () => {
  const navigate = useNavigate();

  const handleSignInSuccess = () => {
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Welcome Back
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to your account
          </p>
        </div>

        <SignInForm onSuccess={handleSignInSuccess} />

        <div className="text-center">
          <p className="text-sm text-gray-600">
            Don't have an account?{' '}
            <button
              onClick={() => navigate('/signup')}
              className="font-medium text-emerald-600 hover:text-emerald-500"
            >
              Sign up here
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
