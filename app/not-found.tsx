import type { Metadata } from "next";
import Link from "next/link";
import { Title } from "@/components/Title";

// Its own tags, not the home page's: no canonical, not indexed, and the markdown 404 as its twin.
export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: true },
  alternates: { types: { "text/markdown": "/404.md" } },
  openGraph: { type: "website", siteName: "Agentic Stack", title: "Not found" },
};

export default function NotFound() {
  return (
    <div className="prose">
      <Title detail="Not found" />
      <p className="lede">
        That page doesn&apos;t exist. Try <Link href="/search/">search</Link>, <Link href="/layers/">all layers</Link> or
        the stacks on the <Link href="/">home page</Link>.
      </p>
    </div>
  );
}
