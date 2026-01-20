import { createLambdaHandler, tsr } from '@ts-rest/serverless/aws';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { signUpHandler, signInHandler } from './auth/handlers';

import { createErrorHandler } from './errors';
import {
  createAuthMiddleware,
  MaybeAuthenticatedRequestContext,
} from './auth/middleware';
import { getMetrics } from './shared/metrics';
import { getLogger } from './shared/logger';
import { getSecurityHeaders } from './shared/security';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { createAccountHandler } from './banking/createAccount';
import { listAccountsHandler } from './banking/listAccounts';
import { getAccountHandler } from './banking/getAccount';
import { fundAccountHandler } from './banking/fundAccount';
import { transferMoneyHandler } from './banking/transferMoney';
import { getTransactionHandler } from './banking/getTransaction';
import { listAccountActivityHandler } from './banking/activity';
import { getActivityDetailHandler } from './banking/getActivityDetail';
import { issueCardHandler } from './banking/issueCard';
import { listCardsHandler } from './banking/listCards';
import { getCardHandler } from './banking/getCard';
import { authorizeCardHandler } from './banking/authorizeCard';
import { captureCardAuthorizationHandler } from './banking/captureCardAuthorization';
import { validatePayNoteHandler } from './paynote/validatePayNote';
import { parsePayNotePdfHandler } from './paynote/parsePayNotePdf';
import { bootstrapPayNoteHandler } from './paynote/bootstrapPayNote';
import { payNoteWebhookHandler } from './paynote/webhook';
import { getPayNoteDetailsHandler } from './paynote/getPayNoteDetails';
import { listPayNoteDeliveriesHandler } from './paynote/listPayNoteDeliveries';
import { getPayNoteDeliveryHandler } from './paynote/getPayNoteDelivery';
import { runContractOperationHandler } from './contracts/runContractOperation';

const metrics = getMetrics();
const logger = getLogger();
const securityHeaders = getSecurityHeaders();

// Create the ts-rest handler
export const handler: APIGatewayProxyHandlerV2 = createLambdaHandler(
  bankApiContract,
  tsr.routerWithMiddleware(bankApiContract)<MaybeAuthenticatedRequestContext>({
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

    banking: {
      createAccount: createAccountHandler,
      listAccounts: listAccountsHandler,
      getAccount: getAccountHandler,
      listCards: listCardsHandler,
      issueCard: issueCardHandler,
      getCard: getCardHandler,
      fundAccount: fundAccountHandler,
      transferMoney: transferMoneyHandler,
      listActivity: listAccountActivityHandler,
      getActivityDetail: getActivityDetailHandler,
      getTransaction: getTransactionHandler,
      validatePayNote: validatePayNoteHandler,
      bootstrapPayNote: bootstrapPayNoteHandler,
      parsePayNotePdf: parsePayNotePdfHandler,
      getPayNoteDetails: getPayNoteDetailsHandler,
      payNoteWebhook: payNoteWebhookHandler,
      listPayNoteDeliveries: listPayNoteDeliveriesHandler,
      getPayNoteDelivery: getPayNoteDeliveryHandler,
      runContractOperation: runContractOperationHandler,
      authorizeCard: authorizeCardHandler,
      captureCardAuthorization: captureCardAuthorizationHandler,
    },
  }),
  {
    cors: {
      origin: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'X-Amz-Date',
        'X-Api-Key',
        'X-Amz-Security-Token',
        'Authorization',
        'idempotency-key',
      ],
      credentials: true,
    },
    requestMiddleware: [
      async request => {
        logger.info('Received request', {
          method: request.method,
          path: request.url,
        });
      },
      createAuthMiddleware({
        exclusions: [
          { path: /^\/health\/?$/, method: 'GET' },
          { path: '/auth/signup', method: 'POST' },
          { path: '/auth/signin', method: 'POST' },
          { path: '/v1/paynotes/webhook', method: 'POST' },
          { path: /^\/v1\/card-processor(\/.*)?$/, method: 'POST' },
        ],
      }),
    ],
    errorHandler: createErrorHandler(logger),
    responseHandlers: [
      async response => {
        // Add security headers for all requests
        Object.entries(securityHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
        return response;
      },
      async response => {
        try {
          await metrics.publishStoredMetrics();
          logger.debug('Metrics published successfully');
        } catch (error) {
          logger.error('Failed to publish metrics', { error: String(error) });
        }
        return response;
      },
      async (response, request) => {
        logger.info('Sending response', {
          status: response.status,
          method: request.method,
          path: request.url,
        });
        return response;
      },
    ],
  }
);
