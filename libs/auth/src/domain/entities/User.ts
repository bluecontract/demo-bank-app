import { UserValidationError } from '../errors';
export interface UserProps {
  id: string;
  name: string;
  createdAt: Date;
  isTest?: boolean;
}

const USER_CONSTANTS = {
  MIN_NAME_LENGTH: 1,
  MAX_NAME_LENGTH: 50,
  NAME_PATTERN: /^[a-zA-Z0-9_-]+$/,
} as const;

export class User {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly isTest: boolean;

  constructor(props: UserProps) {
    if (!props.id || props.id.trim() === '') {
      throw new UserValidationError('id', 'User ID cannot be empty');
    }

    if (!props.name || props.name.trim() === '') {
      throw new UserValidationError(
        'name',
        `User name must be at least ${USER_CONSTANTS.MIN_NAME_LENGTH} character(s)`
      );
    }

    if (props.name.length < USER_CONSTANTS.MIN_NAME_LENGTH) {
      throw new UserValidationError(
        'name',
        `User name must be at least ${USER_CONSTANTS.MIN_NAME_LENGTH} character(s)`
      );
    }

    if (props.name.length > USER_CONSTANTS.MAX_NAME_LENGTH) {
      throw new UserValidationError(
        'name',
        `User name must be no more than ${USER_CONSTANTS.MAX_NAME_LENGTH} characters`
      );
    }

    if (!USER_CONSTANTS.NAME_PATTERN.test(props.name)) {
      throw new UserValidationError(
        'name',
        'User name can only contain letters, numbers, hyphens, and underscores'
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

    this.id = props.id;
    this.name = props.name;
    this.createdAt = props.createdAt;
    this.isTest = props.isTest ?? false;
  }

  equals(other: User): boolean {
    return (
      this.id === other.id &&
      this.name === other.name &&
      this.createdAt.getTime() === other.createdAt.getTime() &&
      this.isTest === other.isTest
    );
  }
}
