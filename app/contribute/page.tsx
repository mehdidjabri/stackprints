import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { STACK_EXAMPLE } from "@/lib/agent";
import { SITE } from "@/lib/data";
import { withMarkdown } from "@/lib/links";

export const metadata: Metadata = {
  title: "Contribute",
  description: "Add an agent stack, a layer or an option to Agentic Stack. Everything is plain JSON in a public repo.",
  alternates: withMarkdown("/contribute/"),
};

// This copy is mirrored in /contribute.md (contributeMd in lib/agent.ts): change both together.
export default function Contribute() {
  return (
    <div className="prose">
      <Title detail="Contribute" />
      <p className="lede">
        Everything on this site is plain JSON in <a href={SITE.repo}>a public repo</a>. No database. You need a GitHub
        account to open a pull request; it ships on merge.
      </p>

      <h2>Publish your stack as a page</h2>
      <p>
        Build it on the <a href="/">home page</a>, press <strong>Publish as a page</strong>, add your name, a tagline
        and two sentences, and open the pull request. It becomes <code>content/stacks/your-stack.json</code> and,
        once merged, gets its own page at <code>/stack/your-stack/</code> with a preview image.
      </p>
      <pre>
        <code>{STACK_EXAMPLE}</code>
      </pre>
      <p>
        <code>disclosure</code> decides what an empty slot means: on <code>open-source</code> and <code>example</code>{" "}
        stacks it is not used; on <code>documented</code> and <code>closed</code> stacks it is not disclosed.{" "}
        <code>evidence</code> gives, for each layer the stack picks, the URLs that back the pick, taken from{" "}
        <code>sources</code>. <code>notUsed</code> lists layers a source confirms are absent. Three optional fields
        cover the in-between cases: <code>inUseUndisclosed</code> (present, component not named),{" "}
        <code>closedLayers</code> (open source with closed parts) and <code>supports</code> (configurable rather than
        default). The full rules are in <a href={`${SITE.repo}/blob/main/docs/RESEARCH.md`}>docs/RESEARCH.md</a>.
      </p>

      <h2>List your product</h2>
      <p>
        Use the <a href="/submit/">submit form</a>: it writes the file and opens the pull request.
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
