import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { CONTACT } from "@/lib/agent";
import { getLayers } from "@/lib/data";
import { withMarkdown } from "@/lib/links";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach the maintainers, report a mistake or list a product.",
  alternates: withMarkdown("/contact/"),
  openGraph: { type: "website", url: "/contact/", title: "Agentic Stack / Contact" },
};

export default function Page() {
  const text = CONTACT.replace("{layers}", String(getLayers().length));
  return (
    <div className="prose">
      <Title detail="Contact" />
      {text.split("\n\n").map((p) => (
        <p key={p.slice(0, 24)}>{p}</p>
      ))}
    </div>
  );
}
