type PollingMarkerItem = {
  revision?: unknown;
  latestUpdatedAt?: unknown;
};

export type PollingMarker = {
  revision: number;
  latestUpdatedAt?: string;
};

export const buildTouchPollingMarkerUpdateInput = (input: {
  tableName: string;
  userPk: string;
  markerSk: string;
  markerEntityType: string;
  latestUpdatedAt: string;
  updatedAt?: string;
}) => ({
  TableName: input.tableName,
  Key: {
    PK: input.userPk,
    SK: input.markerSk,
  },
  UpdateExpression:
    'ADD #revision :one SET #entityType = if_not_exists(#entityType, :entityType), #latestUpdatedAt = :latestUpdatedAt, #updatedAt = :updatedAt',
  ExpressionAttributeNames: {
    '#revision': 'revision',
    '#entityType': 'entityType',
    '#latestUpdatedAt': 'latestUpdatedAt',
    '#updatedAt': 'updatedAt',
  },
  ExpressionAttributeValues: {
    ':one': 1,
    ':entityType': input.markerEntityType,
    ':latestUpdatedAt': input.latestUpdatedAt,
    ':updatedAt': input.updatedAt ?? new Date().toISOString(),
  },
});

export const mapPollingMarkerItem = (
  item: PollingMarkerItem | undefined
): PollingMarker => {
  const revisionValue = item?.revision;
  const revision =
    typeof revisionValue === 'number' &&
    Number.isInteger(revisionValue) &&
    revisionValue >= 0
      ? revisionValue
      : 0;
  const latestUpdatedAt =
    typeof item?.latestUpdatedAt === 'string' && item.latestUpdatedAt.length
      ? item.latestUpdatedAt
      : undefined;

  return {
    revision,
    ...(latestUpdatedAt ? { latestUpdatedAt } : {}),
  };
};
