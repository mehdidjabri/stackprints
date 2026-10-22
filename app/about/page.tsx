import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { ABOUT } from "@/lib/agent";
import { getLayers } from "@/lib/data";
import { withMarkdown } from "@/lib/links";

export const metadata: Metadata = {
  title: "About",
  description: "What Agentic Stack is, how it is researched and who maintains it.",
  alternates: withMarkdown("/about/"),
  openGraph: { type: "website", url: "/about/", title: "Agentic Stack / About" },
};

export default function Page() {
  const text = ABOUT.replace("{layers}", String(getLayers().length));
  return (
    <div className="prose">
      <Title detail="About" />
      {text.split("\n\n").map((p) => (
        <p key={p.slice(0, 24)}>{p}</p>
      ))}
    </div>
  );
}
