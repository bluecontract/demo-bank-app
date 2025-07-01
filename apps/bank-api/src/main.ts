import { createLambdaHandler } from '@ts-rest/serverless/aws';
import { bankApiContract } from '@demo-blue/bank-api-contract';

// Force deployment trigger - can be removed later
// Create and export the ts-rest handler directly
export const handler = createLambdaHandler(
  bankApiContract,
  {
    health: async () => {
      const healthData = {
        status: 'healthy' as const,
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
      };

      return {
        status: 200,
        body: healthData,
      };
    },
  },
  {
    // CORS configuration - let ts-rest handle CORS
    cors: {
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'X-Amz-Date',
        'Authorization',
        'X-Api-Key',
        'X-Amz-Security-Token',
      ],
      maxAge: 600,
    },
  }
);
