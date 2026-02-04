import type { Blue, BlueNode } from '@blue-labs/language';
import { Properties } from '@blue-labs/language';
import commonBlueIds from '@blue-repository/types/packages/common/blue-ids';

export type FieldKind =
  | 'text'
  | 'integer'
  | 'double'
  | 'boolean'
  | 'timestamp'
  | 'object'
  | 'list'
  | 'dictionary'
  | 'raw';

export type FieldModel = {
  kind: FieldKind;
  label: string;
  description?: string;
  required: boolean;
  fields?: Record<string, FieldModel>;
  item?: FieldModel;
  value?: FieldModel;
};

const buildRawField = (label: string, description?: string): FieldModel => ({
  kind: 'raw',
  label,
  description,
  required: true,
});

const resolveNode = (node: BlueNode, blue: Blue): BlueNode | null => {
  try {
    return blue.resolve(node);
  } catch {
    return null;
  }
};

const coreTypeBlueIds = Properties.CORE_TYPE_BLUE_IDS as readonly string[];
const timestampBlueId = commonBlueIds['Common/Timestamp'];

const isCoreTypeBlueId = (
  value: string
): value is (typeof Properties.CORE_TYPE_BLUE_IDS)[number] =>
  coreTypeBlueIds.includes(value);

const resolveTypeBlueId = (node: BlueNode): string | undefined => {
  const direct = node.getType()?.getBlueId();
  if (direct && isCoreTypeBlueId(direct)) {
    return direct;
  }

  const nested = node.getType()?.getType()?.getBlueId();
  if (nested && isCoreTypeBlueId(nested)) {
    return nested;
  }

  return direct;
};

const isTimestampType = (
  node: BlueNode,
  resolved?: BlueNode | null
): boolean => {
  const declared = node.getType()?.getBlueId();
  const declaredNested = node.getType()?.getType()?.getBlueId();
  const resolvedType = resolved?.getType()?.getBlueId();
  const resolvedNested = resolved?.getType()?.getType()?.getBlueId();

  return (
    declared === timestampBlueId ||
    declaredNested === timestampBlueId ||
    resolvedType === timestampBlueId ||
    resolvedNested === timestampBlueId
  );
};

export const buildRequestModel = (
  node: BlueNode,
  blue: Blue,
  label = 'Request'
): FieldModel => {
  const resolved = resolveNode(node, blue);
  if (!resolved) {
    return buildRawField(label, node.getDescription() ?? undefined);
  }

  const description = resolved.getDescription() ?? undefined;
  if (isTimestampType(node, resolved)) {
    return { kind: 'timestamp', label, description, required: true };
  }

  const typeBlueId = resolveTypeBlueId(resolved);

  if (typeBlueId === Properties.TEXT_TYPE_BLUE_ID) {
    return { kind: 'text', label, description, required: true };
  }
  if (typeBlueId === Properties.INTEGER_TYPE_BLUE_ID) {
    return { kind: 'integer', label, description, required: true };
  }
  if (typeBlueId === Properties.DOUBLE_TYPE_BLUE_ID) {
    return { kind: 'double', label, description, required: true };
  }
  if (typeBlueId === Properties.BOOLEAN_TYPE_BLUE_ID) {
    return { kind: 'boolean', label, description, required: false };
  }

  if (typeBlueId === Properties.LIST_TYPE_BLUE_ID || resolved.getItemType()) {
    const itemNode = resolved.getItemType();
    const itemField = itemNode
      ? buildRequestModel(itemNode, blue, 'Item')
      : buildRawField('Item');

    return {
      kind: 'list',
      label,
      description,
      required: false,
      item: itemField,
    };
  }

  if (
    typeBlueId === Properties.DICTIONARY_TYPE_BLUE_ID ||
    resolved.getValueType()
  ) {
    const valueNode = resolved.getValueType();
    const valueField = valueNode
      ? buildRequestModel(valueNode, blue, 'Value')
      : buildRawField('Value');

    return {
      kind: 'dictionary',
      label,
      description,
      required: false,
      value: valueField,
    };
  }

  const properties = resolved.getProperties() ?? {};
  const propertyEntries = Object.entries(properties).filter(
    ([key]) => key !== Properties.OBJECT_CONTRACTS
  );

  if (propertyEntries.length) {
    const fields = Object.fromEntries(
      propertyEntries.map(([key, value]) => [
        key,
        buildRequestModel(value, blue, key),
      ])
    );

    return {
      kind: 'object',
      label,
      description,
      required: false,
      fields,
    };
  }

  return buildRawField(label, description);
};
