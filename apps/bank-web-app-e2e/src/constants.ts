// Central constants for E2E tests
export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:4200';

// URL constants
export const URLS = {
  HOME: `${BASE_URL}/?e2e=true`,
  SIGNUP: `${BASE_URL}/signup?e2e=true`,
  DASHBOARD: `${BASE_URL}/dashboard`,
} as const;

// Test data constants
export const TEST_DATA = {
  VALIDATION: {
    MAX_NAME_LENGTH: 50,
  },
  TIMEOUTS: {
    NAVIGATION: 10000,
  },
} as const;

// Helper functions
export const createUniqueName = (prefix = 'testuser') => {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 5)}`;
};

export const DASHBOARD_HEADING_TEXT = 'Welcome back';
