import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AUTH_SESSION_EXPIRED_KEY,
  AUTH_STORAGE_KEY,
} from '../app/auth/constants';

export function useAuthErrorHandler() {
  const navigate = useNavigate();

  const handleAuthError = useCallback(
    (error: unknown) => {
      // Check if it's a 401 error
      const errorWithStatus = error as {
        status?: number;
        response?: { status?: number };
      };

      if (
        errorWithStatus?.status === 401 ||
        errorWithStatus?.response?.status === 401
      ) {
        let alreadyHandled = false;
        try {
          alreadyHandled =
            sessionStorage.getItem(AUTH_SESSION_EXPIRED_KEY) === 'true';
        } catch {
          alreadyHandled = false;
        }
        if (!alreadyHandled) {
          try {
            sessionStorage.setItem(AUTH_SESSION_EXPIRED_KEY, 'true');
          } catch {
            // Ignore unavailable sessionStorage
          }
          try {
            localStorage.removeItem(AUTH_STORAGE_KEY);
          } catch {
            // Ignore unavailable localStorage
          }
          document.cookie = 'demoAuth=; Max-Age=0; path=/';
          navigate('/signin', { replace: true });
        }

        return true; // Indicates we handled the error
      }

      return false; // Indicates we didn't handle the error
    },
    [navigate]
  );

  return { handleAuthError };
}
