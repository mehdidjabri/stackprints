import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Title } from "@/components/Title";
import { SITE, getLayer, getLayers, usedBy } from "@/lib/data";
import { JsonLd } from "@/lib/jsonld";

type Props = { params: Promise<{ id: string }> };

export const dynamicParams = false;
export const generateStaticParams = () => getLayers().map((l) => ({ id: l.id }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = getLayer((await params).id);
  if (!l) return {};
  const names = l.options.slice(0, 6).map((o) => o.name).join(", ");
  const description = `${l.description} Options: ${names} and more.`;
  return {
    title: `${l.name} for AI agents`,
    description,
    alternates: { canonical: `/layer/${l.id}/` },
    openGraph: { title: `Agentic Stack / ${l.name}`, description, url: `/layer/${l.id}/`, images: "/opengraph-image" },
  };
}

export default async function LayerPage({ params }: Props) {
  const l = getLayer((await params).id);
  if (!l) notFound();
  const all = getLayers();
  const i = all.indexOf(l);
  const prev = all[i - 1];
  const next = all[i + 1];

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${l.name} options for AI agents`,
          url: `${SITE.url}/layer/${l.id}/`,
          itemListElement: l.options.map((o, n) => ({
            "@type": "ListItem",
            position: n + 1,
            name: o.name,
            ...(o.url ? { url: `https://${o.url}` } : {}),
          })),
        }}
      />
      <Title detail={l.name} />
      <div className="meta-line">
        <span className="muted">
          {l.band} · {l.options.length} options
        </span>
      </div>
      <p className="lede">{l.description}</p>

      <div className="options">
        {l.options.map((o) => {
          const users = usedBy(l.id, o.id);
          return (
            <div key={o.id} className="opt" id={o.id}>
              <div className="opt-name">
                {o.url ? (
                  <a href={`https://${o.url}`} rel="noopener">
                    {o.name}
                  </a>
                ) : (
                  o.name
                )}
                {o.open && <span className="tag">open</span>}
              </div>
              <div className="opt-note">{o.note}</div>
              <div className="opt-used">
                {users.map((u, n) => (
                  <span key={u.slug}>
                    {n > 0 && ", "}
                    <Link href={`/stack/${u.slug}/`}>{u.name}</Link>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="toolbar" style={{ marginTop: 24 }}>
        {prev && (
          <Link className="btn" href={`/layer/${prev.id}/`}>
            ← {prev.name}
          </Link>
        )}
        {next && (
          <Link className="btn" href={`/layer/${next.id}/`}>
            {next.name} →
          </Link>
        )}
        <a className="btn" href={`${SITE.repo}/edit/main/content/layers.json`} rel="noopener">
          Add an option
        </a>
      </div>
    </article>
  );
}
