import type {
  BankingFacade,
  ReserveFundsRequest,
  TransferFundsRequest,
  CaptureHoldRequest,
} from '../application/ports';
import {
  Money,
  transferMoney,
  reserveFunds,
  captureHold,
  partialCaptureHold,
} from '@demo-bank-app/banking';
import type { BankingRepository, HoldRepository } from '@demo-bank-app/banking';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';

interface BankingFacadeDependencies {
  bankingRepository: BankingRepository;
  holdRepository: HoldRepository;
  logger: PowertoolsLogger;
  resolveMerchantOwnerUserId?: (
    merchantId: string
  ) => Promise<string | undefined>;
}

const mapMoney = (amountMinor: number) => new Money(amountMinor);

const isAccountActive = (account: {
  status?: string;
  isActive?: () => boolean;
}): boolean => {
  if (typeof account.isActive === 'function') {
    try {
      return account.isActive();
    } catch {
      return false;
    }
  }
  return account.status === 'ACTIVE';
};

const buildTransferRequest = (request: TransferFundsRequest) => ({
  srcAccountId: request.sourceAccountId,
  dstAccountNumber: request.destinationAccountNumber,
  amountMinor: mapMoney(request.amountMinor),
  description: request.description,
  ctx: {
    userId: request.userId,
    idempotencyKey: request.idempotencyKey,
  },
  payNoteDocumentId: request.payNoteDocumentId,
});

const buildReserveRequest = (request: ReserveFundsRequest) => ({
  userId: request.userId,
  idempotencyKey: request.idempotencyKey,
  holdId: request.holdId,
  payerAccountNumber: request.payerAccountNumber,
  amountMinor: request.amountMinor,
  description: request.description,
  counterpartyAccountNumber: request.counterpartyAccountNumber,
  payNoteDocumentId: request.payNoteDocumentId,
});

const buildCaptureRequest = (request: CaptureHoldRequest) => ({
  holdId: request.holdId,
  userId: request.userId,
  idempotencyKey: request.idempotencyKey,
  counterpartyAccountNumber: request.counterpartyAccountNumber,
  payNoteDocumentId: request.payNoteDocumentId,
});

const buildPartialCaptureRequest = (
  request: CaptureHoldRequest & { amountMinor: number }
) => ({
  holdId: request.holdId,
  userId: request.userId,
  idempotencyKey: request.idempotencyKey,
  amountMinor: request.amountMinor,
  counterpartyAccountNumber: request.counterpartyAccountNumber,
  payNoteDocumentId: request.payNoteDocumentId,
});

export const createBankingFacade = (
  deps: BankingFacadeDependencies
): BankingFacade => {
  const resolveActiveCreditLineAccountByUserId = async (
    userId: string
  ): Promise<{
    id: string;
    accountNumber: string;
    ownerUserId?: string;
  } | null> => {
    const accounts = await deps.bankingRepository.getAccountsByUserId(userId);
    const activeCreditLine = accounts.find(
      account =>
        account.accountType === 'CREDIT_LINE' && isAccountActive(account)
    );
    if (!activeCreditLine) {
      return null;
    }

    const ownerUserId = (activeCreditLine as { ownerUserId?: string })
      .ownerUserId;

    return {
      id: activeCreditLine.id,
      accountNumber: activeCreditLine.accountNumber,
      ownerUserId,
    };
  };

  return {
    async getAccountByNumber(accountNumber) {
      const accountId = await deps.bankingRepository.getAccountIdByNumber(
        accountNumber
      );
      if (!accountId) {
        return null;
      }

      const account = await deps.bankingRepository.getAccountById(accountId);
      if (!account) {
        return null;
      }

      const ownerUserId = (account as { ownerUserId?: string }).ownerUserId;

      return {
        id: account.id,
        accountNumber: account.accountNumber,
        ownerUserId,
      };
    },

    async getAccountForUser(accountNumber, userId) {
      const accountId = await deps.bankingRepository.getAccountIdByNumber(
        accountNumber
      );
      if (!accountId) {
        return null;
      }

      const account = await deps.bankingRepository.getAccountById(accountId);
      if (
        !account ||
        typeof account.isOwnedBy !== 'function' ||
        !account.isOwnedBy(userId)
      ) {
        return null;
      }

      const ownerUserId = (account as { ownerUserId?: string }).ownerUserId;

      return {
        id: account.id,
        accountNumber: account.accountNumber,
        ownerUserId,
      };
    },

    async getActiveCreditLineAccountByMerchantId(merchantId) {
      if (typeof deps.resolveMerchantOwnerUserId !== 'function') {
        return null;
      }

      const ownerUserId = await deps.resolveMerchantOwnerUserId(merchantId);
      if (!ownerUserId) {
        return null;
      }

      return resolveActiveCreditLineAccountByUserId(ownerUserId);
    },

    async transferFunds(request) {
      await transferMoney(buildTransferRequest(request), {
        repository: deps.bankingRepository,
        logger: deps.logger,
      });
    },

    async reserveFunds(request) {
      await reserveFunds(buildReserveRequest(request), {
        bankingRepository: deps.bankingRepository,
        holdRepository: deps.holdRepository,
        logger: deps.logger,
      });
    },

    async captureHold(request) {
      if (typeof request.amountMinor === 'number') {
        const requestWithAmount = request as CaptureHoldRequest & {
          amountMinor: number;
        };
        const partialResult = await partialCaptureHold(
          buildPartialCaptureRequest(requestWithAmount),
          {
            bankingRepository: deps.bankingRepository,
            holdRepository: deps.holdRepository,
            logger: deps.logger,
          }
        );
        return partialResult.hold;
      }

      return captureHold(buildCaptureRequest(request), {
        bankingRepository: deps.bankingRepository,
        holdRepository: deps.holdRepository,
        logger: deps.logger,
      });
    },
  };
};
