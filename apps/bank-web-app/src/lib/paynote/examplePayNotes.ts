export interface ExamplePayNoteTemplateField {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
}

export interface ExamplePayNote {
  id: string;
  name: string;
  description: string;
  yaml: string;
  templateFields?: ExamplePayNoteTemplateField[];
  encoded: string;
}

export type ExamplePayNoteDefinition = Omit<ExamplePayNote, 'encoded'>;

const TEMPLATE_TOKEN_REGEX = /{{\s*([A-Z0-9_.-]+)\s*}}/gi;

export function getDefaultTemplateValues(
  example: ExamplePayNoteDefinition | ExamplePayNote
): Record<string, string> {
  return (example.templateFields ?? []).reduce<Record<string, string>>(
    (acc, field) => {
      acc[field.key] = field.defaultValue ?? '';
      return acc;
    },
    {}
  );
}

export function renderExamplePayNote(
  example: ExamplePayNoteDefinition | ExamplePayNote,
  overrides: Record<string, string> = {}
): { yaml: string; encoded: string } {
  const defaults = getDefaultTemplateValues(example);
  const values = { ...defaults, ...overrides };
  const yaml = example.yaml.replace(TEMPLATE_TOKEN_REGEX, (_, token) => {
    return Object.prototype.hasOwnProperty.call(values, token)
      ? values[token]
      : '';
  });

  return {
    yaml,
    encoded: btoa(yaml),
  };
}

const ONE_TIME_PAYMENT_YAML = `name: One time payment
type: PayNote
currency: USD
amount:
  total: 25000 # $250

contracts:
  payerChannel:
    type: MyOS Timeline Channel
  payeeChannel:
    type: MyOS Timeline Channel
  guarantorChannel:
    type: MyOS Timeline Channel
  initLifecycleChannel:
    type: Lifecycle Event Channel
    event:
      type: Document Processing Initiated
  bootstrap:
    type: Sequential Workflow
    channel: initLifecycleChannel
    steps:
      - type: Trigger Event
        event:
          type: Reserve Funds and Capture Immediately Requested
          amount: 25000

payNoteInitialStateDescription:
  summary: |
    ## You are about to send a one-time payment of $250.00.
    Once you approve, we'll immediately send $250.00 to the recipient.
`;

const ESCROW_PAYMENT_YAML = `name: Escrow Payment for Shipment
type: PayNote
currency: USD
amount:
  total: 12000 # $120

contracts:
  payerChannel:
    type: MyOS Timeline Channel
  payeeChannel:
    type: MyOS Timeline Channel
  guarantorChannel:
    type: MyOS Timeline Channel
  shipmentCompanyChannel:
    type: MyOS Timeline Channel
    email: '{{SHIPMENT_COMPANY_EMAIL}}'

  initLifecycleChannel:
    type: Lifecycle Event Channel
    event:
      type: Document Processing Initiated
  bootstrap:
    type: Sequential Workflow
    channel: initLifecycleChannel
    steps:
      - type: Trigger Event
        event:
          type: Reserve Funds Requested
          amount: 12000

  shipmentConfirmed:
    type: Operation
    description: Must be called by the Shipment Company to confirm delivery and trigger payment capture.
    channel: shipmentCompanyChannel
  shipmentConfirmedImpl:
    type: Sequential Workflow Operation
    operation: shipmentConfirmed
    steps:
      - name: RequestFinalCapture
        type: Trigger Event
        event:
          type: Capture Funds Requested
          amount: 12000

payNoteInitialStateDescription:
  summary: |
    This is a protected payment of **$120.00**. The funds are held securely by your bank and will only be released to the Merchant after **Shipment Company confirms successful delivery**.
  details: |
    This PayNote acts as a secure escrow to protect the Payer. The payment is guaranteed, but the final transfer is conditional on a confirmation from the shipping company.
    #### Participants
    * **Payer**: The Customer (sender of funds)
    * **Payee**: The Merchant (recipient of funds)
    * **Guarantor**: The Bank (holds the funds in escrow)
    * **Shipment Company**: The Shipment Company (provides delivery confirmation)
    #### Operations
    * **\`shipmentConfirmed\`** (Callable by: **Shipment Company**)
        * This action is performed by DHL to certify that the delivery is complete. This is the trigger that releases the payment to the Merchant.
    #### Scenarios
    1.  **Payment and Delivery:**
        * The Payer initiates the payment, and the Bank immediately reserves (holds) the $120.00.
        * Shipment Company delivers the package to the Payer.
        * Shipment Company then calls the \`shipmentConfirmed\` operation on this document.
        * This automatically authorizes the Bank to transfer the $120.00 to the Merchant. The process is complete.
    2.  **Shipment Issue:**
        * If the shipment is never confirmed by Shipment Company, the funds remain reserved. The Payer can then initiate a cancellation to have the funds released back to their account.
`;

const exampleDefinitions: ExamplePayNoteDefinition[] = [
  {
    id: 'one-time-payment',
    name: 'One Time Payment',
    description: 'Immediate single payment of $250.00 to a recipient.',
    yaml: ONE_TIME_PAYMENT_YAML,
  },
  {
    id: 'escrow-payment',
    name: 'Escrow Payment for Shipment',
    description:
      'Escrow that reserves $120.00 and releases funds once shipment is confirmed.',
    yaml: ESCROW_PAYMENT_YAML,
    templateFields: [
      {
        key: 'SHIPMENT_COMPANY_EMAIL',
        label: 'Schipment Company Email',
        description:
          'Email address for the shipment provider receiving PayNote events.',
        placeholder: 'e.g. shipmentcorp@bluecontract.com',
        defaultValue: 'shipmentcorp@bluecontract.com',
      },
    ],
  },
];

export const examplePayNotes: ExamplePayNote[] = exampleDefinitions.map(
  definition => ({
    ...definition,
    encoded: renderExamplePayNote(definition).encoded,
  })
);
