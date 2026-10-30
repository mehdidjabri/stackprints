/**
 * A section folded to one row: its name, and a hint of what's inside. Open, it is the section.
 * The name stays a heading, so the page reads the same to a screen reader or a search engine.
 */
export function Fold({ id, title, hint, className, children }: { id: string; title: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <details className="fold" id={id}>
      <summary>
        <h2>{title}</h2>
        {hint && <span className="fold-hint">{hint}</span>}
      </summary>
      <div className={className ? `fold-body ${className}` : "fold-body"}>{children}</div>
    </details>
  );
}
