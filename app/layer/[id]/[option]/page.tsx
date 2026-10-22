import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { StackCard } from "@/components/StackCard";
import { Title } from "@/components/Title";
import { SITE, getLayers, getNews, getOption, metaDesc, usage, usageText } from "@/lib/data";
import { disclosureMark } from "@/lib/disclosure";
import { JsonLd } from "@/lib/jsonld";
import { citeNumbers, numberedSources, optionHref, withMarkdown } from "@/lib/links";
import type { Option } from "@/lib/types";

type Props = { params: Promise<{ id: string; option: string }> };

export const dynamicParams = false;
export const generateStaticParams = () =>
  getLayers().flatMap((l) => l.options.map((o) => ({ id: l.id, option: o.id })));

const PROFILE: Record<NonNullable<Option["profile"]>, string> = {
  model: "Model",
  product: "Product",
  protocol: "Protocol",
  pattern: "Pattern",
};

const LINK_LABEL: Record<string, string> = {
  site: "Website",
  docs: "Docs",
  repo: "Source",
  pricing: "Pricing",
  changelog: "Changelog",
  blog: "Blog",
  x: "X",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, option } = await params;
  const found = getOption(id, option);
  if (!found) return {};
  const { layer, option: o } = found;
  const title = `${o.name}: ${layer.name.toLowerCase()} for AI agents`;
  const description = metaDesc(o.summary ?? `${o.name}${o.note ? `: ${o.note}` : ""}. ${layer.description}`);
  const url = optionHref(layer.id, o.id);
  return {
    title,
    description,
    alternates: withMarkdown(url),
    openGraph: { type: "article", title: `Agentic Stack / ${layer.name} / ${o.name}`, description, url, images: "/opengraph-image" },
  };
}

export default async function OptionPage({ params }: Props) {
  const { id, option } = await params;
  const found = getOption(id, option);
  if (!found) notFound();
  const { layer, option: o } = found;
  const layers = getLayers();
  const news = o.profile === "pattern" ? undefined : getNews(layer.id, o.id);
  // Example designs are the site's own, so they're counted and listed apart from real stacks.
  const used = usage(layer.id, o.id);
  const { stacks, examples } = used;
  const alternatives = layer.options.filter((x) => x.id !== o.id);
  const links = Object.entries(o.links ?? {});
  if (!links.length && o.url) links.push(["site", `https://${o.url}`]);
  // The vendor's site, as the meta line links it; the page's own URL is ours.
  const website = o.links?.site ?? (o.url ? `https://${o.url}` : undefined);
  const page = `${SITE.url}${optionHref(layer.id, o.id)}`;
  const m = o.model;
  // [label, value, evidence key]
  const stats: [string, string | undefined, string][] = m
    ? [
        ["Context", m.context, "model.context"],
        ["Input", m.priceIn, "model.priceIn"],
        ["Output", m.priceOut, "model.priceOut"],
        ["Released", m.released, "model.released"],
        ["Weights", m.weights, "model.weights"],
      ]
    : [];
  // Datasheet entries cite their sources the way a stack's layers do (see Option.evidence).
  const sources = numberedSources(o.sources, o.evidence);
  const cites = (key: string) =>
    citeNumbers(sources, o.evidence?.[key]).map((n) => (
      <a key={n} className="cite" href={sources[n - 1].url} rel="noopener" title={sources[n - 1].title}>
        [{n}]
      </a>
    ));
  // Heavily used options list the first few stacks as cards and the rest as one compact line each.
  const SHOWN = 6;

  return (
    <article className={`option b-${layer.band}`}>
      {/* This page describes someone else's product, so the page is the item and the product what it's
          about: a Thing typed further by additionalType, not a SoftwareApplication with no offers or
          rating for search engines to flag. Its url is the vendor's, not ours. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebPage",
              url: page,
              name: `${o.name}: ${layer.name.toLowerCase()} for AI agents`,
              description: o.summary ?? o.note,
              ...(o.researched ? { dateModified: o.researched } : {}),
              mainEntity: {
                ...(o.profile === "pattern" || o.profile === "protocol"
                  ? { "@type": "DefinedTerm" }
                  : { "@type": "Thing", additionalType: "https://schema.org/SoftwareApplication" }),
                name: o.name,
                description: o.summary ?? o.note,
                ...(website ? { url: website } : {}),
                ...(links.length ? { sameAs: links.map(([, u]) => u) } : {}),
              },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: SITE.name, item: `${SITE.url}/` },
                { "@type": "ListItem", position: 2, name: layer.name, item: `${SITE.url}/layer/${layer.id}/` },
                { "@type": "ListItem", position: 3, name: o.name, item: page },
              ],
            },
          ],
        }}
      />
      <Title
        crumbs={[
          {
            label: layer.name,
            items: layers.map((l) => ({ label: l.name, href: `/layer/${l.id}/`, current: l.id === layer.id, hint: String(l.options.length) })),
          },
          {
            label: o.name,
            items: layer.options.map((x) => ({ label: x.name, href: optionHref(layer.id, x.id), current: x.id === o.id })),
          },
        ]}
      />
      <div className="meta-line">
        {o.profile ? PROFILE[o.profile] : "Option"}
        {o.open && " · open"}
        {usageText(used) && ` · ${usageText(used)}`}
        {o.url && (
          <>
            {" · "}
            <a href={website} rel="noopener">
              {o.url}
            </a>
          </>
        )}
      </div>
      {o.affiliation && (
        <p className="muted small reading">
          Disclosure: {o.affiliation} <Link href="/about/#affiliation">About</Link>
        </p>
      )}

      {/* Datasheet: the component itself on the left, its pin-out on the right. */}
      <section className="sheet">
        <div className="sheet-part module core">
          <header className="silk">
            {/* The slot's designator, as on the board; the profile is already in the meta line. */}
            <span className="ref">{layer.ref}</span>
            <Link href={`/layer/${layer.id}/`}>{layer.name}</Link>
          </header>
          <div className="sheet-chip">
            <Logo option={o} />
            <div>
              <div className="sheet-name">{o.name}</div>
              {o.note && <div className="chip-note">{o.note}</div>}
            </div>
          </div>
          {o.summary && <p className="sheet-summary">{o.summary}</p>}
          {links.length > 0 && (
            <div className="sheet-links">
              {links.map(([k, u]) => (
                <a key={k} className="btn" href={u} rel="noopener">
                  {LINK_LABEL[k] ?? k} ↗
                </a>
              ))}
            </div>
          )}
        </div>
        {o.facts && o.facts.length > 0 && (
          <div className="module sheet-facts">
            <header className="silk">
              <span className="ref">DS</span>Datasheet
            </header>
            <dl>
              {o.facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>
                    {v}
                    {cites(k)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      {stats.some(([, v]) => v) && (
        <section className="stats" aria-label="Model specs">
          {stats
            .filter(([, v]) => v)
            .map(([k, v, key]) => (
              <div key={k} className="module stat">
                <span className="silk">{k}</span>
                <strong>
                  {v}
                  {cites(key)}
                </strong>
              </div>
            ))}
        </section>
      )}

      {o.how && o.how.length > 0 && (
        <section className="block">
          <h2 className="block-head">How it works</h2>
          <ol className="pins">
            {o.how.map((step, i) => (
              <li key={i} className="module">
                <span className="silk">
                  <span className="ref">{String(i + 1).padStart(2, "0")}</span>
                </span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(o.goodFor?.length || o.watchOut?.length) && (
        <section className="block two">
          {o.goodFor && o.goodFor.length > 0 && (
            <div>
              <h2 className="block-head">Good for</h2>
              <ul className="ticks">
                {o.goodFor.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {o.watchOut && o.watchOut.length > 0 && (
            <div>
              <h2 className="block-head">Watch out for</h2>
              <ul className="ticks warn">
                {o.watchOut.map((w, i) => (
                  <li key={w}>
                    <span>
                      {w}
                      {cites(`watchOut.${i}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {news && (
        <section className="block">
          <h2 className="block-head">
            Latest news <span className="muted">checked {news.updated}</span>
          </h2>
          {news.items.length ? (
            <ul className="news">
              {news.items.map((n) => (
                <li key={`${n.date}-${n.title}`}>
                  <time dateTime={n.date}>{n.date}</time>
                  <a href={n.url} rel="noopener">
                    {n.title}
                  </a>
                  <span className="muted">{n.source}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No notable news in the last 12 months.</p>
          )}
        </section>
      )}

      {sources.length > 0 && (
        <section className="block">
          <h2 className="block-head" id="sources">
            Sources
          </h2>
          <ol className="sources">
            {sources.map((src, i) => (
              <li key={src.url} id={`src-${i + 1}`}>
                <a href={src.url} rel="noopener">
                  {src.title}
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

      {stacks.length > 0 && (
        <section className="block">
          <h2 className="block-head">Stacks using {o.name}</h2>
          <div className="grid">
            {stacks.slice(0, SHOWN).map((s) => (
              <StackCard key={s.slug} stack={s} />
            ))}
          </div>
          {stacks.length > SHOWN && (
            <details className="more-stacks">
              <summary>
                {stacks.length - SHOWN} more {stacks.length - SHOWN === 1 ? "stack" : "stacks"}
              </summary>
              <ul>
                {stacks.slice(SHOWN).map((s) => (
                  <li key={s.slug}>
                    <Link href={`/stack/${s.slug}/`}>{s.name}</Link>
                    <span className="muted">
                      {" "}
                      · {s.kind}
                      {disclosureMark(s) && ` · ${disclosureMark(s)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {examples.length > 0 && (
        <section className="block">
          <h2 className="block-head">Example designs using {o.name}</h2>
          <div className="grid">
            {examples.map((s) => (
              <StackCard key={s.slug} stack={s} />
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <h2 className="block-head">Other options in {layer.name}</h2>
        <div className="alts">
          {alternatives.map((x) => (
            <Link key={x.id} href={optionHref(layer.id, x.id)} className="chip">
              <Logo option={x} />
              <span className="chip-text">
                <span className="chip-name">{x.name}</span>
                {x.note && <span className="chip-note">{x.note}</span>}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <p className="muted small" style={{ marginTop: 32 }}>
        {o.researched ? `Researched ${o.researched}. ` : "Not researched yet. "}
        Spotted something wrong?{" "}
        <a href={`${SITE.repo}/edit/main/content/options/${layer.id}/${o.id}.json`} rel="noopener">
          Edit this page
        </a>
        .
      </p>
    </article>
  );
}
