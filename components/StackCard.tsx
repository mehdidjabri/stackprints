import Link from "next/link";
import { resolve } from "@/lib/data";
import type { Stack } from "@/lib/types";
import { StackView } from "./StackView";

export function StackCard({ stack }: { stack: Stack }) {
  const rows = resolve(stack);
  return (
    <div className="card">
      <div className="card-head">
        <h3>
          <Link href={`/stack/${stack.slug}/`} className="card-link">
            {stack.name}
          </Link>
        </h3>
        <span className="kind">{stack.kind}</span>
      </div>
      <p className="card-tag">{stack.tagline}</p>
      <StackView rows={rows} compact />
    </div>
  );
}
