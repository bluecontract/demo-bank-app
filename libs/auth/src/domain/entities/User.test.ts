import { User, type UserProps } from './User';
import { UserValidationError } from '../errors';

describe('User', () => {
  const validProps: UserProps = {
    id: 'user-123',
    email: 'test.user@example.com',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    isTest: false,
    marketingEmailsOptIn: true,
  };

  describe('constructor', () => {
    it('creates a user with valid properties', () => {
      const user = new User(validProps);

      expect(user.id).toBe(validProps.id);
      expect(user.email).toBe(validProps.email.toLowerCase());
      expect(user.createdAt).toEqual(validProps.createdAt);
      expect(user.isTest).toBe(false);
      expect(user.marketingEmailsOptIn).toBe(true);
    });

    it('defaults isTest to false when not provided', () => {
      const props = { ...validProps };
      delete props.isTest;

      const user = new User(props);

      expect(user.isTest).toBe(false);
      expect(user.marketingEmailsOptIn).toBe(true);
    });

    it('accepts isTest as true', () => {
      const user = new User({ ...validProps, isTest: true });

      expect(user.isTest).toBe(true);
    });

    it('normalises email to lowercase and trims whitespace', () => {
      const user = new User({
        ...validProps,
        email: '  Test.USER@Example.COM ',
      });

      expect(user.email).toBe('test.user@example.com');
    });

    it('accepts merchantId and trims whitespace', () => {
      const user = new User({
        ...validProps,
        merchantId: '  merchant-123  ',
      });

      expect(user.merchantId).toBe('merchant-123');
    });
  });

  describe('validation', () => {
    describe('id validation', () => {
      it('throws when id is empty', () => {
        const props = { ...validProps, id: '' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow('User ID cannot be empty');
      });

      it('throws when id is whitespace', () => {
        const props = { ...validProps, id: '   ' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow('User ID cannot be empty');
      });
    });

    describe('email validation', () => {
      it('throws when email is empty', () => {
        const props = { ...validProps, email: '' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow('User email must be provided');
      });

      it('throws when email is whitespace', () => {
        const props = { ...validProps, email: '   ' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow('User email must be provided');
      });

      it('throws when email is too short', () => {
        const props = { ...validProps, email: 'a@' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'User email must be at least 3 character(s)'
        );
      });

      it('throws when email is too long', () => {
        const longLocalPart = 'a'.repeat(255);
        const props = { ...validProps, email: `${longLocalPart}@example.com` };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'User email must be no more than 254 characters'
        );
      });

      it('throws when email is invalid', () => {
        const invalidEmails = [
          'plainaddress',
          '@missinglocal.com',
          'missingdomain@',
          'missingatsign.com',
          'user@ example.com',
        ];

        invalidEmails.forEach(email => {
          const props = { ...validProps, email };

          expect(() => new User(props)).toThrow(UserValidationError);
          expect(() => new User(props)).toThrow(
            'User email must be a valid email address'
          );
        });
      });

      it('accepts valid emails', () => {
        const validEmails = [
          'user@example.com',
          'user.name+tag@example.co.uk',
          'user_name@example.io',
          'user-name@sub.example.com',
        ];

        validEmails.forEach(email => {
          expect(() => new User({ ...validProps, email })).not.toThrow();
        });
      });
    });

    describe('createdAt validation', () => {
      it('throws when createdAt is not a Date', () => {
        const props = {
          ...validProps,
          createdAt: 'invalid-date' as unknown as Date,
        };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'Created date must be a valid Date'
        );
      });

      it('throws when createdAt is in the future', () => {
        const futureDate = new Date(Date.now() + 1000);
        const props = { ...validProps, createdAt: futureDate };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'Created date cannot be in the future'
        );
      });

      it('accepts past dates', () => {
        const pastDate = new Date(Date.now() - 1000);
        const props = { ...validProps, createdAt: pastDate };

        expect(() => new User(props)).not.toThrow();
      });

      it('accepts current date', () => {
        const currentDate = new Date();
        const props = { ...validProps, createdAt: currentDate };

        expect(() => new User(props)).not.toThrow();
      });
    });

    describe('marketingEmailsOptIn validation', () => {
      it('throws when marketingEmailsOptIn is not a boolean', () => {
        const props = {
          ...validProps,
          marketingEmailsOptIn: 'yes' as unknown as boolean,
        };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow(
          'Marketing emails opt-in flag must be a boolean'
        );
      });

      it('accepts false as a value', () => {
        const props = { ...validProps, marketingEmailsOptIn: false };

        expect(() => new User(props)).not.toThrow();
        expect(new User(props).marketingEmailsOptIn).toBe(false);
      });
    });

    describe('merchantId validation', () => {
      it('throws when merchantId is empty', () => {
        const props = { ...validProps, merchantId: '' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow('Merchant ID cannot be empty');
      });

      it('throws when merchantId is whitespace', () => {
        const props = { ...validProps, merchantId: '   ' };

        expect(() => new User(props)).toThrow(UserValidationError);
        expect(() => new User(props)).toThrow('Merchant ID cannot be empty');
      });
    });
  });

  describe('equals', () => {
    it('returns true for identical users', () => {
      const user1 = new User(validProps);
      const user2 = new User(validProps);

      expect(user1.equals(user2)).toBe(true);
    });

    it('returns false for users with different ids', () => {
      const user1 = new User(validProps);
      const user2 = new User({ ...validProps, id: 'different-id' });

      expect(user1.equals(user2)).toBe(false);
    });

    it('returns false for users with different emails', () => {
      const user1 = new User(validProps);
      const user2 = new User({
        ...validProps,
        email: 'another.user@example.com',
      });

      expect(user1.equals(user2)).toBe(false);
    });

    it('returns false for users with different creation dates', () => {
      const user1 = new User(validProps);
      const user2 = new User({
        ...validProps,
        createdAt: new Date('2024-01-02T00:00:00Z'),
      });

      expect(user1.equals(user2)).toBe(false);
    });

    it('returns false for users with different isTest values', () => {
      const user1 = new User(validProps);
      const user2 = new User({ ...validProps, isTest: true });

      expect(user1.equals(user2)).toBe(false);
    });

    it('returns false for users with different marketingEmailsOptIn values', () => {
      const user1 = new User(validProps);
      const user2 = new User({
        ...validProps,
        marketingEmailsOptIn: false,
      });

      expect(user1.equals(user2)).toBe(false);
    });

    it('returns false for users with different merchantId values', () => {
      const user1 = new User({ ...validProps, merchantId: 'merchant-1' });
      const user2 = new User({ ...validProps, merchantId: 'merchant-2' });

      expect(user1.equals(user2)).toBe(false);
    });
  });
});
