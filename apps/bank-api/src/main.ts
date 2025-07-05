import { createLambdaHandler } from '@ts-rest/serverless/aws';
import type { Handler } from 'aws-lambda';
import { bankApiContract } from '@demo-blue/shared-bank-api-contract';
import {
  UserAlreadyExistsError,
  UserNotFoundError,
  InvalidUserNameError,
} from '@demo-blue/auth';
import { signUpHandler, signInHandler } from './auth';
import {
  toUserAlreadyExistsError,
  toUserNotFoundError,
  toValidationError,
  toInternalServerError,
} from './errors';

export const handler: Handler = createLambdaHandler(
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

    signUp: signUpHandler,
    signIn: signInHandler,
  },
  {
    cors: {
      origin: true,
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
    errorHandler: error => {
      if (error instanceof UserAlreadyExistsError) {
        return toUserAlreadyExistsError(error);
      }

      if (error instanceof UserNotFoundError) {
        return toUserNotFoundError(error);
      }

      if (
        error instanceof InvalidUserNameError ||
        (error as { name: string })?.name === 'RequestValidationError'
      ) {
        return toValidationError(error);
      }

      return toInternalServerError();
    },
  }
);
