import { ChangeEvent, useEffect, useState } from 'react';
import { CloudUpload, HelpCircle, Loader2 } from 'lucide-react';
import {
  encodeObjectAsPayNoteBase64,
  parsePayNoteFile,
  isValidBase64,
} from '../../../lib/paynote';

interface PayNoteCodeInputProps {
  enabled: boolean;
  value?: string;
  onChange?: (value: string) => void;
  onToggle?: (enabled: boolean) => void;
  disabled?: boolean;
}

export function PayNoteCodeInput({
  enabled,
  value = '',
  onChange,
  onToggle,
  disabled = false,
}: PayNoteCodeInputProps) {
  const [payNoteCode, setPayNoteCode] = useState(value);
  const [fileError, setFileError] = useState('');
  const [inputError, setInputError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleCodeChange = (newValue: string) => {
    setInputError(''); // Clear error on typing
    setPayNoteCode(newValue);
    onChange?.(newValue); // Always call onChange to update parent state
  };

  const handleInputBlur = (value: string) => {
    if (value && !isValidBase64(value)) {
      setInputError(
        'Invalid PayNote code format. Please enter valid base64 text.'
      );
    } else {
      setInputError('');
      onChange?.(value);
    }
  };

  const validExtensions = ['.yml', '.yaml', '.json', '.txt', '.pdf'];
  const validExtensionsText = validExtensions.join(', ');

  useEffect(() => {
    setPayNoteCode(value);
  }, [value]);

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
        handleCodeChange(base64Content);
      }
    } catch (error) {
      console.error('Error parsing file:', error);
      setFileError(
        `Error processing file: Invalid ${file.name
          .split('.')
          .pop()
          ?.toUpperCase()} format`
      );
      handleCodeChange('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // Reset the input value to allow selecting the same file again
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
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
    }
  };

  const handleToggle = () => {
    if (disabled) {
      return;
    }

    const next = !enabled;
    if (!next) {
      handleCodeChange('');
    }
    onToggle?.(next);
  };

  return (
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
        <div className="relative group">
          <HelpCircle className="h-5 w-5 text-gray-400 cursor-help" />
          <div className="absolute right-0 top-6 w-48 p-2 bg-slate-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
            Add a PayNote code to include additional payment instructions or
            references
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
              onChange={e =>
                !disabled && !isProcessing && handleCodeChange(e.target.value)
              }
              onBlur={e =>
                !disabled && !isProcessing && handleInputBlur(e.target.value)
              }
              disabled={disabled || isProcessing}
              className={`w-full rounded-lg border border-slate-300 p-3 pr-12 placeholder-slate-400 focus:border-transparent focus:ring-2 focus:ring-green-500 ${
                disabled || isProcessing ? 'cursor-not-allowed opacity-75' : ''
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
              <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 transform animate-spin text-emerald-500" />
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
                !isProcessing && document.getElementById('payNoteFile')?.click()
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
              <p className="text-red-500 text-sm">{fileError || inputError}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
