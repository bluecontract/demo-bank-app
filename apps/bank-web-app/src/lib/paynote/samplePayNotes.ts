export const oneTimePaymentPayNote = btoa(`name: One time payment
description: A verifiable instrument for managing a commitment of value between a Payer, Payee, and Guarantor.

# --- Core State Fields ---
status:
  description: The current state of the PayNote (e.g., Pending, Approved, Reserved, Captured, Released, Rejected).
  type: Text
  value: Pending
currency:
  description: The ISO 4217 currency code for the transaction.
  type: Text
  value: USD
amount:
  description: The amounts associated with this PayNote.
  total:
    description: The maximum total value of this PayNote.
    type: Integer
    value: 19800 # $198.00 in cents
  reserved:
    description: The amount currently reserved by the Guarantor.
    type: Integer
    value: 0
  captured:
    description: The amount that has been successfully captured.
    type: Integer
    value: 0

payNoteInitialStateDescription:
  summary: |
    ## You are about to send a one-time payment of $198.00 to Bob Smith.
    Once you approve, we'll immediately send $198.00 to the recipient.

  details: |
    * **Participants:**
      * Payer (You): <alice@xyz.com> (Timeline: aws:123...abc)
      * Recipient: Bob Smith <bob.smith@gmail.com> (Timeline: myos:456...def)
      * Guarantor: Demo Bank

    * **Authorized Actions:**
      * You: authorizePayment

    * **Document Info:**
      * PayNote ID: PN-IMM-1A2B3C

# --- Participants & Contracts ---
contracts:
  payerChannel:
    type: MyOS Timeline
    value: aws:123...abc
  payeeChannel:
    type: MyOS Timeline
    value: myos:456...def
  guarantorChannel:
    type: MyOS Timeline

  bootstrap:
    type: Sequential Workflow
    event:
      type: Document Processing Initiated
    steps:
      - name: RequestImmediatePayment
        type: Trigger Event
        event:
          type: Reserve Funds and Capture Immediately Requested

  authorizePayment:
    type: Operation
    channel: payerChannel
    description: Payer authorizes the immediate payment
`);

export const deliveryPayNote = btoa(`name: Delivery
description: A conditional escrow payment that releases funds only upon confirmed delivery.

# --- Core State Fields ---
status:
  description: The current state of the PayNote (e.g., Pending, Approved, Reserved, Captured, Released, Rejected).
  type: Text
  value: Pending
currency:
  description: The ISO 4217 currency code for the transaction.
  type: Text
  value: USD
amount:
  description: The amounts associated with this PayNote.
  total:
    description: The maximum total value of this PayNote.
    type: Integer
    value: 12000 # $120.00 in cents
  reserved:
    description: The amount currently reserved by the Guarantor.
    type: Integer
    value: 0
  captured:
    description: The amount that has been successfully captured.
    type: Integer
    value: 0

deliveryInfo:
  description: Information about the shipment
  trackingNumber:
    type: Text
    value: XYZ123
  carrier:
    type: Text
    value: DHL
  expirationDays:
    type: Integer
    value: 7
    description: Days until automatic release if no delivery confirmation

payNoteInitialStateDescription:
  summary: |
    ## You are about to send a payment that will release only when delivery is confirmed.
    1) We'll reserve $120 from your account.
    2) Once DHL confirms delivery, we send the payment to Bob Smith.
    3) If there's no delivery confirmation within 7 days, we automatically release the funds back to you.

  details: |
    * **Participants:**
      * Payer (You): <alice@xyz.com> (Timeline: aws:123...abc)
      * Recipient: Bob Smith <bob.smith@gmail.com> (Timeline: myos:456...def)
      * Verifier: DHL <dhl@dhl.com> (Timeline: aws:234...abc)
      * Guarantor: Demo Bank

    * **Authorized Actions:**
      * You: authorizePayment
      * DHL (Verifier): Can post a deliveryConfirmed event for parcel #XYZ123.

    * **Document Info:**
      * PayNote ID: PN-DEL-2B3C4D

# --- Participants & Contracts ---
contracts:
  payerChannel:
    type: MyOS Timeline
    value: aws:123...abc
  payeeChannel:
    type: MyOS Timeline
    value: myos:456...def
  verifierChannel:
    type: MyOS Timeline
    value: aws:234...abc
  guarantorChannel:
    type: MyOS Timeline

  bootstrap:
    type: Sequential Workflow
    event:
      type: Document Processing Initiated
    steps:
      - name: RequestReservation
        type: Trigger Event
        event:
          type: Reserve Funds Requested
          amount: \${document('/amount/total')}

  authorizePayment:
    type: Operation
    channel: payerChannel
    description: Payer authorizes the reservation of funds

  deliveryConfirmed:
    type: Operation
    channel: verifierChannel
    description: Verifier confirms successful delivery
    request:
      trackingNumber:
        type: Text

  deliveryConfirmedImpl:
    type: Sequential Workflow Operation
    operation: deliveryConfirmed
    steps:
      - name: RequestFinalCapture
        type: Trigger Event
        event:
          type: Capture Funds Requested
          amount: \${document('/amount/total')}

  autoReleaseOnTimeout:
    type: Time-based Workflow
    trigger:
      daysAfter: 7
      fromEvent: Funds Reserved
    steps:
      - name: ReleaseReservedFunds
        type: Trigger Event
        event:
          type: Reservation Release Requested
          amount: \${document('/amount/reserved')}
`);

export const agentPayNote = btoa(`name: AI Agent
description: A master PayNote enabling an AI Agent to issue Child PayNotes for purchases within a pre-approved budget.

# --- Core State Fields ---
status:
  description: The current state of the PayNote (e.g., Pending, Approved, Reserved, Captured, Released, Rejected).
  type: Text
  value: Pending
currency:
  description: The ISO 4217 currency code for the transaction.
  type: Text
  value: USD
amount:
  description: The amounts associated with this PayNote.
  total:
    description: The maximum total value of this PayNote.
    type: Integer
    value: 23500 # $235.00 in cents
  reserved:
    description: The amount currently reserved by the Guarantor.
    type: Integer
    value: 0
  captured:
    description: The amount that has been successfully captured.
    type: Integer
    value: 0
  available:
    description: The amount available for Child PayNotes.
    type: Integer
    value: 0

purchaseRequirements:
  description: Requirements for the AI Agent's purchase
  product:
    name:
      type: Text
      value: BaBylissPRO Nano Titanium, 2000W hair dryer
    ean:
      type: Text
      value: 502515507373
    upc:
      type: Text
      value: 885609027213
  conditions:
    warranty:
      type: Text
      value: 2-year warranty required
    shipping:
      type: Text
      value: Free shipping required
    returns:
      type: Text
      value: Return option required
  approvedVendors:
    type: List
    description: Pre-approved list of shops
  expirationTime:
    type: Text
    value: end of day
    description: Time limit for recipient assignment

payNoteInitialStateDescription:
  summary: |
    ## You are about to reserve funds that can be used to make a purchase by your AI Agent on your behalf.
    1) We'll reserve $235 from your account to purchase a BaBylissPRO Nano Titanium, 2000W hair dryer (EAN: 502515507373; UPC: 885609027213). The seller must provide a 2-year warranty, free shipping, and a return option. Purchase can be made only from the pre-approved list of shops [(show the list)]().
    2) You or your AI Agent can select a seller (Recipient) and finalize the price.
    3) Any unused funds will be released back to you.
    4) If no Recipient is assigned by the end of the day, the PayNote will be canceled and the funds released.

  details: |
    * **Participants:**
      * Payer (You): <alice@xyz.com> (Timeline: aws:123...abc)
      * Recipient: To be determined by AI Agent
      * Guarantor: Demo Bank

    * **Authorized Actions:**
      * You: authorizePayment
      * AI Agent: selectRecipient, finalizePrice

    * **Document Info:**
      * PayNote ID: PN-AI-3C4D5E

# --- Participants & Contracts ---
contracts:
  payerChannel:
    type: MyOS Timeline
    value: aws:123...abc
  guarantorChannel:
    type: MyOS Timeline

  bootstrap:
    type: Sequential Workflow
    event:
      type: Document Processing Initiated
    steps:
      - name: ReserveFullBudget
        type: Trigger Event
        event:
          type: Reserve Funds Requested
          amount: \${document('/amount/total')}

  authorizePayment:
    type: Operation
    channel: payerChannel
    description: Payer authorizes the budget reservation

  selectRecipient:
    type: Operation
    channel: payerChannel
    description: AI Agent selects a recipient from approved vendors
    request:
      recipientEmail:
        type: Text
      recipientTimeline:
        type: Text
      vendorName:
        type: Text

  finalizePrice:
    type: Operation
    channel: payerChannel
    description: AI Agent finalizes the purchase price
    request:
      finalPrice:
        type: Integer
      vendorName:
        type: Text

  issueChildPayNote:
    type: Operation
    channel: payerChannel
    description: Allows the Payer (or their AI agent) to issue a new Child PayNote against the reserved funds
    request:
      type: PayNote

  issueChildPayNoteImpl:
    type: Sequential Workflow Operation
    operation: issueChildPayNote
    steps:
      - name: RequestChildIssuance
        type: Trigger Event
        event:
          type: Issue Child PayNote Requested
          childPayNote: \${event.request}

  autoCancelOnTimeout:
    type: Time-based Workflow
    trigger:
      time: end of day
      condition: \${document('/status') == 'Reserved' && !document('/payeeChannel')}
    steps:
      - name: CancelAndReleaseFunds
        type: Trigger Event
        event:
          type: PayNote Cancellation Requested
`);

export const samplePayNotes = {
  oneTimePayment: oneTimePaymentPayNote,
  delivery: deliveryPayNote,
  aiAgent: agentPayNote,
};

export const samplePayNotesList = [
  {
    id: 'oneTimePayment',
    name: 'Simple One-Time Payment',
    code: oneTimePaymentPayNote,
  },
  {
    id: 'delivery',
    name: 'Conditional Payment on Delivery',
    code: deliveryPayNote,
  },
  { id: 'aiAgent', name: 'AI Agent Budget', code: agentPayNote },
];
