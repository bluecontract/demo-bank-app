import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function useAuthErrorHandler() {
  const navigate = useNavigate();

  const handleAuthError = useCallback(
    (error: any) => {
      // Check if it's a 401 error
      if (error?.status === 401 || error?.response?.status === 401) {
        // Show session expired message
        alert('Your session has expired. Please sign in again.');

        // Redirect to sign in page
        navigate('/signin');

        return true; // Indicates we handled the error
      }

      return false; // Indicates we didn't handle the error
    },
    [navigate]
  );

  return { handleAuthError };
}
