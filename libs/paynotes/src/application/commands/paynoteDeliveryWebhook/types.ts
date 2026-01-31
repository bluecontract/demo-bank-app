import type { BankingRepository, HoldRepository } from '@demo-bank-app/banking';
import type { ContractRepository } from '@demo-bank-app/contracts';
import type {
  ClockPort,
  LogEntry,
  MyOsClient,
  PayNoteDeliveryRepository,
} from '../../ports';

export interface HandlePayNoteDeliveryWebhookInput {
  payload: unknown;
  eventId?: string;
}

export interface HandlePayNoteDeliveryWebhookDependencies {
  myOsClient: MyOsClient;
  payNoteDeliveryRepository: PayNoteDeliveryRepository;
  contractRepository: ContractRepository;
  bankingRepository: BankingRepository;
  holdRepository: HoldRepository;
  clock: ClockPort;
}

export interface HandlePayNoteDeliveryWebhookResult {
  handled: boolean;
  note?: string;
  logs: LogEntry[];
}

export type WebhookEventObject = {
  sessionId?: string;
  document?: unknown;
  emitted?: unknown[];
  triggeredBy?: unknown;
  created?: string;
  epoch?: number;
};

export type WebhookPayload = {
  id?: string;
  type?: string;
  object?: WebhookEventObject;
};
