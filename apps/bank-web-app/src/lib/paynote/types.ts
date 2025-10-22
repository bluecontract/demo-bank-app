export interface PayNoteContent {
  name?: string;
  description?: string;
  status?: {
    description?: string;
    type?: string;
    value?: string;
  };
  currency?: {
    description?: string;
    type?: string;
    value?: string;
  };
  amount?: {
    description?: string;
    total?: {
      description?: string;
      type?: string;
      value?: number;
    };
    reserved?: {
      description?: string;
      type?: string;
      value?: number;
    };
    captured?: {
      description?: string;
      type?: string;
      value?: number;
    };
  };
  payerAccountNumber: {
    value: string;
  };
  payeeAccountNumber: {
    value: string;
  };
  payNoteInitialStateDescription?: {
    summary?: string;
    details?: string;
  };
  contracts?: Record<string, unknown>;
}

export interface TransferFormData {
  fromAccount?: string;
  totalAmount?: string;
  recipientName?: string;
  toAccount?: string;
  title?: string;
  date?: string;
  payNoteCode?: string;
  isPayNoteEnabled?: boolean;
}

export interface PayNoteValidationResult {
  validationScore: number;
  explanation: string;
}
