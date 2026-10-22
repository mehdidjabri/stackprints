import Link from "next/link";

export function Title({ detail, as: Tag = "h1" }: { detail?: React.ReactNode; as?: "h1" | "div" }) {
  return (
    <Tag className="title">
      <Link href="/">Agentic Stack</Link>
      <span className="slash" aria-hidden="true">/</span>
      <span className="detail">{detail}</span>
    </Tag>
  );
}
