import { randomUUID } from 'crypto';
import {
  Money,
  transferMoney,
  reserveFunds,
  captureHold,
} from '@demo-bank-app/banking';
import type { BankingRepository } from '@demo-bank-app/banking';
import type { HoldRepository } from '@demo-bank-app/banking';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';
import type {
  BankingFacade,
  BlueIdCalculator,
  ClockPort,
  IdGeneratorPort,
  MyOsClient,
  MyOsCredentials,
  MyOsFetchEventResult,
} from '@demo-bank-app/paynotes';
import {
  calculateBlueIdFromObject,
  calculateBlueIdFromYaml,
  toReversedJson,
} from './blueId';

type MyOsCredentialsResolver = () => Promise<MyOsCredentials>;

export const createBlueIdCalculator = (): BlueIdCalculator => ({
  fromYaml: calculateBlueIdFromYaml,
  fromObject: calculateBlueIdFromObject,
  toReversedJson,
});

export const createClock = (): ClockPort => ({
  now: () => new Date(),
});

export const createIdGenerator = (): IdGeneratorPort => ({
  generate: () => randomUUID(),
});

export const createMyOsClient = (
  resolveCredentials: MyOsCredentialsResolver
): MyOsClient => ({
  getCredentials: resolveCredentials,

  async bootstrapDocument({ credentials, payload }) {
    const response = await fetch(`${credentials.baseUrl}/documents/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: credentials.apiKey,
      },
      body: JSON.stringify(payload),
    });

    const body = await response
      .clone()
      .json()
      .catch(() => undefined);

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  },

  async fetchEvent(eventId: string): Promise<MyOsFetchEventResult> {
    try {
      const credentials = await resolveCredentials();
      const response = await fetch(
        `${credentials.baseUrl}/myos-events/${eventId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: credentials.apiKey,
          },
        }
      );

      if (response.status === 404) {
        return { kind: 'not-found', status: 404 };
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => undefined);
        return {
          kind: 'http-error',
          status: response.status,
          statusText: response.statusText,
          detail,
        };
      }

      try {
        const payload = await response.json();
        return { kind: 'success', payload };
      } catch (error) {
        return { kind: 'parse-error', status: response.status, error };
      }
    } catch (error) {
      return { kind: 'network-error', error };
    }
  },
});

export const createBankingFacade = (deps: {
  bankingRepository: BankingRepository;
  holdRepository: HoldRepository;
  logger: PowertoolsLogger;
}): BankingFacade => ({
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

  async transferFunds(request) {
    await transferMoney(
      {
        srcAccountId: request.sourceAccountId,
        dstAccountNumber: request.destinationAccountNumber,
        amountMinor: new Money(request.amountMinor),
        description: request.description,
        ctx: {
          userId: request.userId,
          idempotencyKey: request.idempotencyKey,
        },
        payNoteEventId: request.payNoteEventId,
      },
      {
        repository: deps.bankingRepository,
        logger: deps.logger,
      }
    );
  },

  async reserveFunds(request) {
    await reserveFunds(
      {
        userId: request.userId,
        idempotencyKey: request.idempotencyKey,
        holdId: request.holdId,
        payerAccountNumber: request.payerAccountNumber,
        amountMinor: request.amountMinor,
        counterpartyAccountNumber: request.counterpartyAccountNumber,
        payNoteEventId: request.payNoteEventId,
      },
      {
        bankingRepository: deps.bankingRepository,
        holdRepository: deps.holdRepository,
        logger: deps.logger,
      }
    );
  },

  async captureHold(request) {
    await captureHold(
      {
        holdId: request.holdId,
        userId: request.userId,
        idempotencyKey: request.idempotencyKey,
        counterpartyAccountNumber: request.counterpartyAccountNumber,
        payNoteEventId: request.payNoteEventId,
      },
      {
        bankingRepository: deps.bankingRepository,
        holdRepository: deps.holdRepository,
        logger: deps.logger,
      }
    );
  },
});
