import type { Metadata } from "next";
import { SubmitForm } from "@/components/SubmitForm";
import { Title } from "@/components/Title";
import { SITE, getLayers } from "@/lib/data";

export const metadata: Metadata = {
  title: "Submit your product",
  description:
    "List your model, router, harness, memory, sandbox or any other agent infrastructure as an option on Agentic Stack. One JSON file, one pull request.",
  alternates: { canonical: "/submit/" },
};

export default function Submit() {
  const layers = getLayers().map(({ id, name, band, ref, description }) => ({ id, name, band, ref, description }));
  return (
    <>
      <Title detail="Submit" />
      <p className="lede">
        Build something agents use? Add it as an option in any layer. Fill this in, open the pull request, and once it
        merges your product shows up in that layer, in the editor, and on every stack that uses it. Free, no
        accounts, reviewed for accuracy.
      </p>
      <SubmitForm layers={layers} repo={SITE.repo} />
    </>
  );
}
