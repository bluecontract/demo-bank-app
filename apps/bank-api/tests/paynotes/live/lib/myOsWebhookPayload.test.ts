import { describe, expect, it } from 'vitest';
import { toMyOsWebhookPayload } from './myOsWebhookPayload';

describe('toMyOsWebhookPayload', () => {
  it('compacts emitted Blue nodes to the same shape bank receives from real MyOS webhooks', () => {
    const rawPayload = {
      id: 'event-1',
      type: 'DOCUMENT_EPOCH_ADVANCED',
      object: {
        sessionId: 'session-1',
        epoch: 0,
        emitted: [
          {
            description: 'The event payload to enqueue (any Blue node).',
            type: {
              name: 'Customer Action Requested',
              blueId: '6ZLHE59mb1ytEjW78jmYCU3DXxj4Fzfjea7tz3VEkwyX',
            },
            requestId: {
              value: 'install-confirmation',
            },
            actions: {
              items: [
                {
                  label: {
                    value: 'Installation confirmed',
                  },
                },
              ],
            },
            message: {
              value:
                'Confirm the installation to capture the authorized payment.',
            },
            title: {
              value: 'Confirm installation',
            },
          },
        ],
      },
    };

    expect(rawPayload.object.emitted[0].type).toEqual({
      name: 'Customer Action Requested',
      blueId: '6ZLHE59mb1ytEjW78jmYCU3DXxj4Fzfjea7tz3VEkwyX',
    });

    const webhookPayload = toMyOsWebhookPayload(rawPayload) as {
      id: string;
      object: {
        emitted: unknown[];
      };
    };

    expect(webhookPayload.id).toBe('event-1');
    expect(webhookPayload.object.emitted[0]).toEqual(
      expect.objectContaining({
        type: {
          blueId: '6ZLHE59mb1ytEjW78jmYCU3DXxj4Fzfjea7tz3VEkwyX',
        },
      })
    );
  });
});
