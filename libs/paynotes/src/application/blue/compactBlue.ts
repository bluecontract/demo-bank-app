import { BlueNode } from '@blue-labs/language';
import { blue } from '../../blue';

export const stripResolvedTypeRefsToBlueId = (node: BlueNode): BlueNode => {
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

export const toCompactBlueJsonValue = (value: unknown): unknown => {
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
