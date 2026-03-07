import { describe, expect, it } from 'vitest';
import {
  buildTouchPollingMarkerUpdateInput,
  mapPollingMarkerItem,
} from './pollingMarker';

describe('pollingMarker', () => {
  it('builds touch update input with expected marker fields', () => {
    const updateInput = buildTouchPollingMarkerUpdateInput({
      tableName: 'test-table',
      userPk: 'USER#user-1',
      markerSk: 'POLL_MARKER#CONTRACTS',
      markerEntityType: 'CONTRACT_POLL_MARKER',
      latestUpdatedAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-03T00:00:00.000Z',
    });

    expect(updateInput).toEqual({
      TableName: 'test-table',
      Key: {
        PK: 'USER#user-1',
        SK: 'POLL_MARKER#CONTRACTS',
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
        ':entityType': 'CONTRACT_POLL_MARKER',
        ':latestUpdatedAt': '2024-01-02T00:00:00.000Z',
        ':updatedAt': '2024-01-03T00:00:00.000Z',
      },
    });
  });

  it('maps polling marker item with defaults when missing', () => {
    expect(mapPollingMarkerItem(undefined)).toEqual({ revision: 0 });
  });

  it('maps polling marker item values when valid', () => {
    expect(
      mapPollingMarkerItem({
        revision: 7,
        latestUpdatedAt: '2024-01-04T00:00:00.000Z',
      })
    ).toEqual({
      revision: 7,
      latestUpdatedAt: '2024-01-04T00:00:00.000Z',
    });
  });

  it('falls back to defaults for invalid marker item values', () => {
    expect(
      mapPollingMarkerItem({
        revision: -1,
        latestUpdatedAt: 42,
      })
    ).toEqual({ revision: 0 });
  });
});
