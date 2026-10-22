import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StackView } from "@/components/StackView";
import { Title } from "@/components/Title";
import { SITE, getLayers, getStack, getStacks, resolve } from "@/lib/data";
import { DISCLOSURE, unknownLabel } from "@/lib/disclosure";
import { JsonLd } from "@/lib/jsonld";
import { primaryLink, prettyUrl, withMarkdown } from "@/lib/links";

type Props = { params: Promise<{ slug: string }> };

const LINKS = [
  ["site", "Website"],
  ["announcement", "Announcement"],
  ["repo", "Source"],
  ["docs", "Docs"],
] as const;

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
    alternates: withMarkdown(`/stack/${s.slug}/`),
    openGraph: { type: "article", title: `Agentic Stack / ${s.name}`, description, url: `/stack/${s.slug}/` },
    twitter: { title: `Agentic Stack / ${s.name}`, description },
  };
}

export default async function StackPage({ params }: Props) {
  const s = getStack((await params).slug);
  if (!s) notFound();
  const rows = resolve(s);
  const all = getStacks();
  const kinds = [...new Set(all.map((x) => x.kind))].sort();
  const similar = all.filter((x) => x.kind === s.kind && x.slug !== s.slug);
  const site = primaryLink(s.links);
  const d = s.disclosure;
  const unk = unknownLabel(d);
  const layers = getLayers();
  const notUsed = layers.filter((l) => s.notUsed?.includes(l.id));
  const missing = layers.filter((l) => !(l.id in s.layers) && !s.notUsed?.includes(l.id));
  // Sources are numbered; evidence URLs not in the list get appended so every citation resolves.
  const sources = [...(s.sources ?? [])];
  for (const u of Object.values(s.evidence ?? {}).flat())
    if (!sources.some((x) => x.url === u)) sources.push({ title: prettyUrl(u), url: u });
  const cite = (u: string) => sources.findIndex((x) => x.url === u) + 1;

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
              ...(sources.length ? { citation: sources.map((x) => ({ "@type": "CreativeWork", name: x.title, url: x.url })) } : {}),
              ...(site
                ? { mainEntity: { "@type": "SoftwareApplication", name: s.name, url: site, sameAs: Object.values(s.links ?? {}) } }
                : {}),
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
      <Title
        crumbs={[
          {
            label: s.kind,
            items: kinds.map((k) => ({
              label: k,
              href: `/stack/${all.find((x) => x.kind === k)!.slug}/`,
              current: k === s.kind,
              hint: String(all.filter((x) => x.kind === k).length),
            })),
          },
          {
            label: s.name,
            logo: s.logo,
            items: all
              .filter((x) => x.kind === s.kind)
              .map((x) => ({ label: x.name, href: `/stack/${x.slug}/`, current: x.slug === s.slug, logo: x.logo })),
          },
        ]}
      />
      <div className="meta-line">
        {d && (
          <span className="tag disclosure" title={DISCLOSURE[d].about}>
            {DISCLOSURE[d].badge}
          </span>
        )}
        <span>
          {rows.length} {unk ? "known layers" : "layers"}
          {unk && missing.length > 0 && ` · ${missing.length} ${unk.toLowerCase()}`}
        </span>
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
        {site && (
          <>
            <span className="muted"> · </span>
            <a href={site} rel="noopener">
              {prettyUrl(site)} ↗
            </a>
          </>
        )}
      </div>
      <p className="lede">{s.description}</p>
      <div className="toolbar">
        {LINKS.filter(([k]) => s.links?.[k]).map(([k, label]) => (
          <a key={k} className="btn" href={s.links![k]} rel="noopener">
            {label} ↗
          </a>
        ))}
        <Link className="btn" href={`/#from=${s.slug}`}>
          Remix this stack
        </Link>
        <a className="btn" href={`${SITE.repo}/edit/main/content/stacks/${s.slug}.json`} rel="noopener">
          Edit on GitHub
        </a>
      </div>
      <StackView rows={rows} stack={s} label={`AS-${String(getStacks().indexOf(s) + 1).padStart(2, "0")} · ${s.name.toUpperCase()} · REV 1`} />

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
                {(s.evidence?.[layer.id] ?? []).map((u) => (
                  <a key={u} className="cite" href={u} rel="noopener" title={sources.find((x) => x.url === u)?.title ?? u}>
                    [{cite(u)}]
                  </a>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        {unk && missing.length > 0 && (
          <p className="muted">
            <strong>{unk}:</strong> {missing.map((l) => l.name).join(", ")}.
          </p>
        )}
        {notUsed.length > 0 && (
          <p className="muted">
            <strong>Not used:</strong> {notUsed.map((l) => l.name).join(", ")}.
          </p>
        )}
        {d && (
          <p className="muted small">
            {DISCLOSURE[d].about}
            {s.researched ? `, researched ${s.researched}` : ""}.
          </p>
        )}

        {sources.length > 0 && (
          <>
            <h2>Sources</h2>
            <ol className="sources">
              {sources.map((src) => (
                <li key={src.url}>
                  <a href={src.url} rel="noopener">
                    {src.title}
                  </a>
                  <span className="muted"> · {prettyUrl(src.url)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
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
