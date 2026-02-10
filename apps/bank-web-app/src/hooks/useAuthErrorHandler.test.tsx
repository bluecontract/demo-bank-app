import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthErrorHandler } from './useAuthErrorHandler';
import { routerFutureConfig } from '../app/routerFutureConfig';
import {
  AUTH_SESSION_EXPIRED_KEY,
  AUTH_STORAGE_KEY,
} from '../app/auth/constants';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter future={routerFutureConfig}>{children}</MemoryRouter>
);

describe('useAuthErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('handles first 401 and redirects to sign-in', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ userId: 'u-1' }));

    const { result } = renderHook(() => useAuthErrorHandler(), { wrapper });

    const handled = result.current.handleAuthError({ status: 401 });

    expect(handled).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('/signin', { replace: true });
    expect(sessionStorage.getItem(AUTH_SESSION_EXPIRED_KEY)).toBe('true');
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('deduplicates repeated 401 handling', () => {
    const { result } = renderHook(() => useAuthErrorHandler(), { wrapper });

    result.current.handleAuthError({ status: 401 });
    result.current.handleAuthError({ response: { status: 401 } });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('ignores non-auth errors', () => {
    const { result } = renderHook(() => useAuthErrorHandler(), { wrapper });

    const handled = result.current.handleAuthError({ status: 500 });

    expect(handled).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
