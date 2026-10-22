import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { SITE } from "@/lib/data";

export const metadata: Metadata = {
  title: "Contribute",
  description: "Add an agent stack, a layer or an option to Agentic Stack. Everything is plain JSON in a public repo.",
  alternates: { canonical: "/contribute/" },
};

export default function Contribute() {
  return (
    <div className="prose">
      <Title detail="Contribute" />
      <p className="lede">
        Everything on this site is plain JSON in <a href={SITE.repo}>a public repo</a>. No database, no accounts.
        Open a pull request and it ships on merge.
      </p>

      <h2>Add a stack</h2>
      <p>
        Build it on the <a href="/">home page</a>, press <strong>Contribute JSON</strong>, and save the clipboard as{" "}
        <code>content/stacks/your-stack.json</code>. Fill in <code>tagline</code>, <code>description</code> and{" "}
        <code>source</code>.
      </p>
      <pre>
        <code>{`{
  "slug": "my-agent",
  "name": "My Agent",
  "kind": "Personal agent",
  "tagline": "One line people will read in the grid.",
  "description": "Two or three sentences on how it works.",
  "source": "github.com/me/my-agent",
  "layers": {
    "channels": ["telegram", "email"],
    "model": "claude-sonnet-5-5",
    "harness": "pi-agent-core"
  }
}`}</code>
      </pre>

      <h2>Add an option or a layer</h2>
      <p>
        Edit <code>content/layers.json</code>. Options need an <code>id</code> (kebab-case) and a <code>name</code>;
        add a <code>url</code> (domain, no protocol), a 3–8 word <code>note</code>, and <code>&quot;open&quot;: true</code>{" "}
        for open source or open weights. New layers pick a band: <code>surface</code>, <code>brain</code>,{" "}
        <code>hands</code>, <code>files</code> or <code>ops</code>.
      </p>

      <h2>Check before you push</h2>
      <pre>
        <code>npm run check</code>
      </pre>
      <p>It fails on any stack that points at a layer or option that doesn&apos;t exist.</p>

      <h2>House rules</h2>
      <p>
        Be factual and link a source. For closed products, describe what is publicly reported and say so. No
        affiliate links. Keep notes short and neutral.
      </p>
    </div>
  );
}
