import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StackView } from "@/components/StackView";
import { Title } from "@/components/Title";
import { SITE, affiliated, getLayers, getStack, getStacks, resolve } from "@/lib/data";
import { EMPTY, disclosureMark, disclosureOf, emptyLayers, isSupported, slotsNote } from "@/lib/disclosure";
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
  const badge = disclosureOf(s);
  // Empty layers split by meaning: not disclosed (hatched), in use but unnamed ("?"), not used (dashed).
  const empty = emptyLayers(s, getLayers());
  const unknowable = empty.unknown.length + empty.present.length > 0;
  const own = affiliated(s);
  // Sources are numbered; evidence URLs not in the list get appended so every citation resolves.
  const sources = [...(s.sources ?? [])];
  for (const u of Object.values(s.evidence ?? {}).flat())
    if (!sources.some((x) => x.url === u)) sources.push({ title: prettyUrl(u), url: u });
  const cite = (u: string) => sources.findIndex((x) => x.url === u) + 1;
  const cites = (layerId: string) =>
    (s.evidence?.[layerId] ?? []).map((u) => (
      <a key={u} className="cite" href={u} rel="noopener" title={sources.find((x) => x.url === u)?.title ?? u}>
        [{cite(u)}]
      </a>
    ));
  // A kind made only of example designs says so in the menu, as each example does.
  const kindHint = (k: string) => {
    const xs = all.filter((x) => x.kind === k);
    return xs.every((x) => x.disclosure === "example") ? `${xs.length} example${xs.length > 1 ? "s" : ""}` : String(xs.length);
  };

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
              hint: kindHint(k),
            })),
          },
          {
            label: s.name,
            logo: s.logo,
            items: all
              .filter((x) => x.kind === s.kind)
              .map((x) => ({ label: x.name, href: `/stack/${x.slug}/`, current: x.slug === s.slug, logo: x.logo, hint: disclosureMark(x) ?? undefined })),
          },
        ]}
      />
      <div className="meta-line">
        {badge && (
          <span className="tag disclosure" title={badge.about}>
            {badge.badge}
          </span>
        )}
        <span>
          {rows.length} {unknowable ? "known layers" : "layers"}
          {empty.present.length > 0 && ` · ${empty.present.length} in use, undisclosed`}
          {empty.unknown.length > 0 && ` · ${empty.unknown.length} ${EMPTY.unknown.toLowerCase()}`}
          {empty.unused.length > 0 && ` · ${empty.unused.length} ${EMPTY.unused.toLowerCase()}`}
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
      {badge && (
        <p className="muted small reading">
          {badge.about}
          {s.researched ? `, ${d === "example" ? "checked" : "researched"} ${s.researched}` : ""}. {slotsNote(empty)}{" "}
          <Link href="/about/#disclosure">How to read a stack</Link>
        </p>
      )}
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
          {rows.map(({ layer, picks: all }) => {
            // What the stack runs, then what it only supports, said once.
            const picks = all.filter((p) => !isSupported(s, layer.id, p.id));
            const extra = all.filter((p) => isSupported(s, layer.id, p.id));
            return (
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
                  {extra.length > 0 && `${picks.length ? "; also supports " : "Supports "}${extra.map((p) => p.name).join(", ")}`}
                  {cites(layer.id)}
                </dd>
              </div>
            );
          })}
        </dl>
        {empty.present.length > 0 && (
          <p className="muted">
            <strong>In use, not disclosed:</strong>{" "}
            {empty.present.map((l, i) => (
              <span key={l.id}>
                {i > 0 && ", "}
                {l.name}
                {cites(l.id)}
              </span>
            ))}
            .
          </p>
        )}
        {empty.unknown.length > 0 && (
          <p className="muted">
            <strong>{EMPTY.unknown}:</strong> {empty.unknown.map((l) => l.name).join(", ")}.
          </p>
        )}
        {empty.unused.length > 0 && (
          <p className="muted">
            <strong>{EMPTY.unused}:</strong> {empty.unused.map((l) => l.name).join(", ")}.
          </p>
        )}
        {own.length > 0 && (
          <p className="muted">
            <strong>Disclosure:</strong> this {d === "example" ? "example" : "stack"} uses {own.map((o) => o.name).join(", ")}.{" "}
            {[...new Set(own.map((o) => o.affiliation))].join(" ")} <Link href="/about/#affiliation">About</Link>
          </p>
        )}

        {sources.length > 0 && (
          <>
            {/* An example cites no evidence: its list is reading on the parts it hinges on. */}
            <h2>{d === "example" ? "Further reading" : "Sources"}</h2>
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
