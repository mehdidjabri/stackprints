import type { Option } from "@/lib/types";

/** Brand mark from the sprite, or a monogram tile for patterns and unlogoed products. */
export function Logo({ option }: { option: Pick<Option, "name" | "logo"> }) {
  if (option.logo)
    return (
      <svg className="logo" aria-hidden="true">
        <use href={`/logos.svg#${option.logo}`} />
      </svg>
    );
  const initials = option.name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span className="logo glyph" aria-hidden="true">
      {initials}
    </span>
  );
}
