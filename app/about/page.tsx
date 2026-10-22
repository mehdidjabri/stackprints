import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { ABOUT, AFFILIATION, READING } from "@/lib/agent";
import { getLayers } from "@/lib/data";
import { withMarkdown } from "@/lib/links";

export const metadata: Metadata = {
  title: "About",
  description: "What Agentic Stack is, how it is researched and who maintains it.",
  alternates: withMarkdown("/about/"),
  openGraph: { type: "website", url: "/about/", title: "Agentic Stack / About", images: "/opengraph-image" },
};

/** The shared copy is plain paragraphs, with "- " lines for a list. */
const blocks = (text: string) =>
  text.split("\n\n").map((b) =>
    b.startsWith("- ") ? (
      <ul key={b.slice(0, 24)}>
        {b.split("\n").map((li) => (
          <li key={li}>{li.slice(2)}</li>
        ))}
      </ul>
    ) : (
      <p key={b.slice(0, 24)}>{b}</p>
    ),
  );

export default function Page() {
  return (
    <div className="prose">
      <Title detail="About" />
      {blocks(ABOUT.replace("{layers}", String(getLayers().length)))}
      <h2 id="disclosure">Reading a stack</h2>
      {blocks(READING)}
      <h2 id="affiliation">Affiliation</h2>
      {blocks(AFFILIATION)}
    </div>
  );
}
