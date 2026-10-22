import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { API_ENDPOINTS, API_READING, API_VERSIONING, apiLede, layerIds } from "@/lib/agent";
import { SITE } from "@/lib/data";
import { MD_RULE, withMarkdown } from "@/lib/links";

export const metadata: Metadata = {
  title: "API",
  description:
    "Free, read-only JSON API for AI agent stacks, layers and options. No key, no sign-up. OpenAPI 3.1 spec included.",
  alternates: withMarkdown("/api/"),
  openGraph: { type: "website", url: "/api/", title: "Stackprints / API", images: "/opengraph-image" },
};

/** The copy is shared with /api.md, where `backticks` mark code. */
const withCode = (text: string) => text.split(/`([^`]+)`/).map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t));

export default function Api() {
  return (
    <div className="prose">
      <Title detail="API" />
      <p className="lede">{apiLede()}</p>

      <h2>Endpoints</h2>
      <div className="options">
        {API_ENDPOINTS.map(([route, what, example]) => (
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

      <p>{withCode(layerIds())}</p>

      <h2>Example</h2>
      <pre>
        <code>{`curl ${SITE.url}/api/stacks/openclaw.json`}</code>
      </pre>

      <h2>Reading stacks correctly</h2>
      <p>
        {withCode(API_READING)} See also <a href="/about/#disclosure">Reading a stack</a>.
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
          Guides for AI readers: <a href="/llms.txt">/llms.txt</a>, <a href="/llms-full.txt">/llms-full.txt</a>; every
          content page also has a markdown twin: {withCode(MD_RULE)}
        </li>
      </ul>

      <h2>Versioning and errors</h2>
      <p>{API_VERSIONING}</p>
    </div>
  );
}
