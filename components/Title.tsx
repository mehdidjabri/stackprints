import Link from "next/link";
import { Logo } from "./Logo";

export type CrumbItem = { label: string; href: string; current?: boolean; hint?: string; logo?: string };
export type Crumb = { label: string; href?: string; items?: CrumbItem[]; logo?: string };

/**
 * "Category / Name". Crumbs with items are dropdowns built on <details>,
 * so they work without JavaScript and their links stay crawlable.
 */
export function Title({ detail, crumbs }: { detail?: string; crumbs?: Crumb[] }) {
  const list = crumbs ?? (detail ? [{ label: detail }] : []);
  return (
    <nav className="title" aria-label="Breadcrumb">
      {list.map((c, n) => {
        // Only the last crumb is the page heading; menus stay outside it.
        const text = n === list.length - 1 ? <h1>{c.label}</h1> : c.label;
        const label = c.logo ? (
          <>
            <Logo option={{ name: c.label, logo: c.logo }} />
            {text}
          </>
        ) : (
          text
        );
        return (
        <span key={c.label} style={{ display: "contents" }}>
          {n > 0 && (
            <span className="slash" aria-hidden="true">
              /
            </span>
          )}
          {c.items ? (
            <details className={n === list.length - 1 ? "dd crumb current" : "dd crumb"}>
              <summary>{label}</summary>
              <ul className="dd-menu">
                {c.items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} aria-current={i.current ? "true" : undefined}>
                      <span className="dd-item">
                        {i.logo && <Logo option={{ name: i.label, logo: i.logo }} />}
                        {i.label}
                      </span>
                      {i.hint && <small>{i.hint}</small>}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ) : c.href ? (
            <Link href={c.href} className={n === list.length - 1 ? "crumb current" : "crumb"}>
              {label}
            </Link>
          ) : (
            <span className={n === list.length - 1 ? "crumb current" : "crumb"}>{label}</span>
          )}
        </span>
        );
      })}
    </nav>
  );
}
