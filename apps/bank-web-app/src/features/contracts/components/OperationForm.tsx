import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { blue } from '../../../lib/blue';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import type { ContractOperation } from '../lib/operations';
import {
  buildPayload,
  buildRequestModel,
  createEmptyValue,
  formatPath,
  type FieldModel,
  type PathSegment,
} from '../lib/operationFormModel';
import { useRunContractOperation } from '../hooks';

interface OperationFormProps {
  operation: ContractOperation;
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
}

type Breadcrumb = {
  label: string;
  field: FieldModel;
  path: PathSegment[];
};

const isComplexField = (field: FieldModel) =>
  field.kind === 'object' ||
  field.kind === 'list' ||
  field.kind === 'dictionary';

const isSimpleField = (field: FieldModel) =>
  field.kind === 'text' ||
  field.kind === 'integer' ||
  field.kind === 'double' ||
  field.kind === 'boolean' ||
  field.kind === 'timestamp' ||
  field.kind === 'raw';

const getValueAtPath = (value: unknown, path: PathSegment[]): unknown => {
  return path.reduce((current, segment) => {
    if (current == null) {
      return undefined;
    }
    if (typeof segment === 'number') {
      return Array.isArray(current) ? current[segment] : undefined;
    }
    if (typeof current === 'object' && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value as unknown);
};

const setValueAtPath = (
  current: unknown,
  path: PathSegment[],
  nextValue: unknown
): unknown => {
  if (path.length === 0) {
    return nextValue;
  }

  const [segment, ...rest] = path;

  if (typeof segment === 'number') {
    const list = Array.isArray(current) ? [...current] : [];
    list[segment] = setValueAtPath(list[segment], rest, nextValue);
    return list;
  }

  const objectValue =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};

  objectValue[segment] = setValueAtPath(objectValue[segment], rest, nextValue);

  return objectValue;
};

const removeValueAtPath = (current: unknown, path: PathSegment[]): unknown => {
  if (path.length === 0) {
    return undefined;
  }

  const [segment, ...rest] = path;

  if (typeof segment === 'number') {
    if (!Array.isArray(current)) {
      return current;
    }
    if (rest.length === 0) {
      return current.filter((_, index) => index !== segment);
    }
    const list = [...current];
    list[segment] = removeValueAtPath(list[segment], rest);
    return list;
  }

  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return current;
  }

  const objectValue = { ...(current as Record<string, unknown>) };
  if (rest.length === 0) {
    delete objectValue[segment];
    return objectValue;
  }

  objectValue[segment] = removeValueAtPath(objectValue[segment], rest);
  return objectValue;
};

export function OperationForm({
  operation,
  sessionId,
  isOpen,
  onClose,
}: OperationFormProps) {
  const runOperation = useRunContractOperation();
  const [mode, setMode] = useState<'form' | 'confirm' | 'success'>(() =>
    operation.request ? 'form' : 'confirm'
  );
  const [values, setValues] = useState<unknown>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [payloadPreview, setPayloadPreview] = useState<unknown>({});
  const [dictionaryDrafts, setDictionaryDrafts] = useState<
    Record<string, { key: string; value: unknown; error?: string }>
  >({});
  const previousOperationName = useRef<string | null>(null);
  const previousIsOpen = useRef(false);

  const model = useMemo(() => {
    if (!operation.request) {
      return null;
    }
    return buildRequestModel(operation.request, blue, 'Request');
  }, [operation]);

  const hasRequest = Boolean(operation.request && model);

  useEffect(() => {
    const didOpen = isOpen && !previousIsOpen.current;
    const operationChanged = operation.name !== previousOperationName.current;

    if (isOpen && (didOpen || operationChanged)) {
      if (!model) {
        setValues({});
      } else {
        setValues(createEmptyValue(model));
      }
      setErrors({});
      setBreadcrumbs([]);
      setDictionaryDrafts({});
      setPayloadPreview({});
      setMode(hasRequest ? 'form' : 'confirm');
    }

    previousIsOpen.current = isOpen;
    previousOperationName.current = operation.name;
  }, [hasRequest, isOpen, model, operation.name]);
  const isConfirming = mode === 'confirm';
  const isSuccess = mode === 'success';
  const operationTitle = operation.label || operation.name;
  const isOperationPending = runOperation.isPending;
  const operationErrorMessage =
    runOperation.error instanceof Error ? runOperation.error.message : null;

  const handleReview = () => {
    if (!model) {
      setPayloadPreview({});
      setMode('confirm');
      return;
    }

    const { payload, errors: validationErrors } = buildPayload(model, values);

    if (validationErrors.length > 0) {
      const mappedErrors = validationErrors.reduce<Record<string, string>>(
        (acc, error) => {
          acc[error.path] = error.message;
          return acc;
        },
        {}
      );
      setErrors(mappedErrors);
      return;
    }

    setErrors({});
    setPayloadPreview(payload ?? {});
    setMode('confirm');
  };

  const handleClose = () => {
    runOperation.reset?.();
    onClose();
  };

  const handleConfirmCancel = () => {
    if (hasRequest) {
      runOperation.reset?.();
      setMode('form');
      return;
    }
    handleClose();
  };

  const handleConfirm = () => {
    const body = hasRequest ? payloadPreview ?? {} : {};
    runOperation.mutate(
      {
        sessionId,
        operation: operation.name,
        body,
      },
      {
        onSuccess: () => {
          setMode('success');
        },
      }
    );
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  };

  const currentContext = breadcrumbs.length
    ? breadcrumbs[breadcrumbs.length - 1]
    : model
    ? { label: model.label, field: model, path: [] }
    : null;

  const openNested = (
    field: FieldModel,
    path: PathSegment[],
    label: string
  ) => {
    setBreadcrumbs((prev: Breadcrumb[]) => [...prev, { field, path, label }]);
  };

  const navigateTo = (index: number) => {
    setBreadcrumbs((prev: Breadcrumb[]) => prev.slice(0, index + 1));
  };

  const updateValue = (path: PathSegment[], nextValue: unknown) => {
    setValues((prev: unknown) => setValueAtPath(prev, path, nextValue));
  };

  const removeValue = (path: PathSegment[]) => {
    setValues((prev: unknown) => removeValueAtPath(prev, path));
  };

  const renderError = (path: PathSegment[]) => {
    const error = errors[formatPath(path)];
    if (!error) {
      return null;
    }
    return <p className="text-xs text-rose-600 mt-1">{error}</p>;
  };

  const renderBooleanToggle = (
    value: boolean,
    onChange: (next: boolean) => void,
    disabled?: boolean
  ) => (
    <div
      className={`inline-flex rounded-full border border-slate-200 bg-white/80 p-1 text-xs font-semibold ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        className={`rounded-full px-3 py-1 transition ${
          value
            ? 'text-slate-500 hover:bg-slate-100'
            : 'bg-emerald-500 text-white shadow-sm'
        }`}
        onClick={() => onChange(false)}
        disabled={disabled}
        aria-pressed={!value}
      >
        False
      </button>
      <button
        type="button"
        className={`rounded-full px-3 py-1 transition ${
          value
            ? 'bg-emerald-500 text-white shadow-sm'
            : 'text-slate-500 hover:bg-slate-100'
        }`}
        onClick={() => onChange(true)}
        disabled={disabled}
        aria-pressed={value}
      >
        True
      </button>
    </div>
  );

  const renderInputField = (
    field: FieldModel,
    path: PathSegment[],
    disabled?: boolean
  ) => {
    const value = getValueAtPath(values, path);

    switch (field.kind) {
      case 'text':
        return (
          <>
            <input
              type="text"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[rgba(43,190,156,0.2)]"
              value={typeof value === 'string' ? value : ''}
              onChange={event => updateValue(path, event.target.value)}
              disabled={disabled}
            />
            {renderError(path)}
          </>
        );
      case 'integer':
        return (
          <>
            <input
              type="number"
              inputMode="numeric"
              step={1}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[rgba(43,190,156,0.2)]"
              value={
                typeof value === 'string' || typeof value === 'number'
                  ? value
                  : ''
              }
              onChange={event => updateValue(path, event.target.value)}
              disabled={disabled}
            />
            {renderError(path)}
          </>
        );
      case 'double':
        return (
          <>
            <input
              type="number"
              step="any"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[rgba(43,190,156,0.2)]"
              value={
                typeof value === 'string' || typeof value === 'number'
                  ? value
                  : ''
              }
              onChange={event => updateValue(path, event.target.value)}
              disabled={disabled}
            />
            {renderError(path)}
          </>
        );
      case 'boolean':
        return (
          <>
            {renderBooleanToggle(
              value === true,
              nextValue => updateValue(path, nextValue),
              disabled
            )}
            {renderError(path)}
          </>
        );
      case 'timestamp':
        return (
          <>
            <input
              type="datetime-local"
              step="1"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[rgba(43,190,156,0.2)]"
              value={typeof value === 'string' ? value : ''}
              onChange={event => updateValue(path, event.target.value)}
              disabled={disabled}
            />
            {renderError(path)}
          </>
        );
      case 'raw':
        return (
          <>
            <textarea
              className="w-full min-h-[120px] rounded-lg border border-slate-200 bg-slate-900/95 px-3 py-2 text-xs font-mono text-emerald-100 focus:border-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[rgba(43,190,156,0.2)]"
              placeholder='Enter JSON (example: {"message": "Hello"})'
              value={typeof value === 'string' ? value : ''}
              onChange={event => updateValue(path, event.target.value)}
              disabled={disabled}
            />
            {renderError(path)}
          </>
        );
      default:
        return null;
    }
  };

  const renderObjectFields = (field: FieldModel, basePath: PathSegment[]) => {
    const entries = Object.entries(field.fields ?? {});

    if (!entries.length) {
      return (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-4 text-sm text-slate-500">
          No fields defined for this request.
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {entries.map(([key, child]) => (
          <div
            key={key}
            className="rounded-xl border border-slate-200 bg-white/70 p-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {child.label}
                </p>
                {child.description && (
                  <p className="text-xs text-slate-500 mt-1">
                    {child.description}
                  </p>
                )}
              </div>
              {isComplexField(child) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    openNested(child, [...basePath, key], child.label)
                  }
                >
                  Edit
                </Button>
              )}
            </div>

            {isSimpleField(child) && (
              <div className="mt-3">
                {renderInputField(child, [...basePath, key])}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderListFields = (field: FieldModel, basePath: PathSegment[]) => {
    const listValue = getValueAtPath(values, basePath);
    const items = Array.isArray(listValue) ? listValue : [];
    const itemField = field.item;

    return (
      <div className="space-y-3">
        {items.map((_itemValue, index) => (
          <div
            key={`list-item-${index}`}
            className="rounded-xl border border-slate-200 bg-white/70 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Item {index + 1}
                </p>
                {itemField?.description && (
                  <p className="text-xs text-slate-500 mt-1">
                    {itemField.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {itemField && isComplexField(itemField) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      openNested(
                        itemField,
                        [...basePath, index],
                        `Item ${index + 1}`
                      )
                    }
                  >
                    Edit
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeValue([...basePath, index])}
                >
                  Remove
                </Button>
              </div>
            </div>

            {itemField && isSimpleField(itemField) && (
              <div className="mt-3">
                {renderInputField(itemField, [...basePath, index])}
              </div>
            )}
          </div>
        ))}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (!field.item) {
              return;
            }
            const nextItem = createEmptyValue(field.item);
            const nextList = Array.isArray(listValue)
              ? [...listValue, nextItem]
              : [nextItem];
            updateValue(basePath, nextList);
          }}
        >
          Add item
        </Button>
      </div>
    );
  };

  const renderDictionaryFields = (
    field: FieldModel,
    basePath: PathSegment[]
  ) => {
    const dictionaryValue = getValueAtPath(values, basePath);
    const entries =
      dictionaryValue &&
      typeof dictionaryValue === 'object' &&
      !Array.isArray(dictionaryValue)
        ? (dictionaryValue as Record<string, unknown>)
        : {};
    const valueField = field.value;
    const draftKey = formatPath(basePath) || 'root';
    const draft = dictionaryDrafts[draftKey] ?? { key: '', value: '' };

    return (
      <div className="space-y-3">
        {Object.entries(entries).map(([key, entryValue]) => (
          <div
            key={key}
            className="rounded-xl border border-slate-200 bg-white/70 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{key}</p>
                {valueField?.description && (
                  <p className="text-xs text-slate-500 mt-1">
                    {valueField.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {valueField && isComplexField(valueField) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      openNested(valueField, [...basePath, key], key)
                    }
                  >
                    Edit
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeValue([...basePath, key])}
                >
                  Remove
                </Button>
              </div>
            </div>

            {valueField && isSimpleField(valueField) && (
              <div className="mt-3">
                {renderInputField(valueField, [...basePath, key])}
              </div>
            )}
          </div>
        ))}

        <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-4">
          <p className="text-sm font-semibold text-slate-900">Add entry</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[rgba(43,190,156,0.2)]"
              placeholder="Key"
              value={draft.key}
              onChange={event =>
                setDictionaryDrafts(prev => ({
                  ...prev,
                  [draftKey]: { ...draft, key: event.target.value, error: '' },
                }))
              }
            />
            {valueField &&
              isSimpleField(valueField) &&
              (valueField.kind === 'boolean' ? (
                renderBooleanToggle(draft.value === true, nextValue =>
                  setDictionaryDrafts(prev => ({
                    ...prev,
                    [draftKey]: { ...draft, value: nextValue, error: '' },
                  }))
                )
              ) : valueField.kind === 'timestamp' ? (
                <input
                  type="datetime-local"
                  step="1"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[rgba(43,190,156,0.2)]"
                  placeholder="Value"
                  value={typeof draft.value === 'string' ? draft.value : ''}
                  onChange={event =>
                    setDictionaryDrafts(prev => ({
                      ...prev,
                      [draftKey]: {
                        ...draft,
                        value: event.target.value,
                        error: '',
                      },
                    }))
                  }
                />
              ) : (
                <input
                  type={
                    valueField.kind === 'text' || valueField.kind === 'raw'
                      ? 'text'
                      : 'number'
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[rgba(43,190,156,0.2)]"
                  placeholder="Value"
                  value={
                    typeof draft.value === 'string' ||
                    typeof draft.value === 'number'
                      ? draft.value
                      : ''
                  }
                  onChange={event =>
                    setDictionaryDrafts(prev => ({
                      ...prev,
                      [draftKey]: {
                        ...draft,
                        value: event.target.value,
                        error: '',
                      },
                    }))
                  }
                />
              ))}
          </div>
          {draft.error && (
            <p className="mt-2 text-xs text-rose-600">{draft.error}</p>
          )}
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const trimmedKey = draft.key.trim();
                if (!trimmedKey) {
                  setDictionaryDrafts(prev => ({
                    ...prev,
                    [draftKey]: { ...draft, error: 'Key is required.' },
                  }));
                  return;
                }
                if (Object.prototype.hasOwnProperty.call(entries, trimmedKey)) {
                  setDictionaryDrafts(prev => ({
                    ...prev,
                    [draftKey]: {
                      ...draft,
                      error: 'Key already exists.',
                    },
                  }));
                  return;
                }
                const nextValue = valueField
                  ? isSimpleField(valueField)
                    ? draft.value
                    : createEmptyValue(valueField)
                  : draft.value;
                updateValue(basePath, {
                  ...entries,
                  [trimmedKey]: nextValue,
                });
                setDictionaryDrafts(prev => ({
                  ...prev,
                  [draftKey]: { key: '', value: '', error: '' },
                }));
              }}
            >
              Add entry
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderCurrentContext = () => {
    if (!currentContext) {
      return (
        <div className="rounded-xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-600">
          No request schema available for this operation.
        </div>
      );
    }

    if (currentContext.field.kind === 'object') {
      return renderObjectFields(currentContext.field, currentContext.path);
    }

    if (currentContext.field.kind === 'list') {
      return renderListFields(currentContext.field, currentContext.path);
    }

    if (currentContext.field.kind === 'dictionary') {
      return renderDictionaryFields(currentContext.field, currentContext.path);
    }

    return renderInputField(currentContext.field, currentContext.path);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
      data-testid="operation-modal-backdrop"
    >
      <div
        className="bg-white/90 rounded-2xl shadow-xl border border-slate-200 backdrop-blur max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={event => event.stopPropagation()}
        data-testid="operation-modal-content"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-muted)]">
                Contract operation
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">
                {operationTitle}
              </h3>
              {operation.description && (
                <p className="mt-1 text-sm text-slate-600">
                  {operation.description}
                </p>
              )}
            </div>
            {hasRequest ? (
              <span className="app-chip">Input required</span>
            ) : (
              <span className="app-chip app-chip-neutral">No input</span>
            )}
          </div>

          {mode === 'form' && (
            <div className="space-y-4">
              {breadcrumbs.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <button
                    type="button"
                    className="font-semibold text-[color:var(--color-primary)]"
                    onClick={() => setBreadcrumbs([])}
                  >
                    Request
                  </button>
                  {breadcrumbs.map((crumb, index) => (
                    <div
                      key={`${crumb.label}-${index}`}
                      className="flex items-center gap-2"
                    >
                      <span>/</span>
                      <button
                        type="button"
                        className="font-semibold text-[color:var(--color-primary)]"
                        onClick={() => navigateTo(index)}
                      >
                        {crumb.label}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {renderCurrentContext()}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button variant="secondary" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={handleReview}>
                  OK
                </Button>
              </div>

              {operationErrorMessage && (
                <p className="text-sm text-rose-600">{operationErrorMessage}</p>
              )}
            </div>
          )}

          {isConfirming && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-4 text-sm text-amber-900">
                Confirm you want to execute contract operation:{' '}
                <span className="font-semibold">"{operationTitle}"</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleConfirmCancel}
                  disabled={isOperationPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleConfirm}
                  disabled={isOperationPending}
                >
                  {isOperationPending ? 'Running...' : 'Confirm'}
                </Button>
                {isOperationPending && <Spinner size="sm" color="green" />}
              </div>
              {operationErrorMessage && (
                <p className="text-sm text-rose-600">{operationErrorMessage}</p>
              )}
            </div>
          )}

          {isSuccess && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-700">
                Operation submitted successfully.
              </div>
              <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={handleClose}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
