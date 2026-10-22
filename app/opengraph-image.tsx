import { getStack } from "@/lib/data";
import { OG_SIZE, ogImage } from "@/lib/og";

export const dynamic = "force-static";
export const alt = "Stackprints — find out how any AI agent is built";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogImage("how any agent is built", getStack("openclaw"));
}
