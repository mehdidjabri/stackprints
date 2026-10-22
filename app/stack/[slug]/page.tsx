import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StackView } from "@/components/StackView";
import { Title } from "@/components/Title";
import { SITE, getStack, getStacks, resolve } from "@/lib/data";
import { JsonLd } from "@/lib/jsonld";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export const generateStaticParams = () => getStacks().map((s) => ({ slug: s.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = getStack((await params).slug);
  if (!s) return {};
  const title = `${s.name} agent stack`;
  const description = `${s.tagline} ${s.description}`.slice(0, 300);
  return {
    title,
    description,
    alternates: { canonical: `/stack/${s.slug}/` },
    openGraph: { title: `Agentic Stack / ${s.name}`, description, url: `/stack/${s.slug}/` },
    twitter: { title: `Agentic Stack / ${s.name}`, description },
  };
}

export default async function StackPage({ params }: Props) {
  const s = getStack((await params).slug);
  if (!s) notFound();
  const rows = resolve(s);
  const similar = getStacks().filter((x) => x.kind === s.kind && x.slug !== s.slug);

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "TechArticle",
              headline: `${s.name} agent stack`,
              ...(s.author ? { author: { "@type": "Person", name: s.author.name, ...(s.author.url ? { url: s.author.url } : {}) } } : {}),
              description: s.description,
              url: `${SITE.url}/stack/${s.slug}/`,
              about: rows.flatMap((r) => r.picks.map((p) => ({ "@type": "Thing", name: p.name, ...(p.url ? { url: `https://${p.url}` } : {}) }))),
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Agentic Stack", item: `${SITE.url}/` },
                { "@type": "ListItem", position: 2, name: s.name, item: `${SITE.url}/stack/${s.slug}/` },
              ],
            },
          ],
        }}
      />
      <Title detail={s.name} />
      <div className="meta-line">
        <span>{s.kind}</span>
        <span className="muted"> · {rows.length} layers</span>
        {s.author && (
          <>
            <span className="muted"> · by </span>
            {s.author.url ? (
              <a href={s.author.url} rel="noopener nofollow">
                {s.author.name}
              </a>
            ) : (
              s.author.name
            )}
          </>
        )}
        {s.source && (
          <>
            <span className="muted"> · </span>
            <a href={`https://${s.source}`} rel="noopener">
              {s.source}
            </a>
          </>
        )}
      </div>
      <p className="lede">{s.description}</p>
      <div className="toolbar">
        <Link className="btn" href={`/#from=${s.slug}`}>
          Remix this stack
        </Link>
        <a className="btn" href={`${SITE.repo}/edit/main/content/stacks/${s.slug}.json`} rel="noopener">
          Edit on GitHub
        </a>
      </div>
      <StackView rows={rows} label={`AS-${String(getStacks().indexOf(s) + 1).padStart(2, "0")} · ${s.name.toUpperCase()} · REV 1`} />

      <div className="prose">
        <h2>Layer by layer</h2>
        <dl>
          {rows.map(({ layer, picks }) => (
            <div key={layer.id} style={{ marginBottom: 12 }}>
              <dt>
                <Link href={`/layer/${layer.id}/`}>
                  <strong>{layer.name}</strong>
                </Link>
              </dt>
              <dd style={{ margin: 0 }} className="muted">
                {picks.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ", "}
                    {p.name}
                    {p.note && ` (${p.note.toLowerCase()})`}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {similar.length > 0 && (
        <>
          <div className="section-head">
            <h2>More {s.kind.toLowerCase()} stacks</h2>
          </div>
          <div className="filters">
            {similar.map((x) => (
              <Link key={x.slug} href={`/stack/${x.slug}/`}>
                {x.name}
              </Link>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
