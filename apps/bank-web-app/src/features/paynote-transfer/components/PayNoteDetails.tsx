import { useMemo, useState } from 'react';
import { decodePayNoteBase64AsObject } from '../../../lib/paynote';
import { Markdown } from '../../../ui/Markdown';

interface PayNoteDetailsProps {
  payNoteCode: string;
}

export function PayNoteDetails({ payNoteCode }: PayNoteDetailsProps) {
  const [showDetails, setShowDetails] = useState(false);

  const payNote = useMemo(() => {
    return decodePayNoteBase64AsObject(payNoteCode);
  }, [payNoteCode]);

  if (!payNote) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-sm text-red-800">
          Could not parse PayNote document.
        </p>
      </div>
    );
  }

  const summary = payNote.payNoteInitialStateDescription?.summary;
  const details = payNote.payNoteInitialStateDescription?.details;

  return (
    <div className="space-y-4">
      {summary && (
        <Markdown className="prose prose-sm max-w-none text-gray-700">
          {summary}
        </Markdown>
      )}

      {details && (
        <>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center space-x-2 text-green-600 hover:text-green-700 transition-colors font-medium text-sm"
          >
            <svg
              className={`w-4 h-4 transition-transform ${
                showDetails ? 'transform rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
            <span>{showDetails ? 'Hide details' : 'View details'}</span>
          </button>

          {showDetails && (
            <Markdown className="prose prose-sm max-w-none text-gray-700 p-4 bg-gray-50 rounded-lg border border-gray-200">
              {details}
            </Markdown>
          )}
        </>
      )}
    </div>
  );
}
