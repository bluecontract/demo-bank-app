import { DocumentBootstrapRequestedSchema } from '@blue-repository/types/packages/conversation/schemas';
import { PaymentMandateSchema } from '@blue-repository/types/packages/paynote/schemas';
import { blue } from '../../../blue';
import { resolveRuntimeDocument } from '../blueRuntime';
import { isRecord } from '../typeGuards';
import { getString } from '../paynoteWebhook/utils';

const hasConcreteMandateCoreFields = (
  document: Record<string, unknown>
): boolean => {
  const granterType = getString(document.granterType);
  const granterId = getString(document.granterId);
  const granteeType = getString(document.granteeType);
  const granteeId = getString(document.granteeId);
  const currency = getString(document.currency);
  const amountLimit =
    typeof document.amountLimit === 'number' &&
    Number.isFinite(document.amountLimit)
      ? document.amountLimit
      : undefined;

  return Boolean(
    granterType &&
      granterId &&
      granteeType &&
      granteeId &&
      currency &&
      amountLimit !== undefined &&
      amountLimit > 0
  );
};

export const getConcretePaymentMandateBootstrapRequest = (
  documentPayload: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  const runtimeDocument = resolveRuntimeDocument(documentPayload);
  if (!runtimeDocument) {
    return null;
  }

  const requestNode =
    runtimeDocument.node.getProperties()?.paymentMandateBootstrapRequest;
  const requestMatchesType = Boolean(
    requestNode &&
      blue.isTypeOf(requestNode, DocumentBootstrapRequestedSchema, {
        checkSchemaExtensions: true,
      })
  );
  if (!requestNode || (runtimeDocument.resolved && !requestMatchesType)) {
    return null;
  }

  const requestDocumentNode = requestNode.getProperties()?.document;
  const requestDocumentMatchesMandate = Boolean(
    requestDocumentNode &&
      blue.isTypeOf(requestDocumentNode, PaymentMandateSchema, {
        checkSchemaExtensions: true,
      })
  );
  if (
    !requestDocumentNode ||
    (runtimeDocument.resolved && !requestDocumentMatchesMandate)
  ) {
    return null;
  }

  const requestSimple = blue.nodeToJson(requestNode, 'simple');
  if (!isRecord(requestSimple)) {
    return null;
  }

  const bootstrapAssignee = getString(requestSimple.bootstrapAssignee);
  if (!bootstrapAssignee) {
    return null;
  }

  const requestDocumentSimple = blue.nodeToJson(requestDocumentNode, 'simple');
  if (!isRecord(requestDocumentSimple)) {
    return null;
  }
  if (
    !runtimeDocument.resolved &&
    !hasConcreteMandateCoreFields(requestDocumentSimple)
  ) {
    return null;
  }

  const requestDocumentSource = {
    ...requestDocumentSimple,
    type: getString(requestDocumentSimple.type) ?? 'PayNote/Payment Mandate',
  };
  const requestDocumentLossless = blue.nodeToJson(
    blue.restoreInlineTypes(blue.jsonValueToNode(requestDocumentSource)),
    'original'
  );
  if (!isRecord(requestDocumentLossless)) {
    return null;
  }

  return {
    ...requestSimple,
    document: requestDocumentLossless,
  };
};
