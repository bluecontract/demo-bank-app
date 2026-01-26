import { UserValidationError } from '../errors';

export interface UserProps {
  id: string;
  email: string;
  createdAt: Date;
  isTest?: boolean;
  marketingEmailsOptIn: boolean;
  merchantId?: string;
}

const USER_CONSTANTS = {
  MIN_EMAIL_LENGTH: 3,
  MAX_EMAIL_LENGTH: 254,
  EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
} as const;

export class User {
  readonly id: string;
  readonly email: string;
  readonly createdAt: Date;
  readonly isTest: boolean;
  readonly marketingEmailsOptIn: boolean;
  readonly merchantId?: string;

  constructor(props: UserProps) {
    if (!props.id || props.id.trim() === '') {
      throw new UserValidationError('id', 'User ID cannot be empty');
    }

    if (!props.email || props.email.trim() === '') {
      throw new UserValidationError('email', 'User email must be provided');
    }

    const normalizedEmail = props.email.trim().toLowerCase();

    if (normalizedEmail.length < USER_CONSTANTS.MIN_EMAIL_LENGTH) {
      throw new UserValidationError(
        'email',
        `User email must be at least ${USER_CONSTANTS.MIN_EMAIL_LENGTH} character(s)`
      );
    }

    if (normalizedEmail.length > USER_CONSTANTS.MAX_EMAIL_LENGTH) {
      throw new UserValidationError(
        'email',
        `User email must be no more than ${USER_CONSTANTS.MAX_EMAIL_LENGTH} characters`
      );
    }

    if (!USER_CONSTANTS.EMAIL_PATTERN.test(normalizedEmail)) {
      throw new UserValidationError(
        'email',
        'User email must be a valid email address'
      );
    }

    if (!props.createdAt || !(props.createdAt instanceof Date)) {
      throw new UserValidationError(
        'createdAt',
        'Created date must be a valid Date'
      );
    }

    if (props.createdAt > new Date()) {
      throw new UserValidationError(
        'createdAt',
        'Created date cannot be in the future'
      );
    }

    if (typeof props.marketingEmailsOptIn !== 'boolean') {
      throw new UserValidationError(
        'marketingEmailsOptIn',
        'Marketing emails opt-in flag must be a boolean'
      );
    }

    const normalizedMerchantId = props.merchantId?.trim();
    if (props.merchantId !== undefined && normalizedMerchantId === '') {
      throw new UserValidationError(
        'merchantId',
        'Merchant ID cannot be empty'
      );
    }

    this.id = props.id;
    this.email = normalizedEmail;
    this.createdAt = props.createdAt;
    this.isTest = props.isTest ?? false;
    this.marketingEmailsOptIn = props.marketingEmailsOptIn;
    this.merchantId = normalizedMerchantId;
  }

  equals(other: User): boolean {
    return (
      this.id === other.id &&
      this.email === other.email &&
      this.createdAt.getTime() === other.createdAt.getTime() &&
      this.isTest === other.isTest &&
      this.marketingEmailsOptIn === other.marketingEmailsOptIn &&
      this.merchantId === other.merchantId
    );
  }
}
