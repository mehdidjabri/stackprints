import type { Metadata } from "next";
import { SearchPage } from "@/components/SearchPage";
import { Title } from "@/components/Title";

export const metadata: Metadata = {
  title: "Search",
  description: "Search every agent stack, layer and tool on Stackprints.",
  alternates: { canonical: "/search/" },
  robots: { index: false, follow: true },
};

export default function Search() {
  return (
    <>
      <Title detail="Search" />
      <SearchPage />
    </>
  );
}
