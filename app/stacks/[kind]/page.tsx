import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardLegend, StackCard } from "@/components/StackCard";
import { Title } from "@/components/Title";
import { SITE, getStacks, usageText } from "@/lib/data";
import { kindCount } from "@/lib/disclosure";
import { slugify } from "@/lib/github";
import { JsonLd } from "@/lib/jsonld";
import { kindHref, withMarkdown } from "@/lib/links";

type Props = { params: Promise<{ kind: string }> };

// A kind of stack is a real destination: the breadcrumbs on stack pages link here.
const kinds = () => [...new Set(getStacks().map((s) => s.kind))].sort();
const kindOf = (slug: string) => kinds().find((k) => slugify(k) === slug);

export const dynamicParams = false;
export const generateStaticParams = () => kinds().map((k) => ({ kind: slugify(k) }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const k = kindOf((await params).kind);
  if (!k) return {};
  const description = `${k} stacks mapped layer by layer: ${getStacks()
    .filter((s) => s.kind === k)
    .map((s) => s.name)
    .join(", ")}.`;
  return {
    title: `${k} stacks`,
    description,
    alternates: withMarkdown(kindHref(k)),
    openGraph: { type: "website", url: kindHref(k), title: `Agentic Stack / ${k}`, description },
    twitter: { title: `Agentic Stack / ${k}`, description },
  };
}

export default async function KindPage({ params }: Props) {
  const k = kindOf((await params).kind);
  if (!k) notFound();
  const all = getStacks();
  const stacks = all.filter((s) => s.kind === k);
  // Example designs are counted apart from real stacks, as everywhere else.
  const count = usageText({ stacks: stacks.filter((s) => s.disclosure !== "example"), examples: stacks.filter((s) => s.disclosure === "example") });

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Agentic Stack", item: `${SITE.url}/` },
            { "@type": "ListItem", position: 2, name: k, item: `${SITE.url}${kindHref(k)}` },
          ],
        }}
      />
      <Title
        crumbs={[
          { label: "Stacks", href: "/#stacks" },
          {
            label: k,
            items: kinds().map((x) => ({ label: x, href: kindHref(x), current: x === k, hint: kindCount(all.filter((s) => s.kind === x)) })),
          },
        ]}
      />
      <div className="section-head" style={{ marginTop: 24 }}>
        <h2>{count.replace(/^in /, "")}</h2>
        <CardLegend stacks={stacks} />
      </div>
      <div className="grid">
        {stacks.map((s) => (
          <StackCard key={s.slug} stack={s} />
        ))}
      </div>
    </>
  );
}
