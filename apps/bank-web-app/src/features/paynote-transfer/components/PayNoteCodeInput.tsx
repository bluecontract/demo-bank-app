import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { CloudUpload, HelpCircle, Loader2 } from 'lucide-react';
import {
  encodeObjectAsPayNoteBase64,
  parsePayNoteFile,
  isValidBase64,
  decodePayNoteBase64AsYaml,
  type ExamplePayNote,
  type ExampleTemplateContext,
  renderExamplePayNote,
  getDefaultTemplateValues,
} from '../../../lib/paynote';
import { useAuth } from '../../../app/providers/AuthProvider.tsx';
import { YamlPreviewOverlay } from './YamlPreviewOverlay.tsx';

interface PayNoteCodeInputProps {
  enabled: boolean;
  value?: string;
  onChange?: (value: string) => void;
  onToggle?: (enabled: boolean) => void;
  disabled?: boolean;
  examples?: ExamplePayNote[];
  showPreview?: boolean;
}

type ExampleState = {
  values: Record<string, string>;
  defaults: Record<string, string>;
  encoded: string;
};

const createExampleState = (
  example: ExamplePayNote,
  values?: Record<string, string>,
  context: ExampleTemplateContext = {}
): ExampleState => {
  const defaults = getDefaultTemplateValues(example, context);
  const mergedValues = values ? { ...defaults, ...values } : defaults;
  const rendered = renderExamplePayNote(example, mergedValues, context);

  return {
    values: mergedValues,
    defaults,
    encoded: rendered.encoded,
  };
};

const reconcileExampleState = (
  example: ExamplePayNote,
  previous: ExampleState | undefined,
  context: ExampleTemplateContext
): ExampleState => {
  if (!previous) {
    return createExampleState(example, undefined, context);
  }

  const nextDefaults = getDefaultTemplateValues(example, context);
  const nextValues: Record<string, string> = { ...nextDefaults };

  Object.entries(previous.values).forEach(([key, value]) => {
    const prevDefault = previous.defaults[key];
    const hasPrevDefault = prevDefault !== undefined;
    if (
      hasPrevDefault &&
      value === prevDefault &&
      nextDefaults[key] !== undefined
    ) {
      return;
    }
    nextValues[key] = value;
  });

  const rendered = renderExamplePayNote(example, nextValues, context);

  return {
    values: nextValues,
    defaults: nextDefaults,
    encoded: rendered.encoded,
  };
};

const areRecordsEqual = (
  a: Record<string, string>,
  b: Record<string, string>
) => {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every(key => a[key] === b[key]);
};

const areExampleStatesEqual = (a: ExampleState, b: ExampleState) =>
  a.encoded === b.encoded &&
  areRecordsEqual(a.values, b.values) &&
  areRecordsEqual(a.defaults, b.defaults);

export function PayNoteCodeInput({
  enabled,
  value = '',
  onChange,
  onToggle,
  disabled = false,
  examples = [],
}: PayNoteCodeInputProps) {
  const { user } = useAuth();
  const templateContext = useMemo<ExampleTemplateContext>(() => {
    return { CURRENT_USER_EMAIL: user?.email ?? '' };
  }, [user?.email]);

  const [payNoteCode, setPayNoteCode] = useState(value);
  const [fileError, setFileError] = useState('');
  const [inputError, setInputError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [selectedExample, setSelectedExample] = useState<ExamplePayNote | null>(
    null
  );
  const [exampleStates, setExampleStates] = useState<
    Record<string, ExampleState>
  >({});
  const [yamlPreview, setYamlPreview] = useState<{
    title: string;
    content: string;
    error?: string;
  } | null>(null);

  const handleCodeChange = (
    newValue: string,
    options?: { example?: ExamplePayNote | null }
  ) => {
    setInputError('');
    setPayNoteCode(newValue);
    if (options?.example !== undefined) {
      setSelectedExample(options.example);
    } else {
      setSelectedExample(null);
    }
    onChange?.(newValue);
  };

  const handleInputBlur = (blurValue: string) => {
    if (blurValue && !isValidBase64(blurValue)) {
      setInputError(
        'Invalid PayNote code format. Please enter valid base64 text.'
      );
    } else {
      setInputError('');
      onChange?.(blurValue);
    }
  };

  const validExtensions = ['.yml', '.yaml', '.json', '.txt', '.pdf'];
  const validExtensionsText = validExtensions.join(', ');

  useEffect(() => {
    setPayNoteCode(value);
  }, [value]);

  useEffect(() => {
    setExampleStates(prev => {
      const nextEntries = examples.map(example => [
        example.id,
        reconcileExampleState(example, prev[example.id], templateContext),
      ]);
      const next = Object.fromEntries(nextEntries);

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const isSame =
        prevKeys.length === nextKeys.length &&
        nextKeys.every(
          key =>
            prev[key] &&
            next[key] &&
            areExampleStatesEqual(prev[key], next[key])
        );

      return isSame ? prev : (next as Record<string, ExampleState>);
    });
  }, [examples, templateContext]);

  useEffect(() => {
    if (!enabled) {
      setIsPickerOpen(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!value) {
      if (!payNoteCode) {
        setSelectedExample(null);
      }
      return;
    }

    if (selectedExample) {
      return;
    }

    const matchedEntry = Object.entries(exampleStates).find(
      ([, state]) => state.encoded === value
    );

    if (!matchedEntry) {
      return;
    }

    const matchedExample = examples.find(
      example => example.id === matchedEntry[0]
    );
    if (matchedExample) {
      setSelectedExample(matchedExample);
    }
  }, [value, examples, exampleStates, selectedExample, payNoteCode]);

  const processFile = async (file: File) => {
    setFileError('');
    setInputError('');
    setIsProcessing(true);

    try {
      let base64Content = '';
      const result = await parsePayNoteFile(file);

      if (!result.success) {
        setFileError(result.error || 'Failed to parse file');
        handleCodeChange('');
      } else if (result.data) {
        base64Content = encodeObjectAsPayNoteBase64(result.data);
        handleCodeChange(base64Content, { example: null });
      }
    } catch (error) {
      console.error('Error parsing file:', error);
      setFileError(
        `Error processing file: Invalid ${file.name
          .split('.')
          .pop()
          ?.toUpperCase()} format`
      );
      handleCodeChange('', { example: null });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
    event.target.value = '';
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }

    const isValid = validExtensions.some(ext =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (isValid) {
      processFile(file);
    } else {
      setFileError(
        `Invalid file type. Please upload a file with one of these extensions: ${validExtensionsText}`
      );
    }
  };

  const handleToggle = () => {
    if (disabled) {
      return;
    }

    const next = !enabled;
    if (!next) {
      handleCodeChange('', { example: null });
    }
    onToggle?.(next);
  };

  const handleExampleToggle = () => {
    if (!enabled) {
      onToggle?.(true);
    }
    setIsPickerOpen(open => !open);
  };

  const handleExampleSelect = (example: ExamplePayNote) => {
    if (!enabled) {
      onToggle?.(true);
    }

    const state =
      exampleStates[example.id] ??
      createExampleState(example, undefined, templateContext);
    handleCodeChange(state.encoded, { example });
    setExampleStates(prev => ({
      ...prev,
      [example.id]: state,
    }));
    setIsPickerOpen(false);
  };

  const handleTemplateFieldChange = (
    example: ExamplePayNote,
    fieldKey: string,
    fieldValue: string
  ) => {
    if (disabled || isProcessing) {
      return;
    }

    const currentState =
      exampleStates[example.id] ??
      createExampleState(example, undefined, templateContext);
    const nextState = createExampleState(
      example,
      {
        ...currentState.values,
        [fieldKey]: fieldValue,
      },
      templateContext
    );

    setExampleStates(prev => ({
      ...prev,
      [example.id]: nextState,
    }));
    handleCodeChange(nextState.encoded, { example });
  };

  const showYamlOverlay = ({
    title,
    encoded,
  }: {
    title: string;
    encoded?: string;
  }) => {
    if (!encoded) {
      setYamlPreview({
        title,
        content: '',
        error: 'No PayNote content available.',
      });
      return;
    }

    try {
      const yaml = decodePayNoteBase64AsYaml(encoded);
      setYamlPreview({
        title,
        content: yaml,
      });
    } catch (error) {
      console.error('Failed to decode example YAML:', error);
      setYamlPreview({
        title,
        content: '',
        error: 'Unable to render example YAML.',
      });
    }
  };

  const handleExamplePreview = (example: ExamplePayNote) => {
    const state =
      exampleStates[example.id] ??
      createExampleState(example, undefined, templateContext);

    if (!exampleStates[example.id]) {
      setExampleStates(prev => ({
        ...prev,
        [example.id]: state,
      }));
    }

    showYamlOverlay({
      title: example.name,
      encoded: state.encoded,
    });
  };

  const handleSelectedExamplePreview = () => {
    if (!selectedExample) {
      return;
    }

    const state =
      exampleStates[selectedExample.id] ??
      createExampleState(selectedExample, undefined, templateContext);

    showYamlOverlay({
      title: selectedExample.name,
      encoded: state.encoded,
    });
  };

  const payNotePreview = useMemo(() => {
    if (!payNoteCode || !isValidBase64(payNoteCode)) {
      return '';
    }

    return decodePayNoteBase64AsYaml(payNoteCode);
  }, [payNoteCode]);

  const selectedExampleDefaults = useMemo(
    () =>
      selectedExample
        ? getDefaultTemplateValues(selectedExample, templateContext)
        : {},
    [selectedExample, templateContext]
  );

  const selectedExampleState = selectedExample
    ? exampleStates[selectedExample.id]
    : undefined;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              id="addPayNoteSwitch"
              onClick={handleToggle}
              disabled={disabled}
              aria-pressed={enabled}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-500 ${
                enabled ? 'bg-emerald-500' : 'bg-slate-300'
              } ${disabled ? 'cursor-not-allowed opacity-75' : ''}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <label htmlFor="addPayNoteSwitch" className="text-sm font-medium">
              Add PayNote
            </label>
          </div>
          <div className="flex items-center space-x-3">
            {examples.length > 0 && (
              <button
                type="button"
                onClick={handleExampleToggle}
                className={`text-sm font-semibold text-emerald-600 transition-colors ${
                  disabled || isProcessing
                    ? 'cursor-not-allowed opacity-50'
                    : 'hover:text-emerald-700'
                }`}
                disabled={disabled || isProcessing}
              >
                {isPickerOpen ? 'Hide examples' : 'Load example PayNote'}
              </button>
            )}
            <div className="relative group">
              <HelpCircle className="h-5 w-5 text-gray-400 cursor-help" />
              <div className="absolute right-0 top-6 w-48 p-2 bg-slate-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                Add a PayNote code to include additional payment instructions or
                references
              </div>
            </div>
          </div>
        </div>

        {enabled && (
          <div className="space-y-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Enter PayNote code"
                value={payNoteCode}
                onChange={event =>
                  !disabled &&
                  !isProcessing &&
                  handleCodeChange(event.target.value)
                }
                onBlur={event =>
                  !disabled &&
                  !isProcessing &&
                  handleInputBlur(event.target.value)
                }
                disabled={disabled || isProcessing}
                className={`w-full rounded-lg border border-slate-300 p-3 pr-12 placeholder-slate-400 focus:border-transparent focus:ring-2 focus:ring-green-500 ${
                  disabled || isProcessing
                    ? 'cursor-not-allowed opacity-75'
                    : ''
                }`}
              />
              <input
                type="file"
                id="payNoteFile"
                className="hidden"
                accept={validExtensions.join(',')}
                onChange={handleFileUpload}
                disabled={isProcessing}
              />
              {isProcessing ? (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 transform">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
                </span>
              ) : (
                <CloudUpload
                  className={`absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 transform transition-colors ${
                    disabled
                      ? 'cursor-not-allowed opacity-50 text-gray-400'
                      : 'cursor-pointer hover:text-slate-600 text-gray-400'
                  }`}
                  onClick={() =>
                    !disabled && document.getElementById('payNoteFile')?.click()
                  }
                />
              )}
            </div>

            {!disabled && (
              <div
                className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                  isProcessing
                    ? 'border-emerald-500 bg-emerald-50 cursor-wait'
                    : isDragging
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-300 hover:border-slate-400'
                }`}
                onDragOver={!isProcessing ? handleDragOver : undefined}
                onDragLeave={!isProcessing ? handleDragLeave : undefined}
                onDrop={!isProcessing ? handleDrop : undefined}
                onClick={() =>
                  !isProcessing &&
                  document.getElementById('payNoteFile')?.click()
                }
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mx-auto h-8 w-8 mb-2 animate-spin text-emerald-500" />
                    <p className="text-sm font-medium text-emerald-600">
                      Processing file...
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      This may take a moment for PDF files
                    </p>
                  </>
                ) : (
                  <>
                    <CloudUpload className="mx-auto h-8 w-8 mb-2 text-gray-400" />
                    <p className="text-sm text-gray-700">
                      {isDragging
                        ? 'Drop file here'
                        : 'Drag & drop PayNote file here'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Supports {validExtensionsText}
                    </p>
                  </>
                )}
              </div>
            )}

            {(fileError || inputError) && (
              <div className="p-3 border border-red-500 bg-red-50 rounded-lg">
                <p className="text-red-500 text-sm">
                  {fileError || inputError}
                </p>
              </div>
            )}

            {isPickerOpen && examples.length > 0 && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-500 tracking-wide">
                  Example PayNotes
                </p>
                {examples.map(example => (
                  <div
                    key={example.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {example.name}
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                          {example.description}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleExamplePreview(example)}
                          className="text-xs font-semibold text-emerald-600 transition-colors hover:text-emerald-700"
                        >
                          Preview
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleExampleSelect(example)}
                        className="rounded-full border border-emerald-500 px-3 py-1 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-50"
                      >
                        Use this PayNote
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedExample &&
              selectedExample.templateFields &&
              selectedExample.templateFields.length > 0 && (
                <div className="space-y-3 rounded-lg border border-emerald-100 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                    Customize example
                  </p>
                  {selectedExample.templateFields.map(field => {
                    const currentValue =
                      selectedExampleState?.values[field.key] ??
                      selectedExampleDefaults[field.key] ??
                      '';
                    return (
                      <label key={field.key} className="block space-y-1">
                        <span className="text-xs font-semibold text-slate-600">
                          {field.label}
                        </span>
                        <input
                          type="text"
                          value={currentValue}
                          onChange={event =>
                            handleTemplateFieldChange(
                              selectedExample,
                              field.key,
                              event.target.value
                            )
                          }
                          placeholder={field.placeholder}
                          disabled={disabled || isProcessing}
                          className={`w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-transparent focus:ring-2 focus:ring-emerald-500 ${
                            disabled || isProcessing
                              ? 'cursor-not-allowed opacity-70'
                              : ''
                          }`}
                        />
                        {field.description && (
                          <span className="text-[11px] text-slate-500">
                            {field.description}
                          </span>
                        )}
                      </label>
                    );
                  })}

                  <button
                    type="button"
                    onClick={handleSelectedExamplePreview}
                    className="text-xs font-semibold text-emerald-600 transition-colors hover:text-emerald-700"
                  >
                    Preview
                  </button>
                </div>
              )}
          </div>
        )}
      </div>
      <YamlPreviewOverlay
        open={yamlPreview !== null}
        title={yamlPreview?.title}
        yaml={yamlPreview?.content ?? ''}
        error={yamlPreview?.error}
        onClose={() => setYamlPreview(null)}
      />
    </>
  );
}
