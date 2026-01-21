import type { Blue, BlueNode } from '@blue-labs/language';
import { Properties } from '@blue-labs/language';
import commonBlueIds from '@blue-repository/types/packages/common/blue-ids';

type FieldKind =
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

export type PathSegment = string | number;

export type ValidationError = {
  path: string;
  message: string;
};

export type BuildPayloadResult = {
  payload?: unknown;
  errors: ValidationError[];
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

export const createEmptyValue = (field: FieldModel): unknown => {
  switch (field.kind) {
    case 'text':
    case 'integer':
    case 'double':
    case 'raw':
    case 'timestamp':
      return '';
    case 'boolean':
      return false;
    case 'object':
      return {};
    case 'list':
      return [];
    case 'dictionary':
      return {};
    default:
      return '';
  }
};

export const formatPath = (path: PathSegment[]): string => {
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }
      return index === 0 ? segment : `.${segment}`;
    })
    .join('');
};

const pushError = (
  errors: ValidationError[],
  path: PathSegment[],
  message: string
) => {
  errors.push({ path: formatPath(path), message });
};

const buildValue = (
  field: FieldModel,
  value: unknown,
  path: PathSegment[],
  errors: ValidationError[]
): unknown => {
  switch (field.kind) {
    case 'text': {
      const stringValue = typeof value === 'string' ? value.trim() : '';
      if (!stringValue && field.required) {
        pushError(errors, path, 'Required');
        return undefined;
      }
      return stringValue || undefined;
    }
    case 'integer': {
      if (typeof value === 'string' && value.trim() === '') {
        if (field.required) {
          pushError(errors, path, 'Enter a valid integer');
        }
        return undefined;
      }
      const raw = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(raw)) {
        if (field.required) {
          pushError(errors, path, 'Enter a valid integer');
        }
        return undefined;
      }
      if (!Number.isInteger(raw)) {
        pushError(errors, path, 'Must be a whole number');
        return undefined;
      }
      return raw;
    }
    case 'double': {
      if (typeof value === 'string' && value.trim() === '') {
        if (field.required) {
          pushError(errors, path, 'Enter a valid number');
        }
        return undefined;
      }
      const raw = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(raw)) {
        if (field.required) {
          pushError(errors, path, 'Enter a valid number');
        }
        return undefined;
      }
      return raw;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        if (field.required) {
          pushError(errors, path, 'Required');
        }
        return undefined;
      }
      return value;
    }
    case 'raw': {
      const rawValue = typeof value === 'string' ? value.trim() : '';
      if (!rawValue) {
        if (field.required) {
          pushError(errors, path, 'Required');
        }
        return undefined;
      }

      try {
        return JSON.parse(rawValue);
      } catch {
        pushError(errors, path, 'Enter valid JSON');
        return undefined;
      }
    }
    case 'timestamp': {
      const rawValue = typeof value === 'string' ? value.trim() : '';
      if (!rawValue) {
        if (field.required) {
          pushError(errors, path, 'Required');
        }
        return undefined;
      }

      const date = parseLocalDateTime(rawValue);
      if (!date) {
        pushError(errors, path, 'Enter a valid date/time');
        return undefined;
      }

      return formatTimestampWithOffset(date);
    }
    case 'object': {
      const objectValue =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const result: Record<string, unknown> = {};

      Object.entries(field.fields ?? {}).forEach(([key, child]) => {
        const childValue = buildValue(
          child,
          objectValue[key],
          [...path, key],
          errors
        );
        if (childValue !== undefined) {
          result[key] = childValue;
        }
      });

      return Object.keys(result).length ? result : undefined;
    }
    case 'list': {
      const listValue = Array.isArray(value) ? value : [];
      const itemField = field.item ?? buildRawField('Item');

      const items = listValue
        .map((itemValue, index) =>
          buildValue(itemField, itemValue, [...path, index], errors)
        )
        .filter(itemValue => itemValue !== undefined);

      return items.length ? items : undefined;
    }
    case 'dictionary': {
      const objectValue =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const valueField = field.value ?? buildRawField('Value');
      const result: Record<string, unknown> = {};

      Object.entries(objectValue).forEach(([key, entryValue]) => {
        if (!key.trim()) {
          pushError(errors, [...path, key], 'Key is required');
          return;
        }
        const parsedValue = buildValue(
          valueField,
          entryValue,
          [...path, key],
          errors
        );
        if (parsedValue !== undefined) {
          result[key] = parsedValue;
        }
      });

      return Object.keys(result).length ? result : undefined;
    }
    default:
      return undefined;
  }
};

const padNumber = (value: number) => String(value).padStart(2, '0');

const parseLocalDateTime = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds ?? '0'),
    0
  );

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

const formatTimestampWithOffset = (date: Date) => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = padNumber(Math.floor(absoluteOffset / 60));
  const offsetMins = padNumber(absoluteOffset % 60);

  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(
    date.getDate()
  )}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(
    date.getSeconds()
  )}${sign}${offsetHours}:${offsetMins}`;
};

export const buildPayload = (
  field: FieldModel,
  value: unknown,
  path: PathSegment[] = []
): BuildPayloadResult => {
  const errors: ValidationError[] = [];
  const payload = buildValue(field, value, path, errors);

  return {
    payload,
    errors,
  };
};
