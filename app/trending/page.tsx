import type { Metadata } from "next";
import { Title } from "@/components/Title";
import { Trending } from "@/components/Trending";
import { getTrending, newsDate } from "@/lib/data";
import { withMarkdown } from "@/lib/links";

export const metadata: Metadata = {
  title: "Trending in AI agent infrastructure",
  description:
    "The models, harnesses, memory layers, sandboxes and tools most in the news over the last 30 days, with the latest headline for each.",
  alternates: withMarkdown("/trending/"),
  openGraph: { type: "website", url: "/trending/", title: "Stackprints / Trending", images: "/opengraph-image" },
};

export default function TrendingPage() {
  const asOf = newsDate();
  const LIMIT = 40;
  const capped = getTrending().slice(0, LIMIT).some((r) => r.atLeast);
  return (
    <>
      <Title detail="Trending" />
      <p className="lede">
        {/* The window ends at the last news check, not the build, so the date is printed. */}
        Ranked by news from the 30 days up to{" "}
        {asOf ? (
          <>
            <time dateTime={asOf}>{asOf}</time>, when news was last checked
          </>
        ) : (
          "today"
        )}
        : every story counts, newer stories count more.
        {capped && " “5+” means the option’s news file holds only its 5 newest stories, so there may be more."} Sources are on
        each option&apos;s page. No paid placement.
      </p>
      <Trending limit={LIMIT} />
    </>
  );
}
