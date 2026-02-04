import { formatYaml, restoreInlineTypes } from '../lib/contractDocumentUtils';

interface ContractRawDocumentProps {
  document: unknown;
  emptyLabel?: string;
}

export function ContractRawDocument({
  document,
  emptyLabel = 'Contract document not available.',
}: ContractRawDocumentProps) {
  const restoredDocument = restoreInlineTypes(document);
  const documentYaml = formatYaml(restoredDocument);

  if (!documentYaml) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <pre className="bg-slate-900/95 text-emerald-100 text-xs rounded-xl p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
      <code>{documentYaml}</code>
    </pre>
  );
}
