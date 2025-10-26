import * as components from './index';

describe('paynote-transfer component exports', () => {
  it('exposes all public components', () => {
    expect(components.PayNoteTransferStepper).toBeDefined();
    expect(components.FormStep).toBeDefined();
    expect(components.ReviewStep).toBeDefined();
    expect(components.AuthorizationStep).toBeDefined();
    expect(components.SuccessStep).toBeDefined();
    expect(components.PayNoteCodeInput).toBeDefined();
    expect(components.PayNoteDetails).toBeDefined();
    expect(components.TransferPaymentForm).toBeDefined();
  });
});
