import {
  listAccountActivity,
  AccountNotFoundError,
  InvalidActivityCursorError,
  type ActivityItem,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import {
  bankApiContract,
  coerceBooleanQueryParam,
} from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';

type PollingCursorPayload = {
  revision: number;
  latestUpdatedAt?: string;
};

type PollingMarker = {
  revision: number;
  latestUpdatedAt?: string;
};

const normalizeCursorPayload = (
  payload: PollingCursorPayload
): PollingCursorPayload => ({
  revision: payload.revision,
  latestUpdatedAt: payload.latestUpdatedAt,
});

export const encodePollingCursor = (payload: PollingCursorPayload): string => {
  const normalized = normalizeCursorPayload(payload);
  return Buffer.from(JSON.stringify(normalized)).toString('base64url');
};

export const decodePollingCursor = (
  cursor?: string
): PollingCursorPayload | null => {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as Partial<PollingCursorPayload>;
    if (!decoded || typeof decoded !== 'object') {
      throw new Error('Cursor payload must be an object');
    }
    if (
      decoded.latestUpdatedAt !== undefined &&
      typeof decoded.latestUpdatedAt !== 'string'
    ) {
      throw new Error('Cursor latestUpdatedAt must be a string');
    }
    if (!Number.isInteger(decoded.revision) || (decoded.revision ?? 0) < 0) {
      throw new Error('Cursor revision must be a non-negative integer');
    }
    if (decoded.revision === undefined) {
      throw new Error('Cursor revision is required');
    }

    return normalizeCursorPayload({
      revision: decoded.revision,
      latestUpdatedAt: decoded.latestUpdatedAt,
    });
  } catch {
    throw new Error('Invalid polling cursor');
  }
};

type PollingDiff = {
  cursor: string;
  changed: boolean;
  latestUpdatedAt?: string;
};

export const computePollingDiff = (
  marker: PollingMarker,
  cursor?: string
): PollingDiff => {
  const normalizedMarker: PollingCursorPayload = {
    revision:
      Number.isInteger(marker.revision) && marker.revision >= 0
        ? marker.revision
        : 0,
    latestUpdatedAt: marker.latestUpdatedAt,
  };
  const nextCursor = encodePollingCursor(normalizedMarker);
  const previousCursor = decodePollingCursor(cursor);

  if (!previousCursor) {
    return {
      cursor: nextCursor,
      changed: false,
      latestUpdatedAt: normalizedMarker.latestUpdatedAt,
    };
  }

  const changed =
    previousCursor.revision !== normalizedMarker.revision ||
    previousCursor.latestUpdatedAt !== normalizedMarker.latestUpdatedAt;

  if (!changed) {
    return {
      cursor: nextCursor,
      changed: false,
      latestUpdatedAt: normalizedMarker.latestUpdatedAt,
    };
  }

  return {
    cursor: nextCursor,
    changed: true,
    latestUpdatedAt: normalizedMarker.latestUpdatedAt,
  };
};

const getActivityUpdatedAt = (item: ActivityItem): string => {
  switch (item.kind) {
    case 'POSTED_TRANSACTION':
      return item.postedAt;
    case 'HOLD_CREATED':
      return item.createdAt;
    case 'HOLD_RELEASED':
      return item.releasedAt;
    case 'HOLD_CAPTURED':
      return item.capturedAt;
    case 'HOLD_FAILED':
      return item.failedAt;
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
};

export const pollChangesHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['pollChanges']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const {
    logger,
    contractRepository,
    payNoteDeliveryRepository,
    bankingRepository,
    holdRepository,
  } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const includeContracts = coerceBooleanQueryParam(
    request.query?.includeContracts,
    true
  ) as boolean;
  const includeProposals = coerceBooleanQueryParam(
    request.query?.includeProposals,
    true
  ) as boolean;
  const includeActivity = coerceBooleanQueryParam(
    request.query?.includeActivity,
    false
  ) as boolean;
  const activityAccountNumber = request.query?.activityAccountNumber;
  const serverTime = new Date().toISOString();
  const invalidCursorResponse = (cursorName: string) =>
    problemResponse({
      status: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `${cursorName} is invalid.`,
    });

  if (includeActivity && !activityAccountNumber) {
    return problemResponse({
      status: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message:
        'activityAccountNumber is required when includeActivity is enabled.',
    });
  }

  logger.debug('Polling for lightweight updates', {
    userId,
    includeContracts,
    includeProposals,
    includeActivity,
    hasActivityAccountNumber: Boolean(activityAccountNumber),
  });

  const body: {
    serverTime: string;
    contracts?: {
      cursor: string;
      changed: boolean;
      latestUpdatedAt?: string;
    };
    proposals?: {
      cursor: string;
      changed: boolean;
      latestUpdatedAt?: string;
    };
    activity?: {
      accountNumber: string;
      cursor: string;
      changed: boolean;
      latestActivityAt?: string;
    };
  } = { serverTime };

  if (includeContracts) {
    const marker = await contractRepository.getContractPollingMarkerByUserId(
      userId
    );
    let diff: PollingDiff;
    try {
      diff = computePollingDiff(marker, request.query?.contractsCursor);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Invalid polling cursor'
      ) {
        return invalidCursorResponse('contractsCursor');
      }
      throw error;
    }

    body.contracts = {
      cursor: diff.cursor,
      changed: diff.changed,
      ...(diff.latestUpdatedAt
        ? { latestUpdatedAt: diff.latestUpdatedAt }
        : {}),
    };
  }

  if (includeProposals) {
    const marker =
      await payNoteDeliveryRepository.getDeliveryPollingMarkerByUserId(userId);
    let diff: PollingDiff;
    try {
      diff = computePollingDiff(marker, request.query?.proposalsCursor);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Invalid polling cursor'
      ) {
        return invalidCursorResponse('proposalsCursor');
      }
      throw error;
    }

    body.proposals = {
      cursor: diff.cursor,
      changed: diff.changed,
      ...(diff.latestUpdatedAt
        ? { latestUpdatedAt: diff.latestUpdatedAt }
        : {}),
    };
  }

  if (includeActivity && activityAccountNumber) {
    try {
      const activity = await listAccountActivity(
        {
          userId,
          accountNumber: activityAccountNumber,
          limit: 1,
        },
        {
          bankingRepository,
          holdRepository,
          logger,
        }
      );

      const latestActivityAt =
        activity.items.length > 0
          ? getActivityUpdatedAt(activity.items[0])
          : undefined;
      const marker: PollingMarker = {
        revision: latestActivityAt ? 1 : 0,
        ...(latestActivityAt ? { latestUpdatedAt: latestActivityAt } : {}),
      };
      let diff: PollingDiff;
      try {
        diff = computePollingDiff(marker, request.query?.activityCursor);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Invalid polling cursor'
        ) {
          return invalidCursorResponse('activityCursor');
        }
        throw error;
      }

      body.activity = {
        accountNumber: activityAccountNumber,
        cursor: diff.cursor,
        changed: diff.changed,
        ...(diff.latestUpdatedAt
          ? { latestActivityAt: diff.latestUpdatedAt }
          : {}),
      };
    } catch (error) {
      if (error instanceof AccountNotFoundError) {
        return problemResponse({
          status: 404,
          code: ERROR_CODES.ACCOUNT_NOT_FOUND,
          message: error.message,
        });
      }

      if (error instanceof InvalidActivityCursorError) {
        return problemResponse({
          status: 400,
          code: ERROR_CODES.VALIDATION_ERROR,
          message: error.message,
        });
      }

      throw error;
    }
  }

  return {
    status: 200 as const,
    body,
  };
};
