import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Title } from "@/components/Title";
import { BANDS } from "@/lib/bands";
import { SITE, getLayer, getLayers, usage } from "@/lib/data";
import { JsonLd } from "@/lib/jsonld";
import { optionHref, withMarkdown } from "@/lib/links";

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
    alternates: withMarkdown(`/layer/${l.id}/`),
    openGraph: { type: "website", title: `Agentic Stack / ${l.name}`, description, url: `/layer/${l.id}/`, images: "/opengraph-image" },
  };
}

export default async function LayerPage({ params }: Props) {
  const l = getLayer((await params).id);
  if (!l) notFound();
  const all = getLayers();
  const i = all.indexOf(l);
  const prev = all[i - 1];
  const next = all[i + 1];
  const band = BANDS.find(([b]) => b === l.band)![1];

  return (
    <article className={`b-${l.band}`}>
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
            url: `${SITE.url}${optionHref(l.id, o.id)}`,
          })),
        }}
      />
      <Title
        crumbs={[
          {
            label: band,
            items: BANDS.map(([b, name]) => ({
              label: name,
              href: `/layer/${all.find((x) => x.band === b)!.id}/`,
              current: b === l.band,
            })),
          },
          {
            label: l.name,
            items: all
              .filter((x) => x.band === l.band)
              .map((x) => ({ label: x.name, href: `/layer/${x.id}/`, current: x.id === l.id, hint: String(x.options.length) })),
          },
        ]}
      />
      <div className="meta-line">
        <span>{l.options.length} options</span>
      </div>
      <p className="lede">{l.description}</p>

      <div className="options">
        {l.options.map((o) => {
          const { stacks, examples } = usage(l.id, o.id);
          const links = (list: typeof stacks) =>
            list.map((u, n) => (
              <span key={u.slug}>
                {n > 0 && ", "}
                <Link href={`/stack/${u.slug}/`}>{u.name}</Link>
              </span>
            ));
          return (
            <div key={o.id} className="opt" id={o.id}>
              <div className="opt-name">
                <Link href={optionHref(l.id, o.id)}>{o.name}</Link>
                {o.open && <span className="tag">open</span>}
              </div>
              <div className="opt-note">
                {o.note}
                {o.affiliation && (
                  <span className="opt-aff">
                    Disclosure: {o.affiliation} <Link href="/about/#affiliation">About</Link>
                  </span>
                )}
              </div>
              {/* Real stacks first; example designs are the site's own, so they're named as such. */}
              <div className="opt-used">
                {links(stacks)}
                {examples.length > 0 && (
                  <>
                    {stacks.length > 0 && " · "}
                    <span title="Example designs written for this site, not products">examples: </span>
                    {links(examples)}
                  </>
                )}
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
