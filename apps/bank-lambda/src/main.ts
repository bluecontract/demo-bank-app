import { createLambdaHandler } from '@ts-rest/serverless/aws';
import { bankApiContract } from '@demo-blue/api-contract';

// Create the handler using ts-rest/serverless/aws
export const handler: unknown = createLambdaHandler(bankApiContract, {
  health: async () => {
    return {
      status: 200,
      body: {
        status: 'healthy' as const,
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
      },
    };
  },
});
