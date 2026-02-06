import type { HoldRepository } from '@demo-bank-app/banking';
import type { ContractRepository } from '@demo-bank-app/contracts';
import type {
  BankingFacade,
  ClockPort,
  BootstrapContextRepository,
  LogEntry,
  MyOsClient,
  PayNoteDeliveryRepository,
  PayNoteRepository,
} from '../../ports';

export interface HandleWebhookEventInput {
  eventId: string;
  eventPayload?: unknown;
}

export interface HandleWebhookEventDependencies {
  myOsClient: MyOsClient;
  bankingFacade: BankingFacade;
  holdRepository: HoldRepository;
  payNoteRepository: PayNoteRepository;
  payNoteDeliveryRepository: PayNoteDeliveryRepository;
  bootstrapContextRepository: BootstrapContextRepository;
  contractRepository: ContractRepository;
  clock: ClockPort;
}

export interface HandleWebhookEventResult {
  note?: string;
  logs: LogEntry[];
}

export type WebhookEmittedEvent = {
  type?: unknown;
  amount?: { value?: number };
  cardTransactionDetails?: unknown;
};

export type WebhookEventObject = {
  sessionId?: string;
  document?: unknown;
  emitted?: WebhookEmittedEvent[];
  triggeredBy?: unknown;
};

export type WebhookEventPayload = {
  type?: string;
  object?: WebhookEventObject;
};

export type WebhookContext = {
  eventPayload: WebhookEventPayload;
  eventObject?: WebhookEventObject;
  eventType?: string;
  document: Record<string, unknown>;
  emittedEvents?: WebhookEmittedEvent[];
  events: WebhookEmittedEvent[];
  sessionId: string;
};
