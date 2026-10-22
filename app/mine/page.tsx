import type { Metadata } from "next";
import { Mine } from "@/components/Mine";
import { Title } from "@/components/Title";

export const metadata: Metadata = {
  title: "My stacks",
  description: "Agent stacks you saved in this browser.",
  alternates: { canonical: "/mine/" },
  robots: { index: false, follow: true },
};

export default function MinePage() {
  return (
    <>
      <Title detail="Mine" />
      <Mine />
    </>
  );
}
