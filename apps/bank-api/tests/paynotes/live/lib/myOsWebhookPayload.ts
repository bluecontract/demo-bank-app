import { Blue, BlueNode } from '@blue-labs/language';
import { createDefaultMergingProcessor } from '@blue-labs/document-processor';
import { repository } from '@blue-repository/types';

const blue = new Blue({
  repositories: [repository],
  mergingProcessor: createDefaultMergingProcessor(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stripResolvedTypeRefsToBlueId = (node: BlueNode): BlueNode => {
  const stripType = (typeNode: BlueNode | undefined): BlueNode | undefined => {
    if (!typeNode) {
      return undefined;
    }
    const blueId = typeNode.getBlueId();
    if (!blueId) {
      return typeNode;
    }
    return new BlueNode().setBlueId(blueId);
  };

  const visit = (current: BlueNode) => {
    current.setType(stripType(current.getType()));
    current.setItemType(stripType(current.getItemType()));
    current.setKeyType(stripType(current.getKeyType()));
    current.setValueType(stripType(current.getValueType()));

    const properties = current.getProperties();
    if (properties) {
      Object.values(properties).forEach(visit);
    }

    const items = current.getItems();
    if (items) {
      items.forEach(visit);
    }
  };

  const cloned = node.clone();
  visit(cloned);
  return cloned;
};

const toCompactBlueJsonValue = (value: unknown): unknown => {
  if (value === undefined || value === null) {
    return value;
  }

  try {
    const node = blue.jsonValueToNode(value);
    return blue.nodeToJson(stripResolvedTypeRefsToBlueId(node), 'official');
  } catch {
    return value;
  }
};

const compactArray = (value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map(item => toCompactBlueJsonValue(item));
};

/**
 * Real MyOS webhook delivery does not forward the raw GET /myos-events/:id
 * payload verbatim. It first compacts Blue nodes in the event object.
 *
 * The pull-and-post harness must mimic that serialization step, otherwise it
 * forwards a richer API-only shape that bank runtime never sees from real
 * webhook delivery.
 */
export const toMyOsWebhookPayload = (payload: unknown): unknown => {
  if (!isRecord(payload)) {
    return payload;
  }

  const cloned = structuredClone(payload);
  const object = isRecord(cloned.object) ? cloned.object : undefined;
  if (!object) {
    return cloned;
  }

  if ('document' in object) {
    object.document = toCompactBlueJsonValue(object.document);
  }

  if ('emitted' in object) {
    object.emitted = compactArray(object.emitted);
  }

  if ('triggeredBy' in object) {
    object.triggeredBy = toCompactBlueJsonValue(object.triggeredBy);
  }

  return cloned;
};
