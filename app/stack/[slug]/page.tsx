import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StackView } from "@/components/StackView";
import { Title } from "@/components/Title";
import { SITE, affiliated, asArray, getLayers, getStack, getStacks, metaDesc, resolve, stackTitle } from "@/lib/data";
import { EMPTY, disclosureMark, disclosureOf, emptyLayers, isSupported, kindCount, slotsNote } from "@/lib/disclosure";
import { JsonLd } from "@/lib/jsonld";
import { bareUrl, citeNumbers, kindHref, optionHref, primaryLink, prettyUrl, stackSources, withMarkdown } from "@/lib/links";

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
  const description = metaDesc(`${s.tagline} ${s.description}`);
  return {
    title: stackTitle(s),
    description,
    alternates: withMarkdown(`/stack/${s.slug}/`),
    openGraph: { type: "article", title: `Agentic Stack / ${s.name}`, description, url: `/stack/${s.slug}/` },
    // The stack's own board image (opengraph-image.tsx) is picked up; this makes it the large card.
    twitter: { card: "summary_large_image", title: `Agentic Stack / ${s.name}`, description },
  };
}

export default async function StackPage({ params }: Props) {
  const s = getStack((await params).slug);
  if (!s) notFound();
  const rows = resolve(s);
  const all = getStacks();
  const kinds = [...new Set(all.map((x) => x.kind))].sort();
  // Similar stacks: the same kind first, then, up to four, the stacks sharing the most parts with this one.
  const picks = (x: typeof s) => Object.entries(x.layers).flatMap(([l, v]) => asArray(v).map((id) => `${l}/${id}`));
  const mine = new Set(picks(s));
  const shared = (x: typeof s) => picks(x).filter((p) => mine.has(p)).length;
  const sameKind = all.filter((x) => x.kind === s.kind && x.slug !== s.slug);
  const nearest = all
    .filter((x) => x.kind !== s.kind && shared(x) > 0)
    .sort((a, b) => shared(b) - shared(a) || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, 4 - sameKind.length));
  const similar = [...sameKind, ...nearest];
  const site = primaryLink(s.links);
  const d = s.disclosure;
  const badge = disclosureOf(s);
  // Empty layers split by meaning: not disclosed (hatched), in use but unnamed ("?"), not used (dashed).
  const empty = emptyLayers(s, getLayers());
  const unknowable = empty.unknown.length + empty.present.length > 0;
  const own = affiliated(s);
  // Sources are numbered the same on the page, in markdown and in the API (evidence URLs appended).
  const sources = stackSources(s);
  // Evidence is per layer, so citations are too, in source order. Each goes to its entry in the
  // numbered list below, which links out; its name says which source it is.
  const cites = (layerId: string) =>
    citeNumbers(sources, s.evidence?.[layerId]).map((n) => (
      <a key={n} className="cite" href={`#src-${n}`} aria-label={`Source ${n}: ${sources[n - 1].title}`} title={sources[n - 1].title}>
        [{n}]
      </a>
    ));
  const cited = Object.keys(s.evidence ?? {}).length > 0;
  const kindHint = (k: string) => kindCount(all.filter((x) => x.kind === k));

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "TechArticle",
              headline: stackTitle(s),
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
                { "@type": "ListItem", position: 2, name: s.kind, item: `${SITE.url}${kindHref(s.kind)}` },
                { "@type": "ListItem", position: 3, name: s.name, item: `${SITE.url}/stack/${s.slug}/` },
              ],
            },
          ],
        }}
      />
      <Title
        crumbs={[
          {
            label: s.kind,
            items: kinds.map((k) => ({ label: k, href: kindHref(k), current: k === s.kind, hint: kindHint(k) })),
          },
          {
            // Every stack, grouped by kind, this one's kind first.
            label: s.name,
            logo: s.logo,
            items: [s.kind, ...kinds.filter((k) => k !== s.kind)].flatMap((k) =>
              all
                .filter((x) => x.kind === k)
                .map((x) => ({
                  label: x.name,
                  href: `/stack/${x.slug}/`,
                  current: x.slug === s.slug,
                  logo: x.logo,
                  hint: disclosureMark(x) ?? undefined,
                  group: k,
                })),
            ),
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
          {s.researched ? `, ${d === "example" ? "checked" : "researched"} ${s.researched}` : ""}
          {s.version ? ` against ${s.version}` : ""}. {slotsNote(empty)}{" "}
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
        <a className="btn" href="#layers">
          Layer by layer ↓
        </a>
        <Link className="btn" href={`/#from=${s.slug}`}>
          Remix this stack
        </Link>
        <a className="btn" href={`${SITE.repo}/edit/main/content/stacks/${s.slug}.json`} rel="noopener">
          Edit on GitHub
        </a>
      </div>
      {/* The board's revision is the date the stack was last researched, not a made-up number. */}
      <StackView rows={rows} stack={s} label={`${s.name.toUpperCase()}${s.researched ? ` · REV ${s.researched}` : ""}`} />

      <section className={cited ? "ev-sec" : "ev-sec ev-uncited"}>
        <h2 id="layers">Layer by layer</h2>
        {/* One row per layer, in board order: what fills it, linked, and the sources that back it. */}
        <div className="ev-row ev-head" aria-hidden="true">
          <div>Layer</div>
          <div>Picks</div>
          {cited && <div>Sources</div>}
        </div>
        <div className="ev">
          {getLayers()
            .filter((l) => l.id in s.layers || empty.present.includes(l))
            .map((layer) => {
              const all = rows.find((r) => r.layer.id === layer.id)?.picks ?? [];
              // What the stack runs, then what it only supports, said once.
              const picks = all.filter((p) => !isSupported(s, layer.id, p.id));
              const extra = all.filter((p) => isSupported(s, layer.id, p.id));
              const pick = (p: (typeof all)[number]) => <Link href={optionHref(layer.id, p.id)}>{p.name}</Link>;
              return (
                <div key={layer.id} className="ev-row">
                  <div className="ev-layer">
                    <Link href={`/layer/${layer.id}/`}>{layer.name}</Link>
                  </div>
                  <ul className="ev-picks">
                    {!all.length && <li className="muted">{EMPTY.present}</li>}
                    {picks.map((p) => (
                      <li key={p.id}>
                        {pick(p)}
                        {p.note && <span className="muted"> — {p.note}</span>}
                      </li>
                    ))}
                    {extra.length > 0 && (
                      <li className="muted">
                        {picks.length ? "Also supports " : "Supports "}
                        {extra.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && ", "}
                            {pick(p)}
                          </span>
                        ))}
                      </li>
                    )}
                  </ul>
                  {cited && <div className="ev-cites">{cites(layer.id)}</div>}
                </div>
              );
            })}
        </div>
      </section>

      <div className="prose">
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
            <h2 id="sources">{d === "example" ? "Further reading" : "Sources"}</h2>
            <ol className="sources">
              {sources.map((src, i) => {
                // A named source shows where it points; one titled by its URL already does.
                const where = bareUrl(src.url);
                return (
                  <li key={src.url} id={`src-${i + 1}`}>
                    <a href={src.url} rel="noopener">
                      {src.title}
                    </a>
                    {src.title !== where && (
                      <span className="muted" title={where}>
                        {" "}
                        · {where.length > 48 ? `${where.slice(0, 47)}…` : where}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      {similar.length > 0 && (
        <>
          <div className="section-head">
            <h2>{nearest.length ? "Similar stacks" : `More ${s.kind.toLowerCase()} stacks`}</h2>
            {sameKind.length > 0 && (
              <Link href={kindHref(s.kind)} className="muted">
                all {s.kind.toLowerCase()} stacks →
              </Link>
            )}
          </div>
          <div className="filters">
            {similar.map((x) => (
              <Link
                key={x.slug}
                href={`/stack/${x.slug}/`}
                title={x.kind === s.kind ? x.kind : `${x.kind} · ${shared(x)} ${shared(x) === 1 ? "part" : "parts"} in common`}
              >
                {x.name}
                {disclosureMark(x) === "example" && " (example)"}
              </Link>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
