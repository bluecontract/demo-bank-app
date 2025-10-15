import ReactMarkdown, { Components } from 'react-markdown';

interface MarkdownProps {
  children: string;
  className?: string;
}

export const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-bold mb-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-bold mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-bold mb-2">{children}</h3>,
  h4: ({ children }) => (
    <h4 className="text-base font-bold mb-2">{children}</h4>
  ),
  h5: ({ children }) => <h5 className="text-sm font-bold mb-2">{children}</h5>,
  h6: ({ children }) => <h6 className="text-xs font-bold mb-2">{children}</h6>,
  p: ({ children }) => <p className="mb-2">{children}</p>,
  ul: ({ children }) => <ul className="list-disc ml-6 mb-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal ml-6 mb-2">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-green-600 hover:text-green-700 cursor-pointer"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

export function Markdown({
  children,
  className = '',
}: Readonly<MarkdownProps>) {
  return (
    <div className={className}>
      <ReactMarkdown components={markdownComponents}>{children}</ReactMarkdown>
    </div>
  );
}
