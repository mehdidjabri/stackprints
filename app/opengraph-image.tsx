import { getStack } from "@/lib/data";
import { OG_SIZE, ogImage } from "@/lib/og";

export const dynamic = "force-static";
export const alt = "Agentic Stack — every AI agent stack, mapped";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogImage("every agent, mapped", getStack("openclaw"));
}
