import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from 'aws-lambda';

// Mock the dependencies before importing the module
const mockRepositoryInstance = {
  saveAccount: vi.fn(),
};

const MockedDynamoBankingRepository = vi.fn(() => mockRepositoryInstance);
const MockedAccount = vi.fn();
const MockedMoney = vi.fn();

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.doMock('@demo-bank-app/banking', () => ({
  DynamoBankingRepository: MockedDynamoBankingRepository,
  Account: MockedAccount,
  FUNDING_SOURCE: {
    ACCOUNT_ID: 'FUNDING_SOURCE',
    ACCOUNT_NUMBER: '0000000000',
  },
  Money: MockedMoney,
}));

// Import the handler after mocking
const { handler } = await import('./seed-funding-source.ts');
const testHandler = handler as any;

describe('seed-funding-source functional tests', () => {
  let mockContext: Context;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Money constructor
    MockedMoney.mockImplementation(
      (value: number) =>
        ({
          toCents: () => value,
          isLessThan: vi.fn(),
          add: vi.fn(),
          subtract: vi.fn(),
          equals: vi.fn(),
        } as any)
    );

    // Mock Account constructor
    MockedAccount.mockImplementation((props: any) => props as any);

    // Mock fetch with successful response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    // Mock context
    mockContext = {
      logStreamName: 'test-log-stream',
      awsRequestId: 'test-request-id',
      functionName: 'test-function',
      functionVersion: '1',
      invokedFunctionArn: 'arn:test',
      memoryLimitInMB: '128',
      remainingTimeInMillis: 30000,
      callbackWaitsForEmptyEventLoop: true,
      logGroupName: 'test-log-group',
      getRemainingTimeInMillis: () => 30000,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    } as Context;

    // Set environment variables
    process.env.TABLE = 'test-table';
    process.env.AWS_REGION = 'eu-west-1';
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
  });

  describe('repository configuration', () => {
    it('should configure repository with correct parameters', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(MockedDynamoBankingRepository).toHaveBeenCalledWith({
        tableName: 'test-table',
        region: 'eu-west-1',
        endpoint: 'http://localhost:4566',
      });
    });

    it('should handle missing endpoint URL', async () => {
      delete process.env.AWS_ENDPOINT_URL;

      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(MockedDynamoBankingRepository).toHaveBeenCalledWith({
        tableName: 'test-table',
        region: 'eu-west-1',
      });
    });
  });

  describe('Create event handling', () => {
    it('should create funding source account with correct parameters', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(MockedAccount).toHaveBeenCalledWith({
        id: 'FUNDING_SOURCE',
        accountNumber: '0000000000',
        name: 'System Funding Source',
        ownerUserId: 'SYSTEM',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: expect.any(Date),
        isTest: false,
        ledgerBalanceMinor: expect.any(Object), // Money instance
        availableBalanceMinor: expect.any(Object), // Money instance
        balanceVersion: 0,
      });

      expect(MockedMoney).toHaveBeenCalledWith(0);
      expect(mockRepositoryInstance.saveAccount).toHaveBeenCalledTimes(1);
    });

    it('should send SUCCESS response for successful creation', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/response', // Should be converted to HTTP in local environment
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': '',
            'Content-Length': expect.any(String),
          }),
          body: expect.stringContaining('"Status":"SUCCESS"'),
        })
      );
    });
  });

  describe('Update event handling', () => {
    it('should create funding source account for Update events', async () => {
      const event = {
        RequestType: 'Update' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(mockRepositoryInstance.saveAccount).toHaveBeenCalledTimes(1);
      expect(MockedAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'FUNDING_SOURCE',
          accountNumber: '0000000000',
        })
      );
    });
  });

  describe('Delete event handling', () => {
    it('should skip account creation for Delete events', async () => {
      const event = {
        RequestType: 'Delete' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      await testHandler(event, mockContext);

      expect(mockRepositoryInstance.saveAccount).not.toHaveBeenCalled();
      expect(MockedAccount).not.toHaveBeenCalled();
    });

    it('should send SUCCESS response for Delete events', async () => {
      const event = {
        RequestType: 'Delete' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      await testHandler(event, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/response', // Should be converted to HTTP in local environment
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"Status":"SUCCESS"'),
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should send FAILED response when repository throws error', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      const repositoryError = new Error('DynamoDB connection failed');
      mockRepositoryInstance.saveAccount.mockRejectedValueOnce(repositoryError);

      await testHandler(event, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/response', // Should be converted to HTTP in local environment
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"Status":"FAILED"'),
        })
      );
    });

    it('should handle fetch errors gracefully', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Should complete without throwing, but will log the error
      await expect(testHandler(event, mockContext)).resolves.not.toThrow();
    });

    it('should handle fetch response errors gracefully', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // Should complete without throwing, but will log the error
      await expect(testHandler(event, mockContext)).resolves.not.toThrow();
    });
  });

  describe('HTTP/HTTPS URL handling', () => {
    it('should use HTTP for local development with localhost endpoint', async () => {
      process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';

      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/response', // Should convert HTTPS to HTTP
        expect.any(Object)
      );
    });

    it('should use HTTP for local development with 127.0.0.1 endpoint', async () => {
      process.env.AWS_ENDPOINT_URL = 'http://127.0.0.1:4566';

      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/response', // Should convert HTTPS to HTTP
        expect.any(Object)
      );
    });

    it('should use HTTP for development environment', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.AWS_ENDPOINT_URL;

      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/response', // Should convert HTTPS to HTTP
        expect.any(Object)
      );
    });

    it('should preserve HTTPS for production environment', async () => {
      delete process.env.AWS_ENDPOINT_URL;
      process.env.NODE_ENV = 'production';

      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/response', // Should preserve HTTPS
        expect.any(Object)
      );
    });

    it('should not modify HTTP URLs', async () => {
      process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';

      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'http://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/response', // Should remain HTTP
        expect.any(Object)
      );
    });
  });

  describe('CloudFormation response format', () => {
    it('should include all required CloudFormation response fields', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack-id',
        RequestId: 'test-request-id',
        LogicalResourceId: 'test-logical-resource-id',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      const fetchCall = mockFetch.mock.calls[0];
      const responseBody = fetchCall[1].body;
      const parsedResponse = JSON.parse(responseBody);

      expect(parsedResponse).toEqual({
        Status: 'SUCCESS',
        Reason: `See the details in CloudWatch Log Stream: ${mockContext.logStreamName}`,
        PhysicalResourceId: 'FundingSourceSeed',
        StackId: 'test-stack-id',
        RequestId: 'test-request-id',
        LogicalResourceId: 'test-logical-resource-id',
        Data: {},
      });
    });

    it('should include correct Content-Length header', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      const fetchCall = mockFetch.mock.calls[0];
      const responseBody = fetchCall[1].body;
      const expectedLength = responseBody.length.toString();

      expect(fetchCall[1].headers['Content-Length']).toBe(expectedLength);
    });
  });

  describe('Environment variable handling', () => {
    it('should handle missing TABLE environment variable', async () => {
      delete process.env.TABLE;

      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      await testHandler(event, mockContext);

      // The script uses a default table name, so it should still succeed
      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/response',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"Status":"SUCCESS"'),
        })
      );
    });

    it('should use default region when AWS_REGION is not set', async () => {
      delete process.env.AWS_REGION;

      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://example.com/response',
        StackId: 'test-stack',
        RequestId: 'test-request',
        LogicalResourceId: 'test-resource',
        ResourceType: 'Custom::Seed',
        ResourceProperties: {},
      };

      mockRepositoryInstance.saveAccount.mockResolvedValueOnce({} as any);

      await testHandler(event, mockContext);

      expect(MockedDynamoBankingRepository).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'eu-west-1', // default fallback
        })
      );
    });
  });
});
