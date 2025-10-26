# Bank Web App E2E Tests

This directory contains comprehensive end-to-end tests for the Bank Web App using Playwright.

## Test Structure

The test suite is organized into the following modules:

### Authentication Tests (`src/auth/`)

- **`signin.test.ts`** – email-based sign-in, sign-out, session persistence, and protected route checks
- **`signup.test.ts`** – email registration flow and duplicate email handling

### Banking Features Tests (`src/banking/`)

- **`banking-core-flows.test.ts`** - Core banking operations
- **`form-validation.test.ts`** - Form validation scenarios

### Health Check Tests (`src/`)

- **`health.test.ts`** - Application health status verification

## Banking Features Test Coverage

The banking core flows test comprehensively covers:

### 1. Account Creation

- ✅ Create new account with modal interface
- ✅ Display account in horizontal list
- ✅ Verify initial $0.00 balance

### 2. Account List & Navigation

- ✅ Display multiple accounts in horizontal scrollable list
- ✅ Test horizontal scrolling functionality with scroll arrows
- ✅ Account selection and switching

### 3. Fund Account Operations

- ✅ Fund account using modal interface
- ✅ Confirmation page display
- ✅ Account balance refresh after funding
- ✅ Multiple funding operations and cumulative balance updates

### 4. Transfer Money Operations

- ✅ Transfer money between accounts
- ✅ Form validation (account number format, amount validation)
- ✅ Transfer confirmation page
- ✅ Source account balance refresh after transfer

### 5. Transaction History

- ✅ Display transaction history for selected account
- ✅ Show account-specific transactions
- ✅ Switch between accounts and see respective transaction history
- ✅ Empty state display for accounts with no transactions

### 6. Transaction Details

- ✅ Display transaction details for incoming transfers (funding)
- ✅ Display transaction details for outgoing transfers
- ✅ Transaction status display (COMPLETED)
- ✅ Transaction amount and direction display (+/-)
- ✅ Counterparty account information (To/From)

### 7. Balance Updates

- ✅ Real-time balance updates after fund operations
- ✅ Real-time balance updates after transfer operations
- ✅ Multiple operation balance accumulation

### 8. Form Validation

- ✅ Account creation form validation (required fields, max length)
- ✅ Fund account form validation (required amount, positive values, decimal places)
- ✅ Transfer form validation (account number format, amount validation, insufficient funds)
- ✅ Input sanitization (account numbers, amounts)
- ✅ Error message clearing on user correction

## Test Configuration

### Environment Variables

- `E2E_BASE_URL` – Base URL for the application (defaults to `http://localhost:4200`)

### Test Data

- Tests generate unique **email addresses** via `createUniqueEmail` for every sign-up
- Each scenario creates isolated demo users, accounts, and amounts
- Helper functions in `src/constants.ts` centralise unique name / amount generation

### Timeouts

- **Navigation**: 20 seconds
- **Modal load**: 5 seconds
- **API response**: 8 seconds
- **Balance update**: 5 seconds
- **Transfer completion**: 20 seconds

## Running the Tests

```bash
# Run all e2e tests
npx nx run bank-web-app-e2e:e2e

# Run specific test file
npx nx run bank-web-app-e2e:e2e --spec="src/banking/banking-core-flows.test.ts"

# Run with UI mode
npx nx run bank-web-app-e2e:e2e --ui

# Run with headed browser
npx nx run bank-web-app-e2e:e2e --headed
```

## Test Principles

### 1. Independence

Each test is completely independent and creates its own test data:

- Unique email accounts are generated for each scenario
- Account names and monetary amounts are randomised per run
- No shared state between tests

### 2. Comprehensive Coverage

Tests cover complete user journeys:

- **Happy path flows** - Normal user operations
- **Edge cases** - Form validation, error handling
- **State verification** - Balance updates, transaction history

### 3. Realistic User Behavior

Tests simulate real user interactions:

- Modal opening and closing
- Form filling and submission
- Account selection and switching
- Transaction detail viewing

### 4. Reliable Assertions

Tests use appropriate waiting strategies:

- Reusable helpers (`waitForDashboard`, `waitForModalToOpen/Close`, `waitForTransferCompletion`) wrap Playwright waits
- API-driven UI updates (balances, transaction history) wait for specific containers to stabilise
- Explicit verification of visible elements using role/text selectors within scoped containers

## Key Features Tested

### Modal Interactions

- Account creation modal
- Fund account modal
- Transaction details modal
- Confirmation pages

### Form Validation

- Required field validation
- Amount format validation
- Account number format validation
- Insufficient funds validation

### UI State Management

- Account selection state
- Transaction history filtering
- Balance display updates
- Loading states

### Navigation & Scrolling

- Horizontal account list scrolling
- Scroll arrow visibility and functionality
- Account switching via click

## Maintenance Notes

### Adding New Tests

1. Follow the existing patterns (e.g. `banking-core-flows.test.ts`, `auth/signin.test.ts`)
2. Reuse helper utilities exported from `src/constants.ts` (navigation waits, tooltip helpers, form validation helpers)
3. Generate unique emails/accounts for every test to avoid clashes in parallel runs
4. Ensure UI is brought back to a stable state (close modals, wait for loaders to disappear)

### Updating Selectors

- Prefer `data-testid` attributes exposed by the app (e.g. `dashboard-main-container`, `confirmation-container`)
- Use accessible selectors (`getByRole`, `getByText`) for user-facing content
- Update shared helpers in `constants.ts` when selectors change

### Test Debugging

- Use `--headed` flag to see browser interactions
- Use `--ui` flag for interactive test debugging
- Check screenshot and video outputs for failed tests
