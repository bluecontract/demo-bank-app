import { describe, expect, it } from 'vitest';
import { classifyPayNoteEvent, dispatchPayNoteEvents } from './eventDispatcher';
import { blue } from '../../../blue';

const toOfficialBlue = <T>(value: T): T =>
  blue.nodeToJson(blue.jsonValueToNode(value), {
    format: 'official',
  }) as T;

describe('paynote event dispatcher', () => {
  it('classifies capture lock request as capture-request', () => {
    const result = classifyPayNoteEvent(
      toOfficialBlue({
        type: 'PayNote/Card Transaction Capture Lock Requested',
      })
    );

    expect(result.decision).toBe('capture-request');
    expect(result.eventType).toBe(
      'PayNote/Card Transaction Capture Lock Requested'
    );
  });

  it('routes supported events and intentionally ignores unsupported events', () => {
    const logs: Array<{
      level: 'info' | 'warn' | 'error';
      message: string;
      context?: Record<string, unknown>;
    }> = [];

    const { captureRequestEvents, transferEvents } = dispatchPayNoteEvents({
      eventId: 'event-1',
      payNoteDocumentId: 'doc-1',
      logs,
      events: [
        toOfficialBlue({
          type: 'PayNote/Card Transaction Capture Lock Requested',
        }),
        toOfficialBlue({
          type: 'PayNote/Capture Funds Requested',
        }),
        toOfficialBlue({
          type: 'Conversation/Document Bootstrap Requested',
        }),
        {
          type: 'PayNote/Future Event Requested',
        },
      ],
    });

    expect(captureRequestEvents).toHaveLength(1);
    expect(transferEvents).toHaveLength(1);

    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message:
          'PayNote emitted event intentionally ignored (Document Bootstrap Requested handled by delivery pipeline)',
        context: expect.objectContaining({
          eventId: 'event-1',
          payNoteDocumentId: 'doc-1',
          eventType: 'Conversation/Document Bootstrap Requested',
        }),
      })
    );

    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message:
          'PayNote emitted event intentionally ignored (unsupported type)',
        context: expect.objectContaining({
          eventId: 'event-1',
          payNoteDocumentId: 'doc-1',
          eventType: 'PayNote/Future Event Requested',
        }),
      })
    );
  });
});
