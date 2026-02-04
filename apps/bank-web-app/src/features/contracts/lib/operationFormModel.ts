import type { FieldModel } from '@demo-bank-app/shared-bank-api-contract';

export { buildRequestModel } from '@demo-bank-app/shared-bank-api-contract';
export type { FieldModel } from '@demo-bank-app/shared-bank-api-contract';

export type PathSegment = string | number;

export type ValidationError = {
  path: string;
  message: string;
};

export type BuildPayloadResult = {
  payload?: unknown;
  errors: ValidationError[];
};

const buildRawField = (label: string): FieldModel => ({
  kind: 'raw',
  label,
  required: true,
});

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
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
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
