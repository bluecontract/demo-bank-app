import { useEffect, useState } from 'react';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import type { ContractDocumentSummary } from '../../../types/api';

interface SummaryPanelProps {
  title: string;
  summary?: ContractDocumentSummary | null;
  summaryModel?: string | null;
  summaryErrorMessage?: string | null;
  isLoading?: boolean;
  isFetching?: boolean;
  fallbackText?: string;
  onRegenerate?: () => void;
  regenerateDisabled?: boolean;
  isRegeneratePending?: boolean;
  regenerateLabel?: string;
  regeneratePendingLabel?: string;
  loadingLabel?: string;
  fetchingLabel?: string;
}

export function SummaryPanel({
  title,
  summary,
  summaryModel,
  summaryErrorMessage,
  isLoading = false,
  isFetching = false,
  fallbackText,
  onRegenerate,
  regenerateDisabled = false,
  isRegeneratePending = false,
  regenerateLabel = 'Regenerate',
  regeneratePendingLabel = 'Regenerating...',
  loadingLabel = 'Generating summary...',
  fetchingLabel = 'Updating summary...',
}: SummaryPanelProps) {
  const [isKeyFactsExpanded, setIsKeyFactsExpanded] = useState(false);

  useEffect(() => {
    setIsKeyFactsExpanded(false);
  }, [summary?.title]);

  const showActions = Boolean(onRegenerate) || Boolean(summaryModel);

  return (
    <section className="border border-slate-200 rounded-2xl overflow-hidden bg-white/70">
      <header className="px-4 py-3 border-b border-slate-200 bg-white/80">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </header>
      <div className="p-4">
        {isLoading && !summary && (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500">
            <Spinner size="sm" color="green" />
            {loadingLabel}
          </div>
        )}

        {isFetching && summary && (
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
            <Spinner size="sm" color="green" />
            {fetchingLabel}
          </div>
        )}

        {summaryErrorMessage && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700">
            {summaryErrorMessage}
          </div>
        )}

        {summary ? (
          <div className="space-y-4 text-sm text-slate-700">
            <div>
              <p className="text-lg font-semibold text-slate-900">
                {summary.title}
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-slate-600 leading-relaxed">
                {summary.oneLiner}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Current state
              </p>
              <p className="mt-2 font-semibold text-slate-900">
                {summary.state.statusLabel}
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-slate-600 leading-relaxed">
                {summary.state.explanation}
              </p>
            </div>

            {summary.keyFacts.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Key facts
                  </p>
                  <button
                    type="button"
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                    onClick={() => setIsKeyFactsExpanded(prev => !prev)}
                    aria-expanded={isKeyFactsExpanded}
                  >
                    {isKeyFactsExpanded ? 'Hide' : 'Show'} (
                    {summary.keyFacts.length})
                  </button>
                </div>

                {isKeyFactsExpanded ? (
                  <dl className="mt-3 divide-y divide-slate-200/70">
                    {summary.keyFacts.map(fact => (
                      <div
                        key={`${fact.label}:${fact.value}`}
                        className="py-3 first:pt-0 last:pb-0"
                      >
                        <dt className="text-xs font-medium text-slate-500">
                          {fact.label}
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words font-medium text-slate-900">
                          {fact.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Key information about this document (participants, amounts,
                    statuses, and identifiers).
                  </p>
                )}
              </div>
            )}

            {summary.warnings?.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-700">
                  Notes
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {summary.warnings.map(warning => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : !isLoading ? (
          <p className="text-sm text-slate-700 leading-relaxed">
            {fallbackText ?? 'Summary unavailable.'}
          </p>
        ) : null}

        {showActions && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {onRegenerate && (
              <Button
                variant="secondary"
                size="sm"
                disabled={regenerateDisabled || isRegeneratePending}
                onClick={onRegenerate}
              >
                {isRegeneratePending ? regeneratePendingLabel : regenerateLabel}
              </Button>
            )}
            {summaryModel && (
              <span className="text-xs text-slate-500">
                Model: {summaryModel}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
