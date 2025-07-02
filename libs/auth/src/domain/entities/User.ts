import { randomUUID } from 'node:crypto';
import { InvalidUserNameError } from '../errors';

// Branded types for type safety
export type UserId = string & { readonly _brand: 'UserId' };
export type UserName = string & { readonly _brand: 'UserName' };

// User name validation constants
const USER_NAME_MAX_LENGTH = 50;
const USER_NAME_PATTERN = /^[a-zA-Z0-9-_]+$/;

export interface UserPersistenceData {
  id: UserId;
  name: UserName;
  createdAt: string; // ISO format: "2024-01-15T10:30:00.000Z"
  isTest: boolean;
}

export class User {
  private constructor(
    private readonly _id: UserId,
    private readonly _name: UserName,
    private readonly _createdAt: Date,
    private readonly _isTest: boolean
  ) {}

  get id(): UserId {
    return this._id;
  }

  get name(): UserName {
    return this._name;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get isTest(): boolean {
    return this._isTest;
  }

  static create(name: UserName, isTest = false): User {
    User.validateUserName(name);

    return new User(randomUUID() as UserId, name, new Date(), isTest);
  }

  static fromPersistence(data: UserPersistenceData): User {
    return new User(data.id, data.name, new Date(data.createdAt), data.isTest);
  }

  toPersistence(): UserPersistenceData {
    return {
      id: this._id,
      name: this._name,
      createdAt: this._createdAt.toISOString(),
      isTest: this._isTest,
    };
  }

  private static validateUserName(name: UserName): void {
    if (!name || name.trim().length === 0) {
      throw new InvalidUserNameError(name, 'name cannot be empty');
    }

    if (name.length > USER_NAME_MAX_LENGTH) {
      throw new InvalidUserNameError(
        name,
        `name cannot exceed ${USER_NAME_MAX_LENGTH} characters`
      );
    }

    if (!USER_NAME_PATTERN.test(name)) {
      throw new InvalidUserNameError(
        name,
        'name can only contain letters, numbers, hyphens, and underscores'
      );
    }
  }
}
