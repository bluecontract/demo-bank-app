import {
  getActiveMonitoringSubscriptions,
  type ContractRecord,
  type ContractRepository,
} from '@demo-bank-app/contracts';
import { runGuarantorUpdate, type MyOsClient } from '@demo-bank-app/paynotes';
import { mergeUniqueStrings } from '../shared/mergeUniqueStrings';

const markSubscriptionReportDelivered = (input: {
  contract: ContractRecord;
  subscriptionId: string;
  reportTransactionId: string;
  updatedAt: string;
}): ContractRecord => {
  const { contract, subscriptionId, reportTransactionId, updatedAt } = input;
  const subscriptions = contract.monitoringSubscriptions ?? [];
  return {
    ...contract,
    monitoringSubscriptions: subscriptions.map(subscription => {
      if (subscription.subscriptionId !== subscriptionId) {
        return subscription;
      }
      return {
        ...subscription,
        reportedTransactionIds: mergeUniqueStrings(
          subscription.reportedTransactionIds,
          [reportTransactionId]
        ),
        updatedAt,
      };
    }),
  };
};

export const reportCardTransactionToMonitoringSubscribers = async (input: {
  contractRepository: ContractRepository;
  myOsClient: MyOsClient;
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
  userId: string;
  merchantId: string;
  reportEvent: Record<string, unknown>;
  reportTransactionId: string;
  relatedHoldId?: string;
  relatedTransactionId?: string;
}): Promise<void> => {
  const {
    contractRepository,
    myOsClient,
    logger,
    userId,
    merchantId,
    reportEvent,
    reportTransactionId,
    relatedHoldId,
    relatedTransactionId,
  } = input;

  const credentials = await myOsClient.getCredentials();
  const summaries = await contractRepository.listContractsByUserId(userId);

  for (const summary of summaries) {
    const contract = await contractRepository.getContract(summary.contractId);
    if (!contract?.sessionId) {
      continue;
    }

    const subscriptions = getActiveMonitoringSubscriptions(
      contract,
      merchantId
    );
    if (!subscriptions.length) {
      continue;
    }

    let nextContract = contract;
    let hasChanges = false;

    for (const subscription of subscriptions) {
      if (subscription.reportedTransactionIds?.includes(reportTransactionId)) {
        logger.info('Skipped duplicate monitoring report delivery', {
          contractId: contract.contractId,
          sessionId: contract.sessionId,
          subscriptionId: subscription.subscriptionId,
          reportTransactionId,
        });
        continue;
      }

      const logs: Array<{
        level: 'info' | 'warn' | 'error';
        message: string;
        context?: Record<string, unknown>;
      }> = [];
      const emitted = await runGuarantorUpdate({
        myOsClient,
        credentials,
        sessionId: contract.sessionId,
        request: [reportEvent],
        logs,
        logContext: {
          contractId: contract.contractId,
          sessionId: contract.sessionId,
          subscriptionId: subscription.subscriptionId,
          reportTransactionId,
          merchantId,
          userId,
        },
        successMessage:
          'Reported card transaction monitoring event via guarantorUpdate',
        failureMessage:
          'Failed to report card transaction monitoring event via guarantorUpdate',
        missingCredentialsMessage:
          'Failed to report card transaction monitoring event (missing credentials)',
      });

      if (!emitted) {
        const errorLog = logs.find(item => item.level === 'error');
        logger.warn('Monitoring report delivery failed for contract', {
          contractId: contract.contractId,
          sessionId: contract.sessionId,
          subscriptionId: subscription.subscriptionId,
          reportTransactionId,
          reason: errorLog?.message,
        });
        continue;
      }

      const updatedAt = new Date().toISOString();
      nextContract = markSubscriptionReportDelivered({
        contract: nextContract,
        subscriptionId: subscription.subscriptionId,
        reportTransactionId,
        updatedAt,
      });
      nextContract = {
        ...nextContract,
        relatedHoldIds: mergeUniqueStrings(
          nextContract.relatedHoldIds,
          relatedHoldId ? [relatedHoldId] : undefined
        ),
        relatedTransactionIds: mergeUniqueStrings(
          nextContract.relatedTransactionIds,
          relatedTransactionId ? [relatedTransactionId] : undefined
        ),
        updatedAt,
      };
      hasChanges = true;
    }

    if (hasChanges) {
      await contractRepository.saveContract(nextContract);
    }
  }
};
