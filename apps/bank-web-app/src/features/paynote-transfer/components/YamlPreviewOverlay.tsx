import { useEffect } from 'react';
import { X } from 'lucide-react';

interface YamlPreviewOverlayProps {
  open: boolean;
  yaml: string;
  title?: string;
  error?: string | null;
  onClose: () => void;
}

export function YamlPreviewOverlay({
  open,
  yaml,
  title = 'PayNote Preview',
  error = null,
  onClose,
}: YamlPreviewOverlayProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-white/95 px-4 py-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-lg bg-white shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="rounded-full p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4">
          {yaml ? (
            <pre className="max-h-[70vh] overflow-auto rounded-lg bg-white p-4 text-xs leading-relaxed ">
              {yaml}
            </pre>
          ) : (
            <p className="text-sm text-gray-700">
              {error ?? 'PayNote content unavailable.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
