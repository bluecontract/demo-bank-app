import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

export type WebhookQueuePollerOptions = {
  queueUrl: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export class WebhookQueuePoller {
  private readonly client: SQSClient;

  constructor(private readonly options: WebhookQueuePollerOptions) {
    this.client = new SQSClient({
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
      },
    });
  }

  async pollEventIdsOnce() {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.options.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 5,
      })
    );

    const messages = response.Messages ?? [];
    const parsed = messages.flatMap(message => {
      if (!message.Body) return [];
      try {
        const body = JSON.parse(message.Body);
        const eventId = body.id || body.eventId || body.detail?.id;
        if (!eventId) return [];
        return [
          { eventId: String(eventId), receiptHandle: message.ReceiptHandle },
        ];
      } catch {
        return [];
      }
    });

    return parsed;
  }

  async ack(receiptHandle: string) {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.options.queueUrl,
        ReceiptHandle: receiptHandle,
      })
    );
  }
}
