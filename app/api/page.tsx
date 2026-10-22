import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { SITE, getLayers, getStacks } from "@/lib/data";

export const metadata: Metadata = {
  title: "API",
  description:
    "Free, read-only JSON API for AI agent stacks, layers and options. No key, no sign-up. OpenAPI 3.1 spec included.",
  alternates: { canonical: "/api/" },
  openGraph: { type: "website", url: "/api/", title: "Agentic Stack / API", images: "/opengraph-image" },
};

const ENDPOINTS: [string, string, string][] = [
  ["GET /api/stacks.json", "Every stack: name, kind, tagline, disclosure, links", "/api/stacks.json"],
  ["GET /api/stacks/{slug}.json", "One stack, layer by layer, with evidence URLs, sources, notDisclosed, inUseUndisclosed and notUsed", "/api/stacks/openclaw.json"],
  ["GET /api/layers.json", "Every layer with its options", "/api/layers.json"],
  ["GET /api/layers/{layer}.json", "One layer with option summaries", "/api/layers/memory.json"],
  ["GET /api/options/{layer}/{option}.json", "One option: datasheet facts, links, caveats, news, stacks that use it", "/api/options/router/openrouter.json"],
  ["GET /search.json", "Compact search index of every stack, layer and option", "/search.json"],
];

export default function Api() {
  return (
    <div className="prose">
      <Title detail="API" />
      <p className="lede">
        Everything on {SITE.name} is available as static JSON: {getStacks().length} stacks with their sources,{" "}
        {getLayers().length} layers, and every option with its links and research date. No authentication, no API key, no
        rate-limit tiers. It&apos;s free.
      </p>

      <h2>Endpoints</h2>
      <div className="options">
        {ENDPOINTS.map(([route, what, example]) => (
          <div key={route} className="opt">
            <div className="opt-name">
              <code>{route}</code>
            </div>
            <div className="opt-note">{what}</div>
            <div className="opt-used">
              <a href={example}>example</a>
            </div>
          </div>
        ))}
      </div>

      <h2>Example</h2>
      <pre>
        <code>{`curl ${SITE.url}/api/stacks/openclaw.json`}</code>
      </pre>

      <h2>Reading stacks correctly</h2>
      <p>
        Each stack has a <code>disclosure</code>: <code>open-source</code> and <code>example</code> stacks list everything
        they use, so a missing layer is not used. <code>documented</code> and <code>closed</code> stacks only list what
        their makers or reputable press have published; layers in <code>notDisclosed</code> are unknown, not absent. An
        open-source stack with closed parts lists the layers only those parts could fill under <code>notDisclosed</code>{" "}
        too. Layers in <code>inUseUndisclosed</code> are present, with evidence, but their component isn&apos;t named. A
        pick with <code>&quot;supported&quot;: true</code> is something the stack can be configured to use, not what it
        runs by default. Every pick on a real product has evidence URLs in <code>layers[].evidence</code>. An{" "}
        <code>example</code> stack is a design written for this site, not a product: an option&apos;s <code>usage</code>{" "}
        counts examples apart from real stacks, so don&apos;t read them as adoption. See also{" "}
        <a href="/about/#disclosure">Reading a stack</a>.
      </p>

      <h2>Machine-readable</h2>
      <ul>
        <li>
          OpenAPI 3.1: <a href="/openapi.json">/openapi.json</a>
        </li>
        <li>
          API catalog (RFC 9727): <a href="/.well-known/api-catalog">/.well-known/api-catalog</a>
        </li>
        <li>
          Agent resource catalog: <a href="/.well-known/ard.json">/.well-known/ard.json</a>
        </li>
        <li>
          Agent skill: <a href="/.well-known/agent-skills/index.json">/.well-known/agent-skills/index.json</a>
        </li>
        <li>
          Guides for AI readers: <a href="/llms.txt">/llms.txt</a>, <a href="/llms-full.txt">/llms-full.txt</a>; every page
          also has a markdown twin at its URL plus <code>.md</code>
        </li>
      </ul>

      <h2>Versioning and errors</h2>
      <p>
        The API is version 1. Fields are only added, never renamed or removed, within a major version; a breaking change
        would ship under a new path with notice in the repository. Unknown slugs return a plain HTTP 404. Data is rebuilt on
        every deploy and the news refreshes weekly, so cache freely.
      </p>
    </div>
  );
}
