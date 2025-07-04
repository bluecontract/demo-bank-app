import { describe, it, expect } from 'vitest';
import { User, UserId, UserName } from './User';
import { InvalidUserNameError } from '../errors';

describe('User Entity', () => {
  describe('create', () => {
    it('should create a valid user with valid name', () => {
      // Given
      const validName = 'john-doe' as UserName;

      // When
      const user = User.create(validName);

      // Then
      expect(user.id).toBeDefined();
      expect(user.name).toBe(validName);
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.isTest).toBe(false);
    });

    it('should create test user when isTest flag is true', () => {
      // Given
      const testName = 'test-user' as UserName;

      // When
      const user = User.create(testName, true);

      // Then
      expect(user.isTest).toBe(true);
      expect(user.name).toBe(testName);
    });

    describe('validation edge cases', () => {
      it('should throw InvalidUserNameError for empty name', () => {
        // Given
        const emptyName = '' as UserName;

        // When & Then
        expect(() => User.create(emptyName)).toThrow(InvalidUserNameError);
        expect(() => User.create(emptyName)).toThrow('name cannot be empty');
      });

      it('should throw InvalidUserNameError for whitespace-only name', () => {
        // Given
        const whitespaceOnlyName = '   ' as UserName;

        // When & Then
        expect(() => User.create(whitespaceOnlyName)).toThrow(
          InvalidUserNameError
        );
        expect(() => User.create(whitespaceOnlyName)).toThrow(
          'name cannot be empty'
        );
      });

      it('should throw InvalidUserNameError for name with invalid characters', () => {
        // Given
        const invalidName = 'john@doe!' as UserName;

        // When & Then
        expect(() => User.create(invalidName)).toThrow(InvalidUserNameError);
        expect(() => User.create(invalidName)).toThrow(
          'name can only contain letters, numbers, hyphens, and underscores'
        );
      });

      it('should throw InvalidUserNameError for name exceeding max length (50 chars)', () => {
        // Given
        const longName = 'a'.repeat(51) as UserName;

        // When & Then
        expect(() => User.create(longName)).toThrow(InvalidUserNameError);
        expect(() => User.create(longName)).toThrow(
          'name cannot exceed 50 characters'
        );
      });

      it('should accept name at max length boundary (50 chars)', () => {
        // Given
        const maxLengthName = 'a'.repeat(50) as UserName;

        // When
        const user = User.create(maxLengthName);

        // Then
        expect(user.name).toBe(maxLengthName);
      });

      it('should accept valid names with all allowed characters', () => {
        // Given
        const validNames = [
          'user123',
          'test-user',
          'user_name',
          'User-123_test',
          'a',
          '1',
          'user-name-with-dashes',
          'user_name_with_underscores',
        ] as UserName[];

        // When & Then
        validNames.forEach(name => {
          expect(() => User.create(name)).not.toThrow();
        });
      });

      it('should reject names with special characters', () => {
        // Given
        const invalidNames = [
          'user@example.com',
          'user with spaces',
          'user.name',
          'user+name',
          'user#name',
          'user$name',
          'user%name',
          'user&name',
          'user*name',
          'user(name)',
          'user[name]',
          'user{name}',
          'user/name',
          'user\\name',
        ] as UserName[];

        // When & Then
        invalidNames.forEach(name => {
          expect(() => User.create(name)).toThrow(InvalidUserNameError);
        });
      });
    });

    it('should generate unique IDs for multiple users', () => {
      // Given
      const name1 = 'user1' as UserName;
      const name2 = 'user2' as UserName;

      // When
      const user1 = User.create(name1);
      const user2 = User.create(name2);

      // Then
      expect(user1.id).not.toBe(user2.id);
      expect(user1.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(user2.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should set createdAt to current time', () => {
      // Given
      const before = new Date();
      const name = 'test-user' as UserName;

      // When
      const user = User.create(name);
      const after = new Date();

      // Then
      expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(user.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('fromPersistence', () => {
    it('should reconstruct user from persistence data', () => {
      // Given
      const persistenceData = {
        id: 'user-123' as UserId,
        name: 'john-doe' as UserName,
        createdAt: '2024-01-01T00:00:00.000Z',
        isTest: false,
      };

      // When
      const user = User.fromPersistence(persistenceData);

      // Then
      expect(user.id).toBe(persistenceData.id);
      expect(user.name).toBe(persistenceData.name);
      expect(user.createdAt).toEqual(new Date(persistenceData.createdAt));
      expect(user.isTest).toBe(false);
    });

    it('should reconstruct test user from persistence data', () => {
      // Given
      const persistenceData = {
        id: 'test-user-456' as UserId,
        name: 'test-john' as UserName,
        createdAt: '2024-01-01T00:00:00.000Z',
        isTest: true,
      };

      // When
      const user = User.fromPersistence(persistenceData);

      // Then
      expect(user.id).toBe(persistenceData.id);
      expect(user.name).toBe(persistenceData.name);
      expect(user.createdAt).toEqual(new Date(persistenceData.createdAt));
      expect(user.isTest).toBe(true);
    });
  });

  describe('toPersistence', () => {
    it('should convert user to persistence format', () => {
      // Given
      const user = User.create('john-doe' as UserName);

      // When
      const persistenceData = user.toPersistence();

      // Then
      expect(persistenceData.id).toBe(user.id);
      expect(persistenceData.name).toBe(user.name);
      expect(persistenceData.createdAt).toBe(user.createdAt.toISOString());
      expect(persistenceData.isTest).toBe(user.isTest);
    });

    it('should convert test user to persistence format', () => {
      // Given
      const user = User.create('test-user' as UserName, true);

      // When
      const persistenceData = user.toPersistence();

      // Then
      expect(persistenceData.id).toBe(user.id);
      expect(persistenceData.name).toBe(user.name);
      expect(persistenceData.createdAt).toBe(user.createdAt.toISOString());
      expect(persistenceData.isTest).toBe(true);
    });

    it('should maintain data integrity through persistence round-trip', () => {
      // Given
      const originalUser = User.create('round-trip-test' as UserName, true);

      // When
      const persistenceData = originalUser.toPersistence();
      const reconstructedUser = User.fromPersistence(persistenceData);

      // Then
      expect(reconstructedUser.id).toBe(originalUser.id);
      expect(reconstructedUser.name).toBe(originalUser.name);
      expect(reconstructedUser.createdAt).toEqual(originalUser.createdAt);
      expect(reconstructedUser.isTest).toBe(originalUser.isTest);
    });
  });
});
