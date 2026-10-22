import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { Trending } from "@/components/Trending";

export const metadata: Metadata = {
  title: "Trending in AI agent infrastructure",
  description:
    "The models, harnesses, memory layers, sandboxes and tools most in the news over the last 30 days, with the latest headline for each.",
  alternates: { canonical: "/trending/" },
};

export default function TrendingPage() {
  return (
    <>
      <Title detail="Trending" />
      <p className="lede">
        Ranked by recent news: every story from the last 30 days counts, newer stories count more. Sources are on each
        option&apos;s page. No paid placement.
      </p>
      <Trending limit={40} />
    </>
  );
}
