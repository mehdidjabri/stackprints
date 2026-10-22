import type { Metadata } from "next";
import { Mine } from "@/components/Mine";
import { Title } from "@/components/Title";
import { getLayers, getStacks } from "@/lib/data";

export const metadata: Metadata = {
  title: "My stacks",
  description: "Agent stacks you saved in this browser.",
  alternates: { canonical: "/mine/" },
  robots: { index: false, follow: true },
};

export default function MinePage() {
  // Just enough to fit old saves to today's layers and name the stack each one started from.
  const layers = getLayers().map((l) => ({ id: l.id, options: l.options.map((o) => ({ id: o.id })) }));
  const presets = Object.fromEntries(getStacks().map((s) => [s.slug, s.name]));
  return (
    <>
      <Title detail="Mine" />
      <Mine layers={layers} presets={presets} />
    </>
  );
}
