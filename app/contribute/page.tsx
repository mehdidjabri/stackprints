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

      <h2>Publish your stack as a page</h2>
      <p>
        Build it on the <a href="/">home page</a>, press <strong>Publish as a page</strong>, add your name, a tagline
        and two sentences, and open the pull request. It becomes <code>content/stacks/your-stack.json</code> and,
        once merged, gets its own page at <code>/stack/your-stack/</code> with a preview image.
      </p>
      <pre>
        <code>{`{
  "slug": "my-agent",
  "name": "My Agent",
  "kind": "Personal stack",
  "tagline": "One line people will read in the grid.",
  "description": "Two or three sentences on how it works.",
  "author": { "name": "Ada", "url": "https://x.com/ada" },
  "layers": {
    "channels": ["telegram", "email"],
    "model": "claude-sonnet-5-5",
    "harness": "pi",
    "memory": ["past-dev", "memory-md"]
  }
}`}</code>
      </pre>

      <h2>List your product</h2>
      <p>
        Use the <a href="/submit/">submit form</a>, or add one file per product at{" "}
        <code>content/options/&lt;layer&gt;/&lt;id&gt;.json</code>. The <code>id</code> must match the file name.
        Add a <code>url</code> (domain, no protocol), a <code>note</code> under 60 characters, and{" "}
        <code>&quot;open&quot;: true</code> for open source or open weights. Leave out <code>order</code>: new entries
        are listed alphabetically after the curated ones.
      </p>
      <p>
        Logos: one-colour SVG with a <code>viewBox</code>, under 8 KB, no scripts, at{" "}
        <code>content/logos/&lt;name&gt;.svg</code>, referenced as <code>&quot;logo&quot;: &quot;&lt;name&gt;&quot;</code>
        . They are drawn in the page&apos;s text colour, so colours are ignored.
      </p>

      <h2>Add a layer</h2>
      <p>
        Add it to <code>content/layers.json</code> with a band: <code>surface</code>, <code>brain</code>,{" "}
        <code>hands</code>, <code>files</code> or <code>ops</code>, and create <code>content/options/&lt;layer&gt;/</code>.
      </p>

      <h2>Check before you push</h2>
      <pre>
        <code>npm run check</code>
      </pre>
      <p>It checks ids, file names, logos, and that every stack points at layers and options that exist.</p>

      <h2>House rules</h2>
      <p>
        Be factual and link a source. For closed products, describe what is publicly reported and say so. No
        affiliate links. Keep notes short and neutral.
      </p>
    </div>
  );
}
