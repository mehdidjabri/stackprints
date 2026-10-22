import type { Metadata } from "next";
import Link from "next/link";
import { Title } from "@/components/Title";
import { BANDS } from "@/lib/bands";
import { getLayers } from "@/lib/data";
import { withMarkdown } from "@/lib/links";

export const metadata: Metadata = {
  title: "Layers of an AI agent stack",
  description:
    "The layers of a modern AI agent: channels, interface, voice, model, router, harness, tools, MCP, skills, sandbox, browser use, memory, retrieval, proactivity, durable execution, guardrails, identity, payments, observability and more.",
  alternates: withMarkdown("/layers/"),
  openGraph: { type: "website", url: "/layers/", title: "Stackprints / Layers", images: "/opengraph-image" },
};

export default function Layers() {
  const layers = getLayers();
  return (
    <>
      <Title detail="Layers" />
      <p className="lede">
        Every agent is assembled from the same layers, top (what people touch) to bottom (what keeps it running).
        Each layer lists the real options people use today.
      </p>
      {BANDS.map(([band, label]) => (
        <section key={band}>
          <div className="section-head">
            <h2>{label}</h2>
          </div>
          <div className="layer-grid">
            {layers
              .filter((l) => l.band === band)
              .map((l) => (
                <Link key={l.id} href={`/layer/${l.id}/`} className="layer-cell">
                  <strong>{l.name}</strong>
                  <span>{l.description}</span>
                  <span>{l.options.map((o) => o.name).slice(0, 5).join(" · ")}…</span>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}
