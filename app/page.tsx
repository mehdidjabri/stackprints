import Link from "next/link";
import { Editor } from "@/components/Editor";
import { StackCard } from "@/components/StackCard";
import { Trending } from "@/components/Trending";
import { SITE, asArray, getLayers, getStacks } from "@/lib/data";
import { BANDS } from "@/lib/bands";
import { JsonLd } from "@/lib/jsonld";
import { primaryLink } from "@/lib/links";

const DEFAULT = "openclaw";

export default function Home() {
  const layers = getLayers();
  const stacks = getStacks();
  // Ship only what the editor needs to the client.
  const lite = layers.map(({ id, name, band, ref, options }) => ({
    id,
    name,
    band,
    ref,
    description: "",
    options: options.map(({ id, name, note, logo }) => ({ id, name, note, logo })),
  }));
  const presets = stacks.map((s) => ({
    slug: s.slug,
    name: s.name,
    kind: s.kind,
    site: primaryLink(s.links),
    disclosure: s.disclosure,
    notUsed: s.notUsed,
    layers: Object.fromEntries(Object.entries(s.layers).map(([k, v]) => [k, asArray(v)])),
  }));

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${SITE.url}/#org`,
              name: SITE.name,
              url: SITE.url,
              description: "Open, community-maintained map of how AI agents are built.",
              sameAs: [SITE.repo],
            },
            {
              "@type": "WebSite",
              "@id": `${SITE.url}/#website`,
              name: SITE.name,
              url: SITE.url,
              description: SITE.description,
              publisher: { "@id": `${SITE.url}/#org` },
              potentialAction: {
                "@type": "SearchAction",
                target: `${SITE.url}/search/?q={search_term_string}`,
                "query-input": "required name=search_term_string",
              },
            },
            {
              "@type": "WebApplication",
              name: `${SITE.name} editor`,
              url: SITE.url,
              applicationCategory: "DeveloperApplication",
              operatingSystem: "Any (web browser)",
              isAccessibleForFree: true,
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
              publisher: { "@id": `${SITE.url}/#org` },
            },
            {
              "@type": "Dataset",
              name: `${SITE.name}: AI agent stacks, layers and options`,
              description: `${stacks.length} agent stacks and ${layers.reduce((n, l) => n + l.options.length, 0)} options across ${layers.length} layers, with sources, disclosure levels and weekly news.`,
              url: SITE.url,
              license: "https://opensource.org/licenses/MIT",
              isAccessibleForFree: true,
              creator: { "@id": `${SITE.url}/#org` },
              distribution: [
                { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE.url}/api/stacks.json` },
                { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE.url}/api/layers.json` },
              ],
            },
          ],
        }}
      />
      <header className="hero">
        <h1>Every AI agent stack, mapped</h1>
        <p className="lede">
          An agent is more than a model: it&apos;s where people reach it, the loop that calls tools, the sandbox its code
          runs in, what it remembers and what wakes it up. Pick a stack, change any part, save it, share it.
        </p>
      </header>

      <Editor layers={lite} presets={presets} initial={DEFAULT} repo={SITE.repo} />


      <div className="section-head" id="stacks">
        <h2>Stacks</h2>
        <span className="muted">{stacks.length}</span>
      </div>
      <div className="grid">
        {stacks.map((s) => (
          <StackCard key={s.slug} stack={s} />
        ))}
      </div>

      <div className="section-head">
        <h2>Layers</h2>
        <Link href="/layers/" className="muted">
          {layers.length} layers · {layers.reduce((n, l) => n + l.options.length, 0)} options
        </Link>
      </div>
      <div className="layer-grid">
        {BANDS.flatMap(([band]) => layers.filter((l) => l.band === band)).map((l) => (
          <Link key={l.id} href={`/layer/${l.id}/`} className="layer-cell">
            <strong>{l.name}</strong>
            <span>{l.description}</span>
          </Link>
        ))}
      </div>

      <div className="section-head" id="trending">
        <h2>Trending</h2>
        <Link href="/trending/" className="muted">
          most in the news, last 30 days →
        </Link>
      </div>
      <Trending limit={6} />
    </>
  );
}
