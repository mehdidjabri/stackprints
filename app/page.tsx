import Link from "next/link";
import { Editor } from "@/components/Editor";
import { StackCard } from "@/components/StackCard";
import { SITE, asArray, getLayers, getStacks } from "@/lib/data";
import { BANDS } from "@/lib/bands";
import { JsonLd } from "@/lib/jsonld";

const DEFAULT = "openclaw";

export default function Home() {
  const layers = getLayers();
  const stacks = getStacks();
  // Ship only what the editor needs to the client.
  const lite = layers.map(({ id, name, band, options }) => ({
    id,
    name,
    band,
    description: "",
    options: options.map(({ id, name, note }) => ({ id, name, note })),
  }));
  const presets = stacks.map((s) => ({
    slug: s.slug,
    name: s.name,
    kind: s.kind,
    layers: Object.fromEntries(Object.entries(s.layers).map(([k, v]) => [k, asArray(v)])),
  }));

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE.name,
          url: SITE.url,
          description: SITE.description,
        }}
      />
      <Editor layers={lite} presets={presets} initial={DEFAULT} />

      <p className="lede" style={{ marginTop: 24 }}>
        An agent is more than a model. It is a stack: where people reach it, the model and router behind it, the
        loop that calls tools, the sandbox its code runs in, what it remembers, what wakes it up, and who it is
        allowed to pay. Pick any stack below, change any layer, save it, rename it, share it.
      </p>

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
    </>
  );
}
