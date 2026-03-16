import type { ActivityItem } from '../hooks/useActivity';
import type { ActivityDetail } from '../hooks/useActivityDetail';

type HoldDetail = Extract<ActivityDetail, { kind: 'HOLD' }>;

export const getHoldTimelinePayNoteDocumentId = (
  holdDetail: HoldDetail | null | undefined,
  selectedActivity?: ActivityItem | null
) => {
  if (!holdDetail?.timeline) {
    return null;
  }

  const desiredType = (() => {
    switch (selectedActivity?.kind) {
      case 'HOLD_CREATED':
        return 'CREATED';
      case 'HOLD_CAPTURED':
        return 'CAPTURED';
      case 'HOLD_RELEASED':
        return 'RELEASED';
      case 'HOLD_FAILED':
        return 'FAILED';
      default:
        return null;
    }
  })();

  const matchesSelectedActivity = (
    event: (typeof holdDetail.timeline)[number]
  ) => {
    if (!selectedActivity) return false;
    if (event.payNoteDocumentId == null) return false;

    switch (selectedActivity.kind) {
      case 'HOLD_CREATED':
        return event.type === 'CREATED';
      case 'HOLD_CAPTURED':
        return (
          (event.type === 'CAPTURED' || event.type === 'CAPTURED_PARTIAL') &&
          'transactionId' in event &&
          event.transactionId === selectedActivity.transactionId
        );
      case 'HOLD_RELEASED':
        return event.type === 'RELEASED';
      case 'HOLD_FAILED':
        return event.type === 'FAILED';
      default:
        return false;
    }
  };

  if (desiredType) {
    const matchedEvent = holdDetail.timeline.find(matchesSelectedActivity);
    if (matchedEvent?.payNoteDocumentId) {
      return matchedEvent.payNoteDocumentId;
    }
  }

  const createdEventId = holdDetail.timeline.find(
    event => event.type === 'CREATED' && event.payNoteDocumentId
  )?.payNoteDocumentId;
  const fallbackEventId = holdDetail.timeline.find(
    event => event.payNoteDocumentId
  )?.payNoteDocumentId;

  return createdEventId ?? fallbackEventId ?? null;
};
