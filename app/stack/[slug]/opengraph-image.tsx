import { getStack, getStacks } from "@/lib/data";
import { OG_SIZE, ogImage } from "@/lib/og";

export const dynamic = "force-static";
export const alt = "Agent stack diagram";
export const size = OG_SIZE;
export const contentType = "image/png";
export const generateStaticParams = () => getStacks().map((s) => ({ slug: s.slug }));

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const s = getStack((await params).slug)!;
  return ogImage(s.name, s);
}
