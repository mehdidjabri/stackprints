import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { PRIVACY } from "@/lib/agent";
import { getLayers } from "@/lib/data";
import { withMarkdown } from "@/lib/links";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Agentic Stack does and doesn't collect about visitors.",
  alternates: withMarkdown("/privacy/"),
  openGraph: { type: "website", url: "/privacy/", title: "Agentic Stack / Privacy" },
};

export default function Page() {
  const text = PRIVACY.replace("{layers}", String(getLayers().length));
  return (
    <div className="prose">
      <Title detail="Privacy" />
      {text.split("\n\n").map((p) => (
        <p key={p.slice(0, 24)}>{p}</p>
      ))}
    </div>
  );
}
