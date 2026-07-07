/**
 * Renders unified-diff text as coloured lines (add / del / hunk / context),
 * matching the mockup's inline diff. Pure — text is fetched by the parent.
 */

import type { JSX } from 'react';

type LineKind = 'add' | 'del' | 'hunk' | 'ctx';

function classify(line: string): LineKind {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'ctx';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

export function DiffView({ text }: { text: string }): JSX.Element {
  if (!text.trim()) {
    return <div className="diff-empty">No differences to show.</div>;
  }
  const lines = text.replace(/\n$/, '').split('\n');
  return (
    <div className="diff-body">
      {lines.map((line, i) => {
        const kind = classify(line);
        return (
          <div key={i} className={`dline ${kind}`}>
            {line === '' ? ' ' : line}
          </div>
        );
      })}
    </div>
  );
}
