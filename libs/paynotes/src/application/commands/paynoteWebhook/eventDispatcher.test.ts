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

  it('treats short-form emitted type label as unsupported', () => {
    const event = toOfficialBlue({
      type: 'Conversation/Customer Action Requested',
      requestId: 'customer-action-1',
      title: 'Confirm milestone',
      message: 'Please confirm milestone #1',
      actions: [{ label: 'Accept' }, { label: 'I have a concern' }],
    }) as {
      type?: {
        name?: string;
        value?: string;
      };
    };

    // Simulate MyOS-emitted payload shape where type.name is short-form.
    if (event.type && typeof event.type === 'object') {
      event.type.name = 'Customer Action Requested';
      event.type.value = 'Customer Action Requested';
    }

    const result = classifyPayNoteEvent(event);

    expect(result.decision).toBe('unsupported');
    expect(result.eventType).toBeUndefined();
  });

  it('routes supported events and intentionally ignores unsupported events', () => {
    const logs: Array<{
      level: 'info' | 'warn' | 'error';
      message: string;
      context?: Record<string, unknown>;
    }> = [];

    const {
      captureRequestEvents,
      chargeRequestEvents,
      transferEvents,
      monitoringRequestEvents,
      customerActionRequestEvents,
    } = dispatchPayNoteEvents({
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
          type: 'PayNote/Linked Card Charge Requested',
          amount: 2500,
        }),
        toOfficialBlue({
          type: 'Conversation/Document Bootstrap Requested',
        }),
        toOfficialBlue({
          type: 'PayNote/Start Card Transaction Monitoring Requested',
          targetMerchantId: 'merchant-123',
          events: ['transaction'],
        }),
        toOfficialBlue({
          type: 'Conversation/Customer Action Requested',
          title: 'Confirm milestone',
          message: 'Please confirm milestone #1',
          actions: [{ label: 'Accept' }, { label: 'I have a concern' }],
        }),
        {
          type: 'PayNote/Future Event Requested',
        },
      ],
    });

    expect(captureRequestEvents).toHaveLength(1);
    expect(chargeRequestEvents).toHaveLength(1);
    expect(transferEvents).toHaveLength(1);
    expect(monitoringRequestEvents).toHaveLength(1);
    expect(customerActionRequestEvents).toHaveLength(1);
    expect(chargeRequestEvents[0]).toEqual(
      expect.objectContaining({
        eventType: 'PayNote/Linked Card Charge Requested',
        eventIndex: 2,
        event: expect.any(Object),
      })
    );
    expect(transferEvents[0]).toEqual(
      expect.objectContaining({
        eventType: 'PayNote/Capture Funds Requested',
        eventIndex: 1,
        event: expect.any(Object),
      })
    );
    expect(customerActionRequestEvents[0]).toEqual(
      expect.objectContaining({
        eventType: 'Conversation/Customer Action Requested',
        eventIndex: 5,
        event: expect.any(Object),
      })
    );

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
