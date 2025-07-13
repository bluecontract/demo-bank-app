import { User, UserProps } from './User';
import { UserValidationError } from '../errors';

describe('User', () => {
  const validProps: UserProps = {
    id: 'user-123',
    name: 'testuser',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    isTest: false,
  };

  describe('constructor', () => {
    it('should create a user with valid properties', () => {
      const user = new User(validProps);

      expect(user.id).toBe(validProps.id);
      expect(user.name).toBe(validProps.name);
      expect(user.createdAt).toEqual(validProps.createdAt);
      expect(user.isTest).toBe(false);
    });

    it('should default isTest to false when not provided', () => {
      const props = { ...validProps };
      delete props.isTest;

      const user = new User(props);

      expect(user.isTest).toBe(false);
    });

    it('should accept isTest as true', () => {
      const props = { ...validProps, isTest: true };

      const user = new User(props);

      expect(user.isTest).toBe(true);
    });

    it('should handle minimum length name', () => {
      const props = { ...validProps, name: 'a' };

      const user = new User(props);

      expect(user.name).toBe('a');
    });

    it('should handle maximum length name', () => {
      const props = { ...validProps, name: 'a'.repeat(50) };

      const user = new User(props);

      expect(user.name).toBe('a'.repeat(50));
    });

    it('should handle names with mixed valid characters', () => {
      const props = { ...validProps, name: 'User_123-test' };

      const user = new User(props);

      expect(user.name).toBe('User_123-test');
    });
  });

  describe('validation', () => {
    describe('id validation', () => {
      it('should throw UserValidationError when id is empty', () => {
        const props = { ...validProps, id: '' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow('User ID cannot be empty');
      });

      it('should throw UserValidationError when id is whitespace', () => {
        const props = { ...validProps, id: '   ' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow('User ID cannot be empty');
      });
    });

    describe('name validation', () => {
      it('should throw UserValidationError when name is empty', () => {
        const props = { ...validProps, name: '' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'User name must be at least 1 character(s)'
        );
      });

      it('should throw UserValidationError when name is whitespace', () => {
        const props = { ...validProps, name: '   ' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'User name must be at least 1 character(s)'
        );
      });

      it('should throw UserValidationError when name is too short', () => {
        const props = { ...validProps, name: '' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'User name must be at least 1 character(s)'
        );
      });

      it('should throw UserValidationError when name is too long', () => {
        const props = { ...validProps, name: 'a'.repeat(51) };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'User name must be no more than 50 characters'
        );
      });

      it('should throw UserValidationError when name contains invalid characters', () => {
        const invalidNames = [
          'user@test',
          'user space',
          'user!',
          'user#test',
          'user$',
        ];

        invalidNames.forEach(invalidName => {
          const props = { ...validProps, name: invalidName };

          expect(() => new User(props)).toThrow(UserValidationError);
          expect(() => new User(props)).toThrow(
            'User name can only contain letters, numbers, hyphens, and underscores'
          );
        });
      });

      it('should accept valid names', () => {
        const validNames = [
          'user123',
          'user_test',
          'user-test',
          'USER',
          'User123',
          'test_user-123',
        ];

        validNames.forEach(validName => {
          const props = { ...validProps, name: validName };

          expect(() => new User(props)).not.toThrow();
        });
      });
    });

    describe('createdAt validation', () => {
      it('should throw UserValidationError when createdAt is not a Date', () => {
        const props = {
          ...validProps,
          createdAt: 'invalid-date' as unknown as Date,
        };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'Created date must be a valid Date'
        );
      });

      it('should throw UserValidationError when createdAt is in the future', () => {
        const futureDate = new Date(Date.now() + 1000);
        const props = { ...validProps, createdAt: futureDate };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'Created date cannot be in the future'
        );
      });

      it('should accept past dates', () => {
        const pastDate = new Date(Date.now() - 1000);
        const props = { ...validProps, createdAt: pastDate };

        expect(() => new User(props)).not.toThrow();
      });

      it('should accept current date', () => {
        const currentDate = new Date();
        const props = { ...validProps, createdAt: currentDate };

        expect(() => new User(props)).not.toThrow();
      });
    });
  });

  describe('equals', () => {
    it('should return true for identical users', () => {
      const user1 = new User(validProps);
      const user2 = new User(validProps);

      expect(user1.equals(user2)).toBe(true);
    });

    it('should return false for users with different ids', () => {
      const user1 = new User(validProps);
      const user2 = new User({ ...validProps, id: 'different-id' });

      expect(user1.equals(user2)).toBe(false);
    });

    it('should return false for users with different names', () => {
      const user1 = new User(validProps);
      const user2 = new User({
        ...validProps,
        name: 'different-name',
      });

      expect(user1.equals(user2)).toBe(false);
    });

    it('should return false for users with different creation dates', () => {
      const user1 = new User(validProps);
      const user2 = new User({
        ...validProps,
        createdAt: new Date('2024-01-02T00:00:00Z'),
      });

      expect(user1.equals(user2)).toBe(false);
    });

    it('should return false for users with different isTest values', () => {
      const user1 = new User(validProps);
      const user2 = new User({ ...validProps, isTest: true });

      expect(user1.equals(user2)).toBe(false);
    });
  });
});
