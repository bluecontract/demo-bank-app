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
  const showActions = Boolean(onRegenerate) || Boolean(summaryModel);
  const story = summary?.story;
  const nextSteps = summary?.nextSteps;
  const lastChange = summary?.lastChange;
  const storyHeadline = story?.headline?.trim() || '';
  const storyOverview = story?.overview ?? [];
  const storyBullets = story?.bullets ?? [];
  const nextStepItems = nextSteps?.items ?? [];
  const nextStepsTitle = nextSteps?.title ?? 'Next steps';
  const lastChangeShort = lastChange?.short?.trim() || '';
  const hasSummaryContent =
    storyHeadline.length > 0 ||
    storyOverview.length > 0 ||
    storyBullets.length > 0 ||
    nextStepItems.length > 0 ||
    lastChangeShort.length > 0;
  const showSummary = Boolean(summary) && hasSummaryContent;

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

        {showSummary ? (
          <div className="space-y-4 text-sm text-slate-700">
            <div>
              <p className="text-lg font-semibold text-slate-900">
                {storyHeadline || title}
              </p>
              {storyOverview.map((paragraph, index) => (
                <p
                  key={`${storyHeadline || title}-${index}`}
                  className="mt-1 whitespace-pre-line break-words text-slate-600 leading-relaxed"
                >
                  {paragraph}
                </p>
              ))}
            </div>

            {storyBullets.length ? (
              <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Highlights
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {storyBullets.map(bullet => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {lastChangeShort && (
              <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Latest update
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {lastChangeShort}
                </p>
              </div>
            )}

            {nextStepItems.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {nextStepsTitle}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {nextStepItems.map(step => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
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
