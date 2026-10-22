import Link from "next/link";

export type CrumbItem = { label: string; href: string; current?: boolean; hint?: string };
export type Crumb = { label: string; href?: string; items?: CrumbItem[] };

/**
 * "Agentic Stack / Category / Name". Crumbs with items are dropdowns built on <details>,
 * so they work without JavaScript and their links stay crawlable.
 */
export function Title({ detail, crumbs }: { detail?: string; crumbs?: Crumb[] }) {
  const list = crumbs ?? (detail ? [{ label: detail }] : []);
  return (
    <nav className="title" aria-label="Breadcrumb">
      <Link href="/" className="crumb">
        Agentic Stack
      </Link>
      {list.map((c, n) => {
        // Only the last crumb is the page heading; menus stay outside it.
        const label = n === list.length - 1 ? <h1>{c.label}</h1> : c.label;
        return (
        <span key={c.label} style={{ display: "contents" }}>
          <span className="slash" aria-hidden="true">
            /
          </span>
          {c.items ? (
            <details className="dd crumb">
              <summary>{label}</summary>
              <ul className="dd-menu">
                {c.items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} aria-current={i.current ? "true" : undefined}>
                      <span>{i.label}</span>
                      {i.hint && <small>{i.hint}</small>}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ) : c.href ? (
            <Link href={c.href} className="crumb">
              {label}
            </Link>
          ) : (
            <span className="crumb">{label}</span>
          )}
        </span>
        );
      })}
    </nav>
  );
}
