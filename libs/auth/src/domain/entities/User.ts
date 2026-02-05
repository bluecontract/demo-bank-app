import { UserValidationError } from '../errors';

export interface UserProps {
  id: string;
  email: string;
  createdAt: Date;
  isTest?: boolean;
  marketingEmailsOptIn: boolean;
  merchantId?: string;
  merchantName?: string;
  avatarDataUrl?: string;
}

const USER_CONSTANTS = {
  MIN_EMAIL_LENGTH: 3,
  MAX_EMAIL_LENGTH: 254,
  EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  MAX_MERCHANT_NAME_LENGTH: 140,
  MAX_AVATAR_DATA_URL_LENGTH: 200_000,
} as const;

export class User {
  readonly id: string;
  readonly email: string;
  readonly createdAt: Date;
  readonly isTest: boolean;
  readonly marketingEmailsOptIn: boolean;
  readonly merchantId?: string;
  readonly merchantName?: string;
  readonly avatarDataUrl?: string;

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

    const normalizedMerchantName = props.merchantName?.trim();
    if (props.merchantName !== undefined && normalizedMerchantName === '') {
      throw new UserValidationError(
        'merchantName',
        'Merchant name cannot be empty'
      );
    }
    if (
      normalizedMerchantName &&
      normalizedMerchantName.length > USER_CONSTANTS.MAX_MERCHANT_NAME_LENGTH
    ) {
      throw new UserValidationError(
        'merchantName',
        `Merchant name must be ${USER_CONSTANTS.MAX_MERCHANT_NAME_LENGTH} characters or less`
      );
    }

    const normalizedAvatarDataUrl = props.avatarDataUrl?.trim();
    if (props.avatarDataUrl !== undefined && normalizedAvatarDataUrl === '') {
      throw new UserValidationError(
        'avatarDataUrl',
        'Avatar data URL cannot be empty'
      );
    }
    if (
      normalizedAvatarDataUrl &&
      normalizedAvatarDataUrl.length > USER_CONSTANTS.MAX_AVATAR_DATA_URL_LENGTH
    ) {
      throw new UserValidationError(
        'avatarDataUrl',
        `Avatar data URL must be ${USER_CONSTANTS.MAX_AVATAR_DATA_URL_LENGTH} characters or less`
      );
    }
    if (
      normalizedAvatarDataUrl &&
      !normalizedAvatarDataUrl.startsWith('data:image/')
    ) {
      throw new UserValidationError(
        'avatarDataUrl',
        'Avatar must be a valid data URL'
      );
    }

    this.id = props.id;
    this.email = normalizedEmail;
    this.createdAt = props.createdAt;
    this.isTest = props.isTest ?? false;
    this.marketingEmailsOptIn = props.marketingEmailsOptIn;
    this.merchantId = normalizedMerchantId;
    this.merchantName = normalizedMerchantName;
    this.avatarDataUrl = normalizedAvatarDataUrl;
  }

  equals(other: User): boolean {
    return (
      this.id === other.id &&
      this.email === other.email &&
      this.createdAt.getTime() === other.createdAt.getTime() &&
      this.isTest === other.isTest &&
      this.marketingEmailsOptIn === other.marketingEmailsOptIn &&
      this.merchantId === other.merchantId &&
      this.merchantName === other.merchantName &&
      this.avatarDataUrl === other.avatarDataUrl
    );
  }
}
